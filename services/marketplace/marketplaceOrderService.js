const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const MarketplaceShipment = require("../../model/marketplace/shipment");
const MarketplaceShipmentItem = require("../../model/marketplace/shipmentItem");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const MarketplaceRefund = require("../../model/marketplace/refund");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    MASTER_ORDER_STATUSES,
    CHECKOUT_PAYMENT_STATUSES,
} = require("../../constants/marketplace");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const sellerLabel = (seller = {}) =>
    String(seller.tradeName || seller.legalName || seller.companyCode || "Seller").trim();

const formatCustomerOrderItem = (item, shippedQty = 0) => {
    const refundedQuantity = Number(item.refundedQuantity) || 0;
    const quantity = Number(item.quantity) || 0;
    const shippedQuantity = Math.min(shippedQty, quantity);
    const remainingQuantity = Math.max(
        0,
        quantity - shippedQuantity - refundedQuantity
    );

    return {
        id: item._id,
        product: item.product,
        quantity,
        lineSubtotal: item.lineSubtotal,
        discountAmount: item.discountAmount || 0,
        refundedQuantity,
        shippedQuantity,
        remainingQuantity,
    };
};

const formatCustomerShipment = (shipment, itemCount = 0) => ({
    id: shipment._id,
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    courierName: shipment.courierName || "",
    trackingNumber: shipment.trackingNumber || "",
    trackingUrl: shipment.trackingUrl || "",
    estimatedDeliveryAt: shipment.estimatedDeliveryAt,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    itemCount,
    trackingPath: `/api/marketplace/shipments/${shipment._id}/tracking`,
});

const formatPaymentSummary = (payment) => {
    if (!payment) return null;
    return {
        id: payment._id,
        paymentNumber: payment.paymentNumber,
        status: payment.status,
        amount: payment.amount,
        refundedAmount: payment.refundedAmount || 0,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        paymentProvider: payment.paymentProvider,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        failureReason: payment.failureReason || "",
    };
};

const formatRefundSummary = (refunds = []) => {
    const completed = refunds.filter((refund) => refund.status === "completed");
    const totalRefunded = completed.reduce(
        (sum, refund) => sum + (Number(refund.amount) || 0),
        0
    );

    return {
        count: refunds.length,
        completedCount: completed.length,
        totalRefunded,
        pendingCount: refunds.filter((refund) => refund.status === "pending").length,
        recent: refunds.slice(0, 5).map((refund) => ({
            id: refund._id,
            refundNumber: refund.refundNumber,
            scope: refund.scope,
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
            companyOrderId: refund.companyOrderId,
            orderItemId: refund.orderItemId,
            createdAt: refund.createdAt,
            processedAt: refund.processedAt,
        })),
    };
};

const buildFulfillmentSummary = (items = [], shippedMap = new Map()) => {
    let totalUnits = 0;
    let shippedUnits = 0;

    for (const item of items) {
        const quantity = Number(item.quantity) || 0;
        const shipped = Math.min(shippedMap.get(String(item._id)) || 0, quantity);
        totalUnits += quantity;
        shippedUnits += shipped;
    }

    const progressPercent =
        totalUnits > 0 ? Math.round((shippedUnits / totalUnits) * 100) : 0;

    return {
        totalUnits,
        shippedUnits,
        remainingUnits: Math.max(0, totalUnits - shippedUnits),
        progressPercent,
        isFullyShipped: totalUnits > 0 && shippedUnits >= totalUnits,
    };
};

const buildOrderActions = (masterOrder, payment) => ({
    canPay: ["pending", "failed", "processing"].includes(masterOrder.paymentStatus),
    canTrack: [
        "partially_shipped",
        "shipped",
        "partially_delivered",
        "delivered",
    ].includes(masterOrder.status),
    requiresPayment: masterOrder.paymentStatus !== "successful",
    paymentMethod: payment?.paymentMethod || null,
    paymentId: payment?._id || masterOrder.checkoutPaymentId || null,
});

const getShippedQtyMaps = async (companyOrderIds = []) => {
    if (!companyOrderIds.length) return new Map();

    const rows = await MarketplaceShipmentItem.aggregate([
        {
            $match: {
                companyOrderId: { $in: companyOrderIds.map(toObjectId) },
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

const getShipmentSummariesByCompany = async (masterOrderId) => {
    const shipments = await MarketplaceShipment.find({
        masterOrderId: toObjectId(masterOrderId),
        ...NOT_DELETED,
    })
        .sort({ createdAt: -1 })
        .lean();

    if (!shipments.length) return new Map();

    const shipmentIds = shipments.map((shipment) => shipment._id);
    const shipmentItems = await MarketplaceShipmentItem.find({
        shipmentId: { $in: shipmentIds },
        ...NOT_DELETED,
    }).lean();

    const itemCountByShipment = new Map();
    for (const item of shipmentItems) {
        const key = String(item.shipmentId);
        itemCountByShipment.set(key, (itemCountByShipment.get(key) || 0) + 1);
    }

    const byCompany = new Map();
    for (const shipment of shipments) {
        const key = String(shipment.companyOrderId);
        if (!byCompany.has(key)) byCompany.set(key, []);
        byCompany
            .get(key)
            .push(
                formatCustomerShipment(
                    shipment,
                    itemCountByShipment.get(String(shipment._id)) || 0
                )
            );
    }

    return byCompany;
};

const getCustomerOrderDetail = async (masterOrderId, userId) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        userId: toObjectId(userId),
        ...NOT_DELETED,
    }).lean();

    if (!masterOrder) throw new AppError("Order not found.", 404);

    const [companyOrders, orderItems, payment, refunds] = await Promise.all([
        CompanyOrder.find({ masterOrderId: masterOrder._id, ...NOT_DELETED })
            .sort({ createdAt: 1 })
            .lean(),
        MarketplaceOrderItem.find({ masterOrderId: masterOrder._id, ...NOT_DELETED }).lean(),
        CheckoutPayment.findOne({
            masterOrderId: masterOrder._id,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
        MarketplaceRefund.find({
            masterOrderId: masterOrder._id,
            userId: toObjectId(userId),
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    const companyOrderIds = companyOrders.map((order) => order._id);
    const [shippedMaps, shipmentsByCompany] = await Promise.all([
        getShippedQtyMaps(companyOrderIds),
        getShipmentSummariesByCompany(masterOrder._id),
    ]);

    const itemsByCompanyOrder = new Map();
    for (const item of orderItems) {
        const key = String(item.companyOrderId);
        if (!itemsByCompanyOrder.has(key)) itemsByCompanyOrder.set(key, []);
        itemsByCompanyOrder.get(key).push(item);
    }

    const refundsByCompany = new Map();
    for (const refund of refunds) {
        const key = refund.companyOrderId ? String(refund.companyOrderId) : "_master";
        if (!refundsByCompany.has(key)) refundsByCompany.set(key, []);
        refundsByCompany.get(key).push(refund);
    }

    const formattedCompanyOrders = companyOrders.map((order) => {
        const companyKey = String(order._id);
        const items = itemsByCompanyOrder.get(companyKey) || [];
        const shippedMap = shippedMaps.get(companyKey) || new Map();
        const companyRefunds = refundsByCompany.get(companyKey) || [];

        return {
            id: order._id,
            orderNumber: order.orderNumber,
            companyId: order.companyId,
            seller: order.seller,
            sellerName: sellerLabel(order.seller),
            status: order.status,
            totals: order.totals,
            itemCount: order.itemCount,
            shippingAddress: order.shippingAddress,
            shippingRuleId: order.shippingRuleId,
            estimatedDeliveryAt: order.estimatedDeliveryAt,
            confirmedAt: order.confirmedAt,
            shippedAt: order.shippedAt,
            deliveredAt: order.deliveredAt,
            items: items.map((item) =>
                formatCustomerOrderItem(item, shippedMap.get(String(item._id)) || 0)
            ),
            fulfillment: buildFulfillmentSummary(items, shippedMap),
            shipments: shipmentsByCompany.get(companyKey) || [],
            refunds: formatRefundSummary(companyRefunds),
        };
    });

    return {
        masterOrder: {
            id: masterOrder._id,
            orderNumber: masterOrder.orderNumber,
            status: masterOrder.status,
            paymentStatus: masterOrder.paymentStatus,
            currency: masterOrder.currency,
            totals: masterOrder.totals,
            shippingAddress: masterOrder.shippingAddress,
            customerNote: masterOrder.customerNote,
            companyOrderCount: masterOrder.companyOrderCount,
            checkoutPaymentId: masterOrder.checkoutPaymentId,
            placedAt: masterOrder.placedAt,
            inventoryReservedAt: masterOrder.inventoryReservedAt,
            createdAt: masterOrder.createdAt,
        },
        payment: formatPaymentSummary(payment),
        refunds: formatRefundSummary(refunds),
        actions: buildOrderActions(masterOrder, payment),
        companyOrders: formattedCompanyOrders,
        sellers: formattedCompanyOrders.map((order) => ({
            companyId: order.companyId,
            sellerName: order.sellerName,
            logoUrl: order.seller?.logoUrl || "",
            status: order.status,
        })),
    };
};

const listMasterOrders = async (userId, query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "customer",
    });

    const filter = { userId: toObjectId(userId), ...NOT_DELETED };
    if (query.status) {
        if (!MASTER_ORDER_STATUSES.includes(query.status)) {
            throw new AppError("Invalid order status filter.", 400);
        }
        filter.status = query.status;
    }
    if (query.paymentStatus) {
        if (!CHECKOUT_PAYMENT_STATUSES.includes(query.paymentStatus)) {
            throw new AppError("Invalid payment status filter.", 400);
        }
        filter.paymentStatus = query.paymentStatus;
    }
    if (query.search) {
        const term = String(query.search).trim();
        if (term) {
            filter.orderNumber = { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        }
    }

    const [orders, total] = await Promise.all([
        MasterOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select(
                "orderNumber status paymentStatus currency totals companyOrderCount placedAt createdAt"
            )
            .lean(),
        MasterOrder.countDocuments(filter),
    ]);

    const masterIds = orders.map((order) => order._id);
    const companyOrders = masterIds.length
        ? await CompanyOrder.find({
              masterOrderId: { $in: masterIds },
              ...NOT_DELETED,
          })
              .select("masterOrderId seller status itemCount totals")
              .lean()
        : [];

    const sellersByMaster = new Map();
    for (const companyOrder of companyOrders) {
        const key = String(companyOrder.masterOrderId);
        if (!sellersByMaster.has(key)) sellersByMaster.set(key, []);
        sellersByMaster.get(key).push({
            companyId: companyOrder.companyId,
            sellerName: sellerLabel(companyOrder.seller),
            logoUrl: companyOrder.seller?.logoUrl || "",
            status: companyOrder.status,
            itemCount: companyOrder.itemCount,
        });
    }

    return {
        data: orders.map((order) => ({
            id: order._id,
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            currency: order.currency,
            totals: order.totals,
            companyOrderCount: order.companyOrderCount,
            placedAt: order.placedAt,
            createdAt: order.createdAt,
            sellers: sellersByMaster.get(String(order._id)) || [],
            canPay: ["pending", "failed", "processing"].includes(order.paymentStatus),
            canTrack: [
                "partially_shipped",
                "shipped",
                "partially_delivered",
                "delivered",
            ].includes(order.status),
        })),
        pagination: buildPagination(total),
    };
};

const getMasterOrder = async (userId, masterOrderId) => {
    const id = toObjectId(masterOrderId);
    if (!id) throw new AppError("Invalid order id.", 400);
    return getCustomerOrderDetail(id, userId);
};

const getCompanyOrder = async (userId, masterOrderId, companyOrderId) => {
    const detail = await getCustomerOrderDetail(masterOrderId, userId);
    const companyOrder = detail.companyOrders.find(
        (order) => String(order.id) === String(companyOrderId)
    );

    if (!companyOrder) throw new AppError("Company order not found.", 404);

    return {
        masterOrder: detail.masterOrder,
        payment: detail.payment,
        actions: detail.actions,
        companyOrder: {
            ...companyOrder,
            placedAt: detail.masterOrder.placedAt,
        },
    };
};

module.exports = {
    getCustomerOrderDetail,
    listMasterOrders,
    getMasterOrder,
    getCompanyOrder,
    formatCustomerOrderItem,
    formatCustomerShipment,
    buildFulfillmentSummary,
};
