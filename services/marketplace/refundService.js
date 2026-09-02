const mongoose = require("mongoose");
const MarketplaceRefund = require("../../model/marketplace/refund");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const MarketplaceShipmentItem = require("../../model/marketplace/shipmentItem");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    REFUND_SCOPES,
    REFUND_STATUSES,
} = require("../../constants/marketplace");
const { generateMarketplaceRefundCode } = require("../codeGenerator");
const { companyFilter } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../companyService");
const {
    releaseUnshippedCompanyInventory,
    syncProductsForLines,
} = require("./inventoryReservationService");
const {
    transitionCompanyOrderStatus,
    syncMasterOrderStatus,
} = require("./marketplaceOrderStatusService");
const {
    emitStatusNotificationsFromTransition,
    emitMarketplaceNotification,
} = require("./marketplaceNotificationService");
const { auditMarketplaceAction } = require("./marketplaceAuditService");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");

const TERMINAL_REFUND_STATUSES = new Set(["completed", "failed", "cancelled"]);

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const roundMoney = (value) =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const formatRefund = (refund) => ({
    id: refund._id,
    refundNumber: refund.refundNumber,
    checkoutPaymentId: refund.checkoutPaymentId,
    masterOrderId: refund.masterOrderId,
    userId: refund.userId,
    scope: refund.scope,
    companyOrderId: refund.companyOrderId,
    companyId: refund.companyId,
    orderItemId: refund.orderItemId,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    providerRefundId: refund.providerRefundId,
    processedAt: refund.processedAt,
    processedBy: refund.processedBy,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
});

const getShippedQtyMap = async (companyOrderId) => {
    const rows = await MarketplaceShipmentItem.aggregate([
        {
            $match: {
                companyOrderId: toObjectId(companyOrderId),
                isDeleted: { $ne: true },
            },
        },
        {
            $group: {
                _id: "$orderItemId",
                shippedQty: { $sum: "$quantity" },
            },
        },
    ]);

    return new Map(rows.map((row) => [String(row._id), row.shippedQty]));
};

const getCompletedRefundTotal = async ({
    checkoutPaymentId,
    companyOrderId = null,
    orderItemId = null,
    excludeRefundId = null,
}) => {
    const filter = {
        checkoutPaymentId: toObjectId(checkoutPaymentId),
        status: "completed",
        ...NOT_DELETED,
    };
    if (companyOrderId) filter.companyOrderId = toObjectId(companyOrderId);
    if (orderItemId) filter.orderItemId = toObjectId(orderItemId);
    if (excludeRefundId) filter._id = { $ne: toObjectId(excludeRefundId) };

    const rows = await MarketplaceRefund.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return roundMoney(rows[0]?.total || 0);
};

const loadPaymentContext = async (masterOrderId) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        ...NOT_DELETED,
    });

    if (!masterOrder) throw new AppError("Master order not found.", 404);
    if (masterOrder.paymentStatus !== "successful") {
        throw new AppError("Only paid orders can be refunded.", 400);
    }

    const payment = await CheckoutPayment.findOne({
        masterOrderId: masterOrder._id,
        status: { $in: ["successful", "partially_refunded"] },
        ...NOT_DELETED,
    }).sort({ createdAt: -1 });

    if (!payment) {
        throw new AppError("Successful checkout payment not found.", 404);
    }

    return { masterOrder, payment };
};

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

const computeItemRefundAmount = (item, refundQty) => {
    const qty = Math.max(Number(refundQty) || 0, 0);
    if (!qty) return 0;
    const unit = Number(item.lineSubtotal) / Number(item.quantity);
    return roundMoney(unit * qty);
};

const resolveRefundAmount = async ({
    scope,
    companyOrder,
    orderItem = null,
    refundQty = 0,
    payment,
}) => {
    if (scope === "order_item") {
        if (!orderItem) throw new AppError("Order item is required.", 400);
        const shippedMap = await getShippedQtyMap(companyOrder._id);
        const shipped = shippedMap.get(String(orderItem._id)) || 0;
        const refundableQty =
            orderItem.quantity -
            shipped -
            (Number(orderItem.refundedQuantity) || 0);

        const qty = Math.min(Math.max(Number(refundQty) || 0, 0), refundableQty);
        if (qty < 1) {
            throw new AppError("No refundable quantity remains for this item.", 400);
        }

        return {
            amount: computeItemRefundAmount(orderItem, qty),
            refundQty: qty,
            lineQuantities: new Map([[String(orderItem._id), qty]]),
        };
    }

    if (scope === "company_order") {
        const alreadyRefunded = await getCompletedRefundTotal({
            checkoutPaymentId: payment._id,
            companyOrderId: companyOrder._id,
        });
        const amount = roundMoney(companyOrder.totals.total - alreadyRefunded);
        if (amount <= 0) {
            throw new AppError("Company order has no refundable balance remaining.", 400);
        }
        return { amount, refundQty: null, lineQuantities: null };
    }

    if (scope === "master_order") {
        const alreadyRefunded = await getCompletedRefundTotal({
            checkoutPaymentId: payment._id,
        });
        const amount = roundMoney(payment.amount - alreadyRefunded);
        if (amount <= 0) {
            throw new AppError("Order has no refundable balance remaining.", 400);
        }
        return { amount, refundQty: null, lineQuantities: null };
    }

    throw new AppError("Invalid refund scope.", 400);
};

const assertRefundAmountWithinPayment = async (payment, amount, excludeRefundId) => {
    const alreadyRefunded = await getCompletedRefundTotal({
        checkoutPaymentId: payment._id,
        excludeRefundId,
    });
    const remaining = roundMoney(payment.amount - alreadyRefunded);
    if (amount > remaining + 0.0001) {
        throw new AppError(
            `Refund amount exceeds remaining refundable balance (${remaining}).`,
            400
        );
    }
};

const createCompanyRefund = async (companyOrderId, payload = {}, companyId, actorId) => {
    const companyOrder = await loadCompanyOrderForTenant(companyOrderId, companyId);
    const { masterOrder, payment } = await loadPaymentContext(companyOrder.masterOrderId);

    if (["cancelled", "refunded"].includes(companyOrder.status)) {
        throw new AppError(`Cannot refund company order in "${companyOrder.status}" status.`, 400);
    }

    const scope = String(payload.scope || "company_order").trim();
    if (!REFUND_SCOPES.includes(scope) || scope === "master_order") {
        throw new AppError("Invalid refund scope for company refund.", 400);
    }

    let orderItem = null;
    if (scope === "order_item") {
        orderItem = await MarketplaceOrderItem.findOne({
            _id: toObjectId(payload.orderItemId),
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        });
        if (!orderItem) throw new AppError("Order item not found.", 404);
    }

    const { amount, refundQty, lineQuantities } = await resolveRefundAmount({
        scope,
        companyOrder,
        orderItem,
        refundQty: payload.quantity,
        payment,
    });

    await assertRefundAmountWithinPayment(payment, amount);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const refundNumber = await generateMarketplaceRefundCode({ session });
        const [refund] = await MarketplaceRefund.create(
            [
                {
                    refundNumber,
                    checkoutPaymentId: payment._id,
                    masterOrderId: masterOrder._id,
                    userId: masterOrder.userId,
                    scope,
                    companyOrderId: companyOrder._id,
                    companyId: companyOrder.companyId,
                    orderItemId: orderItem?._id || null,
                    amount,
                    currency: payment.currency,
                    status: "pending",
                    reason: String(payload.reason || "").trim(),
                    metadata: refundQty
                        ? { quantity: refundQty, orderItemId: orderItem._id }
                        : null,
                },
            ],
            { session }
        );

        await session.commitTransaction();
        return formatRefund(refund.toObject());
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

const completeRefund = async (refundId, payload = {}, companyId, actorId) => {
    const refund = await MarketplaceRefund.findOne({
        _id: toObjectId(refundId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    });

    if (!refund) throw new AppError("Refund not found.", 404);
    if (TERMINAL_REFUND_STATUSES.has(refund.status)) {
        throw new AppError(`Refund is already ${refund.status}.`, 400);
    }

    const payment = await CheckoutPayment.findOne({
        _id: refund.checkoutPaymentId,
        ...NOT_DELETED,
    });
    if (!payment) throw new AppError("Checkout payment not found.", 404);

    await assertRefundAmountWithinPayment(payment, refund.amount, refund._id);

    const masterOrder = await MasterOrder.findOne({
        _id: refund.masterOrderId,
        ...NOT_DELETED,
    });
    if (!masterOrder) throw new AppError("Master order not found.", 404);

    const companyOrder = refund.companyOrderId
        ? await CompanyOrder.findOne({
              _id: refund.companyOrderId,
              ...NOT_DELETED,
          })
        : null;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        refund.status = "processing";
        await refund.save({ session });

        const shippedMap = companyOrder
            ? await getShippedQtyMap(companyOrder._id)
            : new Map();

        let releasedLines = [];
        if (companyOrder && companyOrder.inventoryReservedAt) {
            const lineQuantities =
                refund.scope === "order_item" && refund.orderItemId
                    ? new Map([
                          [
                              String(refund.orderItemId),
                              refund.metadata?.quantity ||
                                  (await MarketplaceOrderItem.findById(
                                      refund.orderItemId
                                  ).session(session))?.quantity ||
                                  0,
                          ],
                      ])
                    : null;

            releasedLines = await releaseUnshippedCompanyInventory({
                companyOrder,
                shippedQtyMap: shippedMap,
                lineQuantities,
                session,
            });
        }

        payment.refundedAmount = roundMoney(
            (Number(payment.refundedAmount) || 0) + refund.amount
        );
        if (payment.refundedAmount >= payment.amount - 0.0001) {
            payment.status = "refunded";
            masterOrder.paymentStatus = "refunded";
        } else {
            payment.status = "partially_refunded";
            masterOrder.paymentStatus = "partially_refunded";
        }
        await payment.save({ session });
        await masterOrder.save({ session });

        let transitionResult = null;
        if (companyOrder && companyOrder.status !== "refunded") {
            const companyRefundedTotal = await getCompletedRefundTotal({
                checkoutPaymentId: payment._id,
                companyOrderId: companyOrder._id,
                excludeRefundId: refund._id,
            });
            const willBeFullyRefunded =
                roundMoney(companyRefundedTotal + refund.amount) >=
                roundMoney(companyOrder.totals.total) - 0.0001;

            if (willBeFullyRefunded) {
                transitionResult = await transitionCompanyOrderStatus(
                    companyOrder,
                    "refunded",
                    { session, allowSystem: true, reason: refund.reason }
                );
            }
        }

        await syncMasterOrderStatus(masterOrder._id, { session });

        refund.status = "completed";
        refund.processedAt = new Date();
        refund.processedBy = toObjectId(actorId);
        refund.providerRefundId = String(payload.providerRefundId || "").trim();
        await refund.save({ session });

        await session.commitTransaction();

        if (releasedLines.length) {
            const items = companyOrder
                ? await MarketplaceOrderItem.find({
                      companyOrderId: companyOrder._id,
                      ...NOT_DELETED,
                  })
                : [];
            await syncProductsForLines(items);
        }

        void emitStatusNotificationsFromTransition(transitionResult);
        void emitMarketplaceNotification({
            userId: refund.userId,
            category: "payment",
            eventType: "refund_completed",
            title: "Refund processed",
            body: `Refund ${refund.refundNumber} of ${refund.amount} ${refund.currency} was processed.`,
            masterOrderId: refund.masterOrderId,
            companyOrderId: refund.companyOrderId,
            companyId: refund.companyId,
            metadata: {
                refundNumber: refund.refundNumber,
                amount: refund.amount,
                scope: refund.scope,
            },
        });
        void auditMarketplaceAction({
            actor: { _id: actorId, role: "admin", companyId },
            companyId,
            activityType: "Refund",
            subModule: "MarketplaceRefund",
            description: `Marketplace refund ${refund.refundNumber} completed.`,
            referenceType: "MarketplaceRefund",
            referenceId: refund._id,
            newData: {
                refundNumber: refund.refundNumber,
                amount: refund.amount,
                scope: refund.scope,
            },
            securityLevel: "Critical",
        });

        return formatRefund(refund.toObject());
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

const cancelRefund = async (refundId, companyId) => {
    const refund = await MarketplaceRefund.findOne({
        _id: toObjectId(refundId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    });

    if (!refund) throw new AppError("Refund not found.", 404);
    if (refund.status !== "pending") {
        throw new AppError(`Only pending refunds can be cancelled.`, 400);
    }

    refund.status = "cancelled";
    await refund.save();
    return formatRefund(refund.toObject());
};

const getRefundByIdForCompany = async (refundId, companyId) => {
    const refund = await MarketplaceRefund.findOne({
        _id: toObjectId(refundId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    }).lean();

    if (!refund) throw new AppError("Refund not found.", 404);
    return formatRefund(refund);
};

const listCompanyRefunds = async (companyOrderId, companyId, query = {}) => {
    await loadCompanyOrderForTenant(companyOrderId, companyId);

    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "company",
    });

    const filter = {
        companyOrderId: toObjectId(companyOrderId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    };
    if (query.status) filter.status = query.status;

    const [rows, total] = await Promise.all([
        MarketplaceRefund.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MarketplaceRefund.countDocuments(filter),
    ]);

    return {
        data: rows.map(formatRefund),
        pagination: buildPagination(total),
    };
};

const listMasterOrderRefundsForUser = async (userId, masterOrderId, query = {}) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        userId: toObjectId(userId),
        ...NOT_DELETED,
    }).lean();

    if (!masterOrder) throw new AppError("Order not found.", 404);

    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "customer",
    });

    const filter = {
        masterOrderId: masterOrder._id,
        userId: toObjectId(userId),
        ...NOT_DELETED,
    };
    if (query.status) filter.status = query.status;

    const [rows, total] = await Promise.all([
        MarketplaceRefund.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MarketplaceRefund.countDocuments(filter),
    ]);

    return {
        data: rows.map(formatRefund),
        pagination: buildPagination(total),
    };
};

const listAllRefundsForCompany = async (companyId, query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "company",
    });

    const filter = {
        ...companyFilter(companyId),
        ...NOT_DELETED,
    };
    if (query.status) filter.status = query.status;

    const [rows, total] = await Promise.all([
        MarketplaceRefund.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MarketplaceRefund.countDocuments(filter),
    ]);

    return {
        data: rows.map(formatRefund),
        pagination: buildPagination(total),
    };
};

const getRefundForUser = async (userId, refundId) => {
    const refund = await MarketplaceRefund.findOne({
        _id: toObjectId(refundId),
        userId: toObjectId(userId),
        ...NOT_DELETED,
    }).lean();

    if (!refund) throw new AppError("Refund not found.", 404);
    return formatRefund(refund);
};

module.exports = {
    createCompanyRefund,
    completeRefund,
    cancelRefund,
    getRefundByIdForCompany,
    listCompanyRefunds,
    listAllRefundsForCompany,
    listMasterOrderRefundsForUser,
    getRefundForUser,
    formatRefund,
};
