const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    CHECKOUT_PAYMENT_METHODS,
    CHECKOUT_PAYMENT_PROVIDERS,
} = require("../../constants/marketplace");
const { generateMarketplacePaymentCode } = require("../codeGenerator");
const { formatPlacedOrderResponse } = require("./checkoutService");
const {
    reserveMasterOrderInventory,
    syncProductsForLines,
} = require("./inventoryReservationService");
const {
    transitionCompanyOrderStatus,
    syncMasterOrderStatus,
} = require("./marketplaceOrderStatusService");
const {
    notifyPaymentSuccessful,
    notifyPaymentFailed,
} = require("./marketplaceNotificationService");
const {
    verifyMarketplaceWebhook,
    buildWebhookEventKey,
    hasProcessedWebhookEvent,
    appendProcessedWebhookEvent,
    mapStripeEventToPayload,
} = require("./marketplaceSecurityService");
const { auditMarketplaceAction } = require("./marketplaceAuditService");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const DEFAULT_PROVIDER_BY_METHOD = {
    cod: "manual",
    card: "stripe",
    mobile_wallet: "bkash",
    bank_transfer: "manual",
    gateway: "sslcommerz",
    other: "other",
};

const TERMINAL_PAYMENT_STATUSES = new Set([
    "successful",
    "failed",
    "cancelled",
    "refunded",
    "partially_refunded",
]);

const syncOrderProducts = async (masterOrderId) => {
    const items = await MarketplaceOrderItem.find({
        masterOrderId,
        ...NOT_DELETED,
    });
    await syncProductsForLines(items);
};

const dispatchPaymentNotification = async (payment, outcome, reason = "") => {
    const masterOrder = await MasterOrder.findById(payment.masterOrderId).lean();
    if (!masterOrder) return;

    if (outcome === "success") {
        void notifyPaymentSuccessful({
            userId: payment.userId,
            masterOrder,
            payment,
        });
        return;
    }

    void notifyPaymentFailed({
        userId: payment.userId,
        masterOrder,
        payment,
        reason,
    });
};

const resolveProvider = (paymentMethod, paymentProvider) => {
    const provider = String(paymentProvider || "").trim().toLowerCase();
    if (provider && CHECKOUT_PAYMENT_PROVIDERS.includes(provider)) {
        return provider;
    }
    return DEFAULT_PROVIDER_BY_METHOD[paymentMethod] || "manual";
};

const loadMasterOrderForPayment = async (userId, masterOrderId) => {
    const id = toObjectId(masterOrderId);
    if (!id) throw new AppError("Invalid master order id.", 400);

    const masterOrder = await MasterOrder.findOne({
        _id: id,
        userId,
        ...NOT_DELETED,
    });

    if (!masterOrder) throw new AppError("Order not found.", 404);
    if (masterOrder.status === "cancelled") {
        throw new AppError("Order is cancelled.", 400);
    }
    if (masterOrder.paymentStatus === "successful") {
        throw new AppError("Order is already paid.", 400);
    }

    return masterOrder;
};

const formatPaymentResponse = (payment, masterOrder = null) => ({
    payment: {
        id: payment._id,
        paymentNumber: payment.paymentNumber,
        masterOrderId: payment.masterOrderId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        paymentProvider: payment.paymentProvider,
        status: payment.status,
        providerPaymentIntentId: payment.providerPaymentIntentId || "",
        providerTransactionId: payment.providerTransactionId || "",
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        failureReason: payment.failureReason || "",
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
    nextAction:
        payment.paymentMethod === "cod" && payment.status === "pending"
            ? "confirm_cod"
            : payment.status === "processing"
              ? "await_gateway"
              : null,
});

const applySuccessfulPayment = async (payment, session) => {
    if (payment.status === "successful") {
        await reserveMasterOrderInventory(payment.masterOrderId, session);
        return payment;
    }

    const claimed = await CheckoutPayment.findOneAndUpdate(
        {
            _id: payment._id,
            status: { $in: ["pending", "processing"] },
            ...NOT_DELETED,
        },
        { $set: { status: "processing" } },
        { session, new: true }
    );

    if (!claimed) {
        const current = await CheckoutPayment.findById(payment._id).session(session);
        if (current?.status === "successful") {
            await reserveMasterOrderInventory(payment.masterOrderId, session);
            return current;
        }
        throw new AppError(
            `Payment cannot be completed from status "${current?.status || "unknown"}".`,
            409
        );
    }

    payment = claimed;

    await reserveMasterOrderInventory(payment.masterOrderId, session);

    payment.status = "successful";
    payment.paidAt = new Date();
    payment.failedAt = null;
    payment.failureReason = "";
    await payment.save({ session });

    await MasterOrder.updateOne(
        { _id: payment.masterOrderId },
        {
            $set: {
                paymentStatus: "successful",
                checkoutPaymentId: payment._id,
                inventoryReservedAt: new Date(),
            },
        },
        { session }
    );

    const pendingCompanyOrders = await CompanyOrder.find({
        masterOrderId: payment.masterOrderId,
        status: "pending",
        ...NOT_DELETED,
    }).session(session);

    for (const companyOrder of pendingCompanyOrders) {
        await transitionCompanyOrderStatus(companyOrder, "confirmed", {
            session,
            allowSystem: true,
        });
    }

    await syncMasterOrderStatus(payment.masterOrderId, { session });

    return payment;
};

const applyFailedPayment = async (payment, reason = "", session) => {
    if (TERMINAL_PAYMENT_STATUSES.has(payment.status)) return payment;

    const claimed = await CheckoutPayment.findOneAndUpdate(
        {
            _id: payment._id,
            status: { $in: ["pending", "processing"] },
            ...NOT_DELETED,
        },
        { $set: { status: "processing" } },
        { session, new: true }
    );

    if (!claimed) return payment;
    payment = claimed;

    payment.status = "failed";
    payment.failedAt = new Date();
    payment.failureReason = String(reason || "Payment failed").trim();
    await payment.save({ session });

    await MasterOrder.updateOne(
        { _id: payment.masterOrderId },
        { $set: { paymentStatus: "failed" } },
        { session }
    );

    return payment;
};

const initiatePayment = async (userId, payload = {}) => {
    const masterOrderId = payload.masterOrderId;
    const paymentMethod = String(payload.paymentMethod || "").trim().toLowerCase();
    const idempotencyKey = String(payload.idempotencyKey || "").trim();

    if (!paymentMethod || !CHECKOUT_PAYMENT_METHODS.includes(paymentMethod)) {
        throw new AppError("Invalid payment method.", 400);
    }

    if (idempotencyKey) {
        const existingByKey = await CheckoutPayment.findOne({
            idempotencyKey,
            userId,
            ...NOT_DELETED,
        }).lean();

        if (existingByKey) {
            const masterOrder = await MasterOrder.findById(
                existingByKey.masterOrderId
            ).lean();
            return formatPaymentResponse(existingByKey, masterOrder);
        }
    }

    const masterOrder = await loadMasterOrderForPayment(userId, masterOrderId);

    if (masterOrder.checkoutPaymentId) {
        const existing = await CheckoutPayment.findOne({
            _id: masterOrder.checkoutPaymentId,
            ...NOT_DELETED,
        });

        if (existing && !["failed", "cancelled"].includes(existing.status)) {
            return formatPaymentResponse(existing, masterOrder);
        }
    }

    const amount = Number(masterOrder.totals?.total) || 0;
    if (amount <= 0) {
        throw new AppError("Order total must be greater than zero.", 400);
    }

    const paymentProvider = resolveProvider(
        paymentMethod,
        payload.paymentProvider
    );

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const paymentNumber = await generateMarketplacePaymentCode({ session });
        const initialStatus = paymentMethod === "cod" ? "pending" : "processing";

        const [payment] = await CheckoutPayment.create(
            [
                {
                    paymentNumber,
                    masterOrderId: masterOrder._id,
                    userId,
                    amount,
                    currency: masterOrder.currency,
                    paymentMethod,
                    paymentProvider,
                    status: initialStatus,
                    ...(idempotencyKey ? { idempotencyKey } : {}),
                    providerPaymentIntentId:
                        paymentMethod === "cod"
                            ? ""
                            : `stub_intent_${paymentNumber}`,
                    metadata: payload.metadata || null,
                },
            ],
            { session }
        );

        masterOrder.checkoutPaymentId = payment._id;
        masterOrder.paymentStatus =
            initialStatus === "pending" ? "pending" : "processing";
        await masterOrder.save({ session });

        await session.commitTransaction();
        return formatPaymentResponse(payment, masterOrder);
    } catch (error) {
        await session.abortTransaction();

        if (error?.code === 11000 && idempotencyKey) {
            const existing = await CheckoutPayment.findOne({
                idempotencyKey,
                userId,
                ...NOT_DELETED,
            }).lean();
            if (existing) {
                const masterOrder = await MasterOrder.findById(
                    existing.masterOrderId
                ).lean();
                return formatPaymentResponse(existing, masterOrder);
            }
        }

        throw error;
    } finally {
        session.endSession();
    }
};

const confirmPayment = async (userId, payload = {}, context = {}) => {
    const paymentId = toObjectId(payload.paymentId);
    const masterOrderId = toObjectId(payload.masterOrderId);

    if (!paymentId && !masterOrderId) {
        throw new AppError("paymentId or masterOrderId is required.", 400);
    }

    const filter = { userId, ...NOT_DELETED };
    if (paymentId) filter._id = paymentId;
    if (masterOrderId) filter.masterOrderId = masterOrderId;

    const payment = await CheckoutPayment.findOne(filter);
    if (!payment) throw new AppError("Payment not found.", 404);

    if (payment.status === "successful") {
        const masterOrder = await MasterOrder.findById(payment.masterOrderId);
        const order = await formatPlacedOrderResponse(
            payment.masterOrderId,
            userId
        );
        return {
            ...formatPaymentResponse(payment, masterOrder),
            order,
        };
    }

    if (payment.paymentMethod !== "cod") {
        throw new AppError(
            "Only COD payments can be confirmed through this endpoint.",
            400
        );
    }

    if (!["pending", "processing"].includes(payment.status)) {
        throw new AppError(`Payment is "${payment.status}" and cannot be confirmed.`, 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const lockedPayment = await CheckoutPayment.findOne({
            _id: payment._id,
            userId,
            ...NOT_DELETED,
        }).session(session);

        if (!lockedPayment) throw new AppError("Payment not found.", 404);
        await applySuccessfulPayment(lockedPayment, session);
        await session.commitTransaction();
        await syncOrderProducts(lockedPayment.masterOrderId);
        void dispatchPaymentNotification(lockedPayment, "success");
        void auditMarketplaceAction({
            actor: context.actor || { _id: userId },
            activityType: "Payment",
            subModule: "CheckoutPayment",
            description: `Marketplace COD payment ${lockedPayment.paymentNumber} confirmed.`,
            referenceType: "CheckoutPayment",
            referenceId: lockedPayment._id,
            newData: {
                paymentNumber: lockedPayment.paymentNumber,
                masterOrderId: lockedPayment.masterOrderId,
                status: "successful",
            },
            ipAddress: context.ipAddress || "",
            securityLevel: "High",
        });

        const masterOrder = await MasterOrder.findById(lockedPayment.masterOrderId);
        const order = await formatPlacedOrderResponse(
            lockedPayment.masterOrderId,
            userId
        );

        return {
            ...formatPaymentResponse(lockedPayment, masterOrder),
            order,
        };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Gateway webhook handler — signature verification + idempotent status updates.
 */
const handleProviderWebhook = async (provider, payload = {}, context = {}) => {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (!CHECKOUT_PAYMENT_PROVIDERS.includes(normalizedProvider)) {
        throw new AppError("Unknown payment provider.", 400);
    }

    const rawBody =
        context.rawBody ||
        (typeof payload === "string" ? payload : JSON.stringify(payload || {}));

    const verified = verifyMarketplaceWebhook({
        provider: normalizedProvider,
        headers: context.headers || {},
        rawBody,
        body: payload,
    });

    let effectivePayload = { ...(verified.payload || payload) };
    if (verified.event) {
        effectivePayload = {
            ...mapStripeEventToPayload(verified.event),
            ...effectivePayload,
        };
    }

    const paymentId = toObjectId(effectivePayload.paymentId);
    const providerTransactionId = String(
        effectivePayload.providerTransactionId || effectivePayload.transactionId || ""
    ).trim();
    const providerPaymentIntentId = String(
        effectivePayload.providerPaymentIntentId || effectivePayload.paymentIntentId || ""
    ).trim();
    const webhookStatus = String(effectivePayload.status || "").trim().toLowerCase();

    let payment = null;

    if (paymentId) {
        payment = await CheckoutPayment.findOne({
            _id: paymentId,
            paymentProvider: normalizedProvider,
            ...NOT_DELETED,
        });
    } else if (providerPaymentIntentId) {
        payment = await CheckoutPayment.findOne({
            providerPaymentIntentId,
            paymentProvider: normalizedProvider,
            ...NOT_DELETED,
        });
    } else if (providerTransactionId) {
        payment = await CheckoutPayment.findOne({
            providerTransactionId,
            paymentProvider: normalizedProvider,
            ...NOT_DELETED,
        });
    }

    if (!payment) {
        throw new AppError("Payment not found for webhook.", 404);
    }

    const eventKey = buildWebhookEventKey(
        normalizedProvider,
        effectivePayload,
        verified
    );

    if (hasProcessedWebhookEvent(payment, eventKey)) {
        const masterOrder = await MasterOrder.findById(payment.masterOrderId);
        return formatPaymentResponse(payment, masterOrder);
    }

    if (payment.status === "successful") {
        appendProcessedWebhookEvent(payment, eventKey);
        payment.providerResponse = effectivePayload;
        await payment.save();
        return formatPaymentResponse(payment);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const lockedPayment = await CheckoutPayment.findById(payment._id).session(
            session
        );
        if (!lockedPayment) throw new AppError("Payment not found for webhook.", 404);

        if (providerTransactionId) {
            lockedPayment.providerTransactionId = providerTransactionId;
        }
        if (providerPaymentIntentId) {
            lockedPayment.providerPaymentIntentId = providerPaymentIntentId;
        }
        lockedPayment.providerResponse = effectivePayload;
        appendProcessedWebhookEvent(lockedPayment, eventKey);

        if (["successful", "paid", "succeeded"].includes(webhookStatus)) {
            await applySuccessfulPayment(lockedPayment, session);
        } else if (["failed", "cancelled", "canceled"].includes(webhookStatus)) {
            await applyFailedPayment(
                lockedPayment,
                effectivePayload.failureReason ||
                    effectivePayload.message ||
                    "Provider reported failure",
                session
            );
        } else {
            lockedPayment.status = "processing";
            await lockedPayment.save({ session });
        }

        await session.commitTransaction();
        payment = lockedPayment;

        if (["successful", "paid", "succeeded"].includes(webhookStatus)) {
            await syncOrderProducts(payment.masterOrderId);
            void dispatchPaymentNotification(payment, "success");
            void auditMarketplaceAction({
                actor: { _id: payment.userId, role: "customer" },
                activityType: "Payment",
                subModule: "Webhook",
                description: `Marketplace payment ${payment.paymentNumber} confirmed via ${normalizedProvider} webhook.`,
                referenceType: "CheckoutPayment",
                referenceId: payment._id,
                newData: {
                    provider: normalizedProvider,
                    eventKey,
                    status: "successful",
                },
                ipAddress: context.ipAddress || "",
                securityLevel: "Critical",
            });
        } else if (["failed", "cancelled", "canceled"].includes(webhookStatus)) {
            void dispatchPaymentNotification(
                payment,
                "failed",
                effectivePayload.failureReason ||
                    effectivePayload.message ||
                    "Provider reported failure"
            );
            void auditMarketplaceAction({
                actor: { _id: payment.userId, role: "customer" },
                activityType: "Payment",
                subModule: "Webhook",
                description: `Marketplace payment ${payment.paymentNumber} failed via ${normalizedProvider} webhook.`,
                referenceType: "CheckoutPayment",
                referenceId: payment._id,
                newData: {
                    provider: normalizedProvider,
                    eventKey,
                    status: "failed",
                },
                ipAddress: context.ipAddress || "",
                securityLevel: "High",
            });
        }

        const masterOrder = await MasterOrder.findById(payment.masterOrderId);
        return formatPaymentResponse(payment, masterOrder);
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

const getPaymentById = async (userId, paymentId) => {
    const id = toObjectId(paymentId);
    if (!id) throw new AppError("Invalid payment id.", 400);

    const payment = await CheckoutPayment.findOne({
        _id: id,
        userId,
        ...NOT_DELETED,
    }).lean();

    if (!payment) throw new AppError("Payment not found.", 404);

    const masterOrder = await MasterOrder.findById(payment.masterOrderId).lean();
    return formatPaymentResponse(payment, masterOrder);
};

module.exports = {
    initiatePayment,
    confirmPayment,
    handleProviderWebhook,
    getPaymentById,
    applySuccessfulPayment,
    applyFailedPayment,
    formatPaymentResponse,
};
