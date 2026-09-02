const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const MarketplaceRefund = require("../../model/marketplace/refund");
const Company = require("../../model/company");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    MASTER_ORDER_STATUSES,
    CHECKOUT_PAYMENT_STATUSES,
} = require("../../constants/marketplace");
const { getCustomerOrderDetail } = require("./marketplaceOrderService");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const escapeRegex = (value) =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startOfDay = (ref = new Date()) =>
    new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

const parseDateBound = (value, endOfDay = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date;
};

const sumTotalsByCurrency = (rows = []) =>
    rows.map((row) => ({
        currency: String(row._id || "BDT").toUpperCase(),
        total: Number(row.total || 0),
        count: Number(row.count || 0),
    }));

const getPlatformDashboard = async () => {
    const todayStart = startOfDay();

    const [
        orderStatusRows,
        paymentStatusRows,
        todayOrders,
        todayPayments,
        gmvRows,
        refundRows,
        topCompanies,
        pendingFulfillment,
    ] = await Promise.all([
        MasterOrder.aggregate([
            { $match: { ...NOT_DELETED } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        CheckoutPayment.aggregate([
            { $match: { ...NOT_DELETED } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        MasterOrder.countDocuments({
            ...NOT_DELETED,
            placedAt: { $gte: todayStart },
        }),
        CheckoutPayment.countDocuments({
            ...NOT_DELETED,
            status: "successful",
            paidAt: { $gte: todayStart },
        }),
        CheckoutPayment.aggregate([
            {
                $match: {
                    ...NOT_DELETED,
                    status: { $in: ["successful", "partially_refunded", "refunded"] },
                },
            },
            {
                $group: {
                    _id: "$currency",
                    total: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]),
        MarketplaceRefund.aggregate([
            { $match: { ...NOT_DELETED, status: "completed" } },
            {
                $group: {
                    _id: "$currency",
                    total: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]),
        CompanyOrder.aggregate([
            { $match: { ...NOT_DELETED } },
            {
                $group: {
                    _id: "$companyId",
                    orderCount: { $sum: 1 },
                    revenue: { $sum: "$totals.total" },
                },
            },
            { $sort: { orderCount: -1 } },
            { $limit: 10 },
        ]),
        CompanyOrder.countDocuments({
            ...NOT_DELETED,
            status: {
                $in: ["confirmed", "processing", "packed", "partially_shipped"],
            },
        }),
    ]);

    const totalOrders = await MasterOrder.countDocuments({ ...NOT_DELETED });
    const totalPayments = await CheckoutPayment.countDocuments({ ...NOT_DELETED });

    const companyIds = topCompanies.map((row) => row._id).filter(Boolean);
    const companies = companyIds.length
        ? await Company.find({ _id: { $in: companyIds } })
              .select("tradeName legalName companyCode status")
              .lean()
        : [];
    const companyMap = new Map(companies.map((row) => [String(row._id), row]));

    return {
        orders: {
            total: totalOrders,
            today: todayOrders,
            byStatus: Object.fromEntries(
                orderStatusRows.map((row) => [row._id, row.count])
            ),
        },
        payments: {
            total: totalPayments,
            successfulToday: todayPayments,
            byStatus: Object.fromEntries(
                paymentStatusRows.map((row) => [row._id, row.count])
            ),
            gmv: sumTotalsByCurrency(gmvRows),
        },
        refunds: {
            completed: sumTotalsByCurrency(refundRows),
        },
        operations: {
            pendingFulfillment: pendingFulfillment,
        },
        topCompanies: topCompanies.map((row) => {
            const company = companyMap.get(String(row._id));
            return {
                companyId: row._id,
                companyName:
                    company?.tradeName || company?.legalName || company?.companyCode || "",
                companyStatus: company?.status || "",
                orderCount: row.orderCount,
                revenue: row.revenue,
            };
        }),
    };
};

const buildMasterOrderListFilter = async (query = {}) => {
    const filter = { ...NOT_DELETED };

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
        const term = escapeRegex(query.search.trim());
        if (term) {
            filter.orderNumber = { $regex: term, $options: "i" };
        }
    }

    const dateFrom = parseDateBound(query.dateFrom);
    const dateTo = parseDateBound(query.dateTo, true);
    if (dateFrom || dateTo) {
        filter.placedAt = {};
        if (dateFrom) filter.placedAt.$gte = dateFrom;
        if (dateTo) filter.placedAt.$lte = dateTo;
    }

    const companyId = toObjectId(query.companyId);
    if (companyId) {
        const masterIds = await CompanyOrder.distinct("masterOrderId", {
            companyId,
            ...NOT_DELETED,
        });
        filter._id = { $in: masterIds };
    }

    return filter;
};

const listPlatformOrders = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "platform",
    });
    const filter = await buildMasterOrderListFilter(query);

    const [orders, total] = await Promise.all([
        MasterOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select(
                "orderNumber userId status paymentStatus currency totals companyOrderCount placedAt createdAt"
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
              .select("masterOrderId companyId seller status totals itemCount orderNumber")
              .lean()
        : [];

    const sellersByMaster = new Map();
    for (const row of companyOrders) {
        const key = String(row.masterOrderId);
        if (!sellersByMaster.has(key)) sellersByMaster.set(key, []);
        sellersByMaster.get(key).push({
            companyOrderId: row._id,
            companyOrderNumber: row.orderNumber,
            companyId: row.companyId,
            sellerName: row.seller?.tradeName || row.seller?.legalName || "",
            status: row.status,
            itemCount: row.itemCount,
            total: row.totals?.total || 0,
        });
    }

    return {
        data: orders.map((order) => ({
            id: order._id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            currency: order.currency,
            totals: order.totals,
            companyOrderCount: order.companyOrderCount,
            placedAt: order.placedAt,
            createdAt: order.createdAt,
            sellers: sellersByMaster.get(String(order._id)) || [],
        })),
        pagination: buildPagination(total),
    };
};

const getPlatformOrder = async (masterOrderId) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        ...NOT_DELETED,
    }).lean();

    if (!masterOrder) throw new AppError("Master order not found.", 404);

    return getCustomerOrderDetail(masterOrder._id, masterOrder.userId);
};

const listPlatformPayments = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "platform",
    });

    const filter = { ...NOT_DELETED };
    if (query.status) {
        if (!CHECKOUT_PAYMENT_STATUSES.includes(query.status)) {
            throw new AppError("Invalid payment status filter.", 400);
        }
        filter.status = query.status;
    }
    if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
    if (query.search) {
        const term = escapeRegex(query.search.trim());
        if (term) {
            filter.paymentNumber = { $regex: term, $options: "i" };
        }
    }

    const dateFrom = parseDateBound(query.dateFrom);
    const dateTo = parseDateBound(query.dateTo, true);
    if (dateFrom || dateTo) {
        filter.createdAt = {};
        if (dateFrom) filter.createdAt.$gte = dateFrom;
        if (dateTo) filter.createdAt.$lte = dateTo;
    }

    const [payments, total] = await Promise.all([
        CheckoutPayment.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        CheckoutPayment.countDocuments(filter),
    ]);

    const masterIds = [...new Set(payments.map((row) => String(row.masterOrderId)))];
    const masters = masterIds.length
        ? await MasterOrder.find({ _id: { $in: masterIds }, ...NOT_DELETED })
              .select("orderNumber status paymentStatus")
              .lean()
        : [];
    const masterMap = new Map(masters.map((row) => [String(row._id), row]));

    return {
        data: payments.map((payment) => ({
            id: payment._id,
            paymentNumber: payment.paymentNumber,
            masterOrderId: payment.masterOrderId,
            masterOrderNumber:
                masterMap.get(String(payment.masterOrderId))?.orderNumber || "",
            userId: payment.userId,
            amount: payment.amount,
            refundedAmount: payment.refundedAmount || 0,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            paymentProvider: payment.paymentProvider,
            status: payment.status,
            paidAt: payment.paidAt,
            failedAt: payment.failedAt,
            createdAt: payment.createdAt,
        })),
        pagination: buildPagination(total),
    };
};

const getPlatformPayment = async (paymentId) => {
    const payment = await CheckoutPayment.findOne({
        _id: toObjectId(paymentId),
        ...NOT_DELETED,
    }).lean();

    if (!payment) throw new AppError("Payment not found.", 404);

    const [masterOrder, refunds] = await Promise.all([
        MasterOrder.findById(payment.masterOrderId).lean(),
        MarketplaceRefund.find({
            checkoutPaymentId: payment._id,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    return {
        payment: {
            id: payment._id,
            paymentNumber: payment.paymentNumber,
            masterOrderId: payment.masterOrderId,
            userId: payment.userId,
            amount: payment.amount,
            refundedAmount: payment.refundedAmount || 0,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            paymentProvider: payment.paymentProvider,
            status: payment.status,
            providerPaymentIntentId: payment.providerPaymentIntentId,
            providerTransactionId: payment.providerTransactionId,
            paidAt: payment.paidAt,
            failedAt: payment.failedAt,
            failureReason: payment.failureReason || "",
            createdAt: payment.createdAt,
        },
        masterOrder: masterOrder
            ? {
                  id: masterOrder._id,
                  orderNumber: masterOrder.orderNumber,
                  status: masterOrder.status,
                  paymentStatus: masterOrder.paymentStatus,
                  totals: masterOrder.totals,
              }
            : null,
        refunds: refunds.map((refund) => ({
            id: refund._id,
            refundNumber: refund.refundNumber,
            scope: refund.scope,
            amount: refund.amount,
            status: refund.status,
            companyOrderId: refund.companyOrderId,
            companyId: refund.companyId,
            createdAt: refund.createdAt,
            processedAt: refund.processedAt,
        })),
    };
};

const listPlatformRefunds = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "platform",
    });

    const filter = { ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    if (query.companyId) filter.companyId = toObjectId(query.companyId);

    const [refunds, total] = await Promise.all([
        MarketplaceRefund.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MarketplaceRefund.countDocuments(filter),
    ]);

    return {
        data: refunds.map((refund) => ({
            id: refund._id,
            refundNumber: refund.refundNumber,
            masterOrderId: refund.masterOrderId,
            companyOrderId: refund.companyOrderId,
            companyId: refund.companyId,
            userId: refund.userId,
            scope: refund.scope,
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
            reason: refund.reason,
            createdAt: refund.createdAt,
            processedAt: refund.processedAt,
        })),
        pagination: buildPagination(total),
    };
};

module.exports = {
    getPlatformDashboard,
    listPlatformOrders,
    getPlatformOrder,
    listPlatformPayments,
    getPlatformPayment,
    listPlatformRefunds,
};
