const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const MarketplaceShipment = require("../../model/marketplace/shipment");
const MarketplaceShipmentItem = require("../../model/marketplace/shipmentItem");
const MarketplaceRefund = require("../../model/marketplace/refund");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const User = require("../../model/user");
const SalesOrder = require("../../model/salesOrder");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    COMPANY_ORDER_STATUSES,
    CHECKOUT_PAYMENT_STATUSES,
} = require("../../constants/marketplace");
const { companyFilter } = require("../../utils/tenantScope");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");
const { assertDocumentCompany } = require("../companyService");
const { formatCustomerShipment } = require("./marketplaceOrderService");

const SHIPPABLE_STATUSES = new Set([
    "confirmed",
    "processing",
    "packed",
    "partially_shipped",
]);

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const escapeRegex = (value) =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const loadCompanyOrderForTenant = async (companyOrderId, companyId) => {
    const order = await CompanyOrder.findOne({
        _id: toObjectId(companyOrderId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    });

    if (!order) throw new AppError("Company order not found.", 404);
    assertDocumentCompany(order, companyId, "Company order");
    return order;
};

const getShippedQtyMaps = async (companyOrderIds = []) => {
    const ids = companyOrderIds.map(toObjectId).filter(Boolean);
    if (!ids.length) return new Map();

    const rows = await MarketplaceShipmentItem.aggregate([
        {
            $match: {
                companyOrderId: { $in: ids },
                isDeleted: { $ne: true },
            },
        },
        {
            $group: {
                _id: { companyOrderId: "$companyOrderId", orderItemId: "$orderItemId" },
                shippedQty: { $sum: "$quantity" },
            },
        },
    ]);

    const byCompany = new Map();
    for (const row of rows) {
        const companyKey = String(row._id.companyOrderId);
        if (!byCompany.has(companyKey)) byCompany.set(companyKey, new Map());
        byCompany
            .get(companyKey)
            .set(String(row._id.orderItemId), row.shippedQty);
    }
    return byCompany;
};

const getShippedQtyMap = async (companyOrderId) => {
    const maps = await getShippedQtyMaps([companyOrderId]);
    return maps.get(String(companyOrderId)) || new Map();
};

const buildFulfillment = (items = [], shippedMap = new Map()) => {
    let totalUnits = 0;
    let shippedUnits = 0;
    for (const item of items) {
        const qty = Number(item.quantity) || 0;
        const shipped = Math.min(shippedMap.get(String(item._id)) || 0, qty);
        totalUnits += qty;
        shippedUnits += shipped;
    }
    return {
        totalUnits,
        shippedUnits,
        remainingUnits: Math.max(0, totalUnits - shippedUnits),
        progressPercent:
            totalUnits > 0 ? Math.round((shippedUnits / totalUnits) * 100) : 0,
    };
};

const buildCompanyOrderActions = ({
    companyOrder,
    masterOrder,
    fulfillment,
    refunds = [],
}) => {
    const pendingRefunds = refunds.filter((refund) => refund.status === "pending")
        .length;

    return {
        canUpdateStatus: !["cancelled", "refunded", "delivered"].includes(
            companyOrder.status
        ),
        canShip:
            SHIPPABLE_STATUSES.has(companyOrder.status) &&
            masterOrder?.paymentStatus === "successful" &&
            !!companyOrder.inventoryReservedAt &&
            fulfillment.remainingUnits > 0,
        canRefund:
            masterOrder?.paymentStatus === "successful" &&
            !["cancelled", "refunded"].includes(companyOrder.status),
        canBridgeToErp: !companyOrder.salesOrderId,
        canCreateRefund: pendingRefunds === 0,
        hasPendingRefunds: pendingRefunds > 0,
    };
};

const formatCompanyListItem = ({
    companyOrder,
    masterOrder,
    fulfillment,
    refundCount = 0,
}) => ({
    id: companyOrder._id,
    orderNumber: companyOrder.orderNumber,
    masterOrderId: companyOrder.masterOrderId,
    masterOrderNumber: masterOrder?.orderNumber || "",
    status: companyOrder.status,
    paymentStatus: masterOrder?.paymentStatus || "pending",
    currency: companyOrder.currency,
    totals: companyOrder.totals,
    itemCount: companyOrder.itemCount,
    customerName: companyOrder.shippingAddress?.recipientName || "",
    customerPhone: companyOrder.shippingAddress?.phone || "",
    placedAt: masterOrder?.placedAt || companyOrder.createdAt,
    estimatedDeliveryAt: companyOrder.estimatedDeliveryAt,
    fulfillment,
    refundCount,
    salesOrderId: companyOrder.salesOrderId,
    isErpLinked: !!companyOrder.salesOrderId,
    createdAt: companyOrder.createdAt,
});

const listCompanyOrders = async (companyId, query = {}) => {
    const tenant = companyFilter(companyId);
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "company",
    });

    const filter = { ...tenant, ...NOT_DELETED };
    if (query.status) {
        if (!COMPANY_ORDER_STATUSES.includes(query.status)) {
            throw new AppError("Invalid status filter.", 400);
        }
        filter.status = query.status;
    }

    if (query.search) {
        const term = escapeRegex(query.search.trim());
        if (term) {
            filter.$or = [
                { orderNumber: { $regex: term, $options: "i" } },
                { "shippingAddress.recipientName": { $regex: term, $options: "i" } },
                { "shippingAddress.phone": { $regex: term, $options: "i" } },
            ];
        }
    }

    let masterOrderIdsFilter = null;
    if (query.paymentStatus) {
        if (!CHECKOUT_PAYMENT_STATUSES.includes(query.paymentStatus)) {
            throw new AppError("Invalid payment status filter.", 400);
        }
        const tenantMasterIds = await CompanyOrder.distinct("masterOrderId", {
            ...tenant,
            ...NOT_DELETED,
        });
        masterOrderIdsFilter = await MasterOrder.distinct("_id", {
            _id: { $in: tenantMasterIds },
            paymentStatus: query.paymentStatus,
            ...NOT_DELETED,
        });
        filter.masterOrderId = { $in: masterOrderIdsFilter };
    }

    if (query.dateFrom || query.dateTo) {
        filter.createdAt = {};
        if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
        if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
    }

    if (query.erpLinked === "true") filter.salesOrderId = { $ne: null };
    if (query.erpLinked === "false") filter.salesOrderId = null;

    const [orders, total] = await Promise.all([
        CompanyOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        CompanyOrder.countDocuments(filter),
    ]);

    const masterIds = [...new Set(orders.map((order) => String(order.masterOrderId)))];
    const companyOrderIds = orders.map((order) => order._id);

    const [masters, items, refunds] = await Promise.all([
        MasterOrder.find({ _id: { $in: masterIds }, ...NOT_DELETED })
            .select("orderNumber paymentStatus placedAt")
            .lean(),
        MarketplaceOrderItem.find({
            companyOrderId: { $in: companyOrderIds },
            ...NOT_DELETED,
        }).lean(),
        MarketplaceRefund.find({
            companyOrderId: { $in: companyOrderIds },
            ...NOT_DELETED,
        })
            .select("companyOrderId status")
            .lean(),
    ]);

    const masterMap = new Map(masters.map((row) => [String(row._id), row]));
    const itemsByCompany = new Map();
    for (const item of items) {
        const key = String(item.companyOrderId);
        if (!itemsByCompany.has(key)) itemsByCompany.set(key, []);
        itemsByCompany.get(key).push(item);
    }
    const refundCountByCompany = new Map();
    for (const refund of refunds) {
        const key = String(refund.companyOrderId);
        refundCountByCompany.set(key, (refundCountByCompany.get(key) || 0) + 1);
    }

    const shippedMaps = await getShippedQtyMaps(companyOrderIds);

    const data = [];
    for (const companyOrder of orders) {
        const shippedMap =
            shippedMaps.get(String(companyOrder._id)) || new Map();
        const companyItems = itemsByCompany.get(String(companyOrder._id)) || [];
        data.push(
            formatCompanyListItem({
                companyOrder,
                masterOrder: masterMap.get(String(companyOrder.masterOrderId)),
                fulfillment: buildFulfillment(companyItems, shippedMap),
                refundCount: refundCountByCompany.get(String(companyOrder._id)) || 0,
            })
        );
    }

    return {
        data,
        pagination: buildPagination(total),
    };
};

const getCompanyOrderDetail = async (companyOrderId, companyId) => {
    const companyOrder = await loadCompanyOrderForTenant(companyOrderId, companyId);
    const [
        items,
        shipments,
        masterOrder,
        payment,
        refunds,
        customerUser,
        salesOrder,
    ] = await Promise.all([
        MarketplaceOrderItem.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        }).lean(),
        MarketplaceShipment.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
        MasterOrder.findById(companyOrder.masterOrderId).lean(),
        CheckoutPayment.findOne({
            masterOrderId: companyOrder.masterOrderId,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
        MarketplaceRefund.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
        User.findById(companyOrder.userId)
            .select("firstName lastName email")
            .lean(),
        companyOrder.salesOrderId
            ? SalesOrder.findById(companyOrder.salesOrderId)
                  .select("orderNumber status paymentStatus grandTotal dueAmount")
                  .lean()
            : null,
    ]);

    const shippedMap = await getShippedQtyMap(companyOrder._id);
    const fulfillment = buildFulfillment(items, shippedMap);

    const shipmentIds = shipments.map((row) => row._id);
    const shipmentItems = shipmentIds.length
        ? await MarketplaceShipmentItem.find({
              shipmentId: { $in: shipmentIds },
              ...NOT_DELETED,
          }).lean()
        : [];
    const itemCountByShipment = new Map();
    for (const row of shipmentItems) {
        const key = String(row.shipmentId);
        itemCountByShipment.set(key, (itemCountByShipment.get(key) || 0) + 1);
    }

    const formattedItems = items.map((item) => ({
        ...item,
        shippedQuantity: shippedMap.get(String(item._id)) || 0,
        remainingQuantity: Math.max(
            0,
            item.quantity -
                (shippedMap.get(String(item._id)) || 0) -
                (Number(item.refundedQuantity) || 0)
        ),
    }));

    return {
        companyOrder: {
            id: companyOrder._id,
            orderNumber: companyOrder.orderNumber,
            masterOrderId: companyOrder.masterOrderId,
            status: companyOrder.status,
            currency: companyOrder.currency,
            totals: companyOrder.totals,
            itemCount: companyOrder.itemCount,
            shippingAddress: companyOrder.shippingAddress,
            shippingRuleId: companyOrder.shippingRuleId,
            estimatedDeliveryAt: companyOrder.estimatedDeliveryAt,
            confirmedAt: companyOrder.confirmedAt,
            shippedAt: companyOrder.shippedAt,
            deliveredAt: companyOrder.deliveredAt,
            cancelledAt: companyOrder.cancelledAt,
            cancelReason: companyOrder.cancelReason,
            inventoryReservedAt: companyOrder.inventoryReservedAt,
            companyNote: companyOrder.companyNote,
            salesOrderId: companyOrder.salesOrderId,
            erpCustomerId: companyOrder.erpCustomerId,
            createdAt: companyOrder.createdAt,
            updatedAt: companyOrder.updatedAt,
        },
        masterOrder: masterOrder
            ? {
                  id: masterOrder._id,
                  orderNumber: masterOrder.orderNumber,
                  status: masterOrder.status,
                  paymentStatus: masterOrder.paymentStatus,
                  placedAt: masterOrder.placedAt,
                  customerNote: masterOrder.customerNote,
              }
            : null,
        customer: {
            userId: companyOrder.userId,
            name:
                companyOrder.shippingAddress?.recipientName ||
                [customerUser?.firstName, customerUser?.lastName]
                    .filter(Boolean)
                    .join(" "),
            phone: companyOrder.shippingAddress?.phone || "",
            email: customerUser?.email || "",
        },
        payment: payment
            ? {
                  id: payment._id,
                  paymentNumber: payment.paymentNumber,
                  status: payment.status,
                  amount: payment.amount,
                  refundedAmount: payment.refundedAmount || 0,
                  paymentMethod: payment.paymentMethod,
                  paidAt: payment.paidAt,
              }
            : null,
        fulfillment,
        items: formattedItems,
        shipments: shipments.map((shipment) =>
            formatCustomerShipment(
                shipment,
                itemCountByShipment.get(String(shipment._id)) || 0
            )
        ),
        refunds: refunds.map((refund) => ({
            id: refund._id,
            refundNumber: refund.refundNumber,
            scope: refund.scope,
            amount: refund.amount,
            status: refund.status,
            reason: refund.reason,
            createdAt: refund.createdAt,
            processedAt: refund.processedAt,
        })),
        erpBridge: {
            isLinked: !!companyOrder.salesOrderId,
            salesOrderId: companyOrder.salesOrderId,
            salesOrderNumber: salesOrder?.orderNumber || "",
            salesOrderStatus: salesOrder?.status || "",
            erpCustomerId: companyOrder.erpCustomerId,
        },
        actions: buildCompanyOrderActions({
            companyOrder,
            masterOrder,
            fulfillment,
            refunds,
        }),
    };
};

const getCompanyOrderDashboard = async (companyId) => {
    const tenant = companyFilter(companyId);
    const baseFilter = { ...tenant, ...NOT_DELETED };

    const statusRows = await CompanyOrder.aggregate([
        { $match: baseFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statusCounts = Object.fromEntries(
        statusRows.map((row) => [row._id, row.count])
    );

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todayOrders, unlinkedErpCount, pendingFulfillment] = await Promise.all([
        CompanyOrder.find({
            ...baseFilter,
            createdAt: { $gte: startOfDay },
        })
            .select("totals")
            .lean(),
        CompanyOrder.countDocuments({
            ...baseFilter,
            salesOrderId: null,
            status: { $nin: ["cancelled", "refunded"] },
        }),
        CompanyOrder.countDocuments({
            ...baseFilter,
            status: { $in: ["confirmed", "processing", "packed", "partially_shipped"] },
        }),
    ]);

    const todayRevenue = todayOrders.reduce(
        (sum, order) => sum + (Number(order.totals?.total) || 0),
        0
    );

    return {
        totals: {
            all: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
            pending: statusCounts.pending || 0,
            confirmed: statusCounts.confirmed || 0,
            processing: statusCounts.processing || 0,
            shipped:
                (statusCounts.partially_shipped || 0) + (statusCounts.shipped || 0),
            delivered: statusCounts.delivered || 0,
            cancelled: statusCounts.cancelled || 0,
            refunded: statusCounts.refunded || 0,
        },
        today: {
            orderCount: todayOrders.length,
            revenue: todayRevenue,
        },
        operations: {
            pendingFulfillment,
            erpUnlinkedCount: unlinkedErpCount,
        },
        statusCounts,
    };
};

module.exports = {
    loadCompanyOrderForTenant,
    getShippedQtyMap,
    listCompanyOrders,
    getCompanyOrderDetail,
    getCompanyOrderDashboard,
};
