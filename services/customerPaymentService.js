const mongoose = require("mongoose");
const Payment = require("../model/payment");
const SalesOrder = require("../model/salesOrder");
const Customer = require("../model/customer");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    toMinor,
    toMajor,
    formatMoney,
    assertNotOverpaying,
    assertPositiveMinor,
} = require("../utils/money");
const {
    generatePaymentNumber,
    resolveAmountMinor,
    assertMethodProviderCombo,
    applyStatusTransition,
    auditPayment,
} = require("./paymentFoundationService");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");
const {
    getPaymentProvider,
    PaymentProviderError,
    isStripeConfigured,
    getStripePublishableKey,
} = require("./paymentProviders");
const { markPaid } = require("./salesOrderService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const isOwner = (user) => (user?.role || "").toLowerCase() === "admin";

const mapLegacyMethod = (raw) => {
    const s = String(raw || "")
        .trim()
        .toLowerCase();
    if (!s) return "CARD";
    if (s.includes("cash")) return "CASH";
    if (s.includes("apple")) return "APPLE_PAY";
    if (s.includes("card") || s.includes("visa") || s.includes("master")) {
        return "CARD";
    }
    if (s.includes("ach")) return "ACH";
    if (s.includes("cheque") || s.includes("check")) return "CHECK";
    if (s.includes("bank") || s.includes("transfer")) return "BANK_TRANSFER";
    return String(raw).trim().toUpperCase().replace(/\s+/g, "_");
};

const serializePayment = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    const currency = plain.currency || DEFAULT_CURRENCY;
    return {
        ...plain,
        amounts: {
            amount: toMajor(plain.amountMinor || 0, currency),
            paidAmount: toMajor(plain.paidAmountMinor || 0, currency),
            dueAmount: toMajor(plain.dueAmountMinor || 0, currency),
        },
    };
};

const populatePayment = (q) =>
    q
        .populate(
            "salesOrderId",
            "orderNumber grandTotal paidAmount dueAmount paymentStatus status customerId"
        )
        .populate("createdBy", "firstName lastName email role");

const getPaymentOrFail = async (id, companyId) => {
    const payment = await Payment.findOne({ _id: id, ...NOT_DELETED });
    if (!payment) throw new AppError("Payment not found.", 404);
    assertDocumentCompany(payment, companyId, "Payment");
    if (payment.paymentType !== "CustomerPayment") {
        throw new AppError("Not a customer payment.", 400);
    }
    return payment;
};

const loadSalesOrder = async (salesOrderId, companyId = null) => {
    const order = await SalesOrder.findOne({
        _id: salesOrderId,
        ...NOT_DELETED,
    });
    if (!order) throw new AppError("Sales order not found.", 404);
    if (order.status === "Cancelled") {
        throw new AppError("Cannot checkout a cancelled sales order.", 400);
    }
    if (companyId) {
        const { bindCompanyOrFail } = require("./tenantBind");
        await bindCompanyOrFail(order, companyId, "Sales order");
    }
    return order;
};

const dueMinorOfOrder = (order, currency = DEFAULT_CURRENCY) => {
    const dueMajor =
        order.dueAmount != null
            ? Number(order.dueAmount)
            : Math.max(
                  (Number(order.grandTotal) || 0) -
                      (Number(order.paidAmount) || 0),
                  0
              );
    return toMinor(dueMajor, currency);
};

/**
 * Start Stripe (or manual) checkout against a sales order.
 * CARD / APPLE_PAY → STRIPE PaymentIntent.
 * CASH / BANK_* → NONE (manual complete).
 */
const createCheckout = async (payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const salesOrderId = toObjectId(payload.salesOrderId);
    if (!salesOrderId) throw new AppError("salesOrderId is required.", 400);

    const order = await loadSalesOrder(salesOrderId, companyId);
    const currency = DEFAULT_CURRENCY;
    const dueMinor = dueMinorOfOrder(order, currency);
    if (dueMinor <= 0) {
        throw new AppError("Sales order has no outstanding balance.", 400);
    }

    let { amountMinor, amount } = resolveAmountMinor(
        payload.amount != null || payload.amountMinor != null
            ? payload
            : { amountMinor: dueMinor },
        currency
    );
    assertNotOverpaying(amountMinor, dueMinor, "Customer payment");

    const methodRaw = mapLegacyMethod(
        payload.paymentMethod || payload.method || "CARD"
    );
    let provider = payload.paymentProvider;
    if (!provider) {
        provider =
            methodRaw === "CARD" || methodRaw === "APPLE_PAY" ? "STRIPE" : "NONE";
    }
    const { paymentMethod, paymentProvider } = assertMethodProviderCombo(
        methodRaw,
        provider
    );

    if (paymentProvider === "STRIPE" && !isStripeConfigured()) {
        throw new AppError(
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY.",
            503
        );
    }

    // Avoid duplicate open checkouts for same SO (all providers)
    const open = await Payment.findOne({
        companyId,
        salesOrderId: order._id,
        paymentType: "CustomerPayment",
        ...NOT_DELETED,
        status: { $in: ["draft", "pendingApproval", "approved", "processing"] },
        originalPaymentId: null,
    }).select(
        "paymentNumber status providerPaymentIntentId paymentProvider amountMinor"
    );
    if (open) {
        if (
            open.paymentProvider === "STRIPE" &&
            open.providerPaymentIntentId &&
            paymentProvider === "STRIPE"
        ) {
            const stripe = getPaymentProvider("STRIPE");
            try {
                const status = await stripe.getPaymentStatus(
                    open.providerPaymentIntentId
                );
                if (!status.succeeded && status.status !== "canceled") {
                    return {
                        payment: serializePayment(open),
                        checkout: {
                            provider: "STRIPE",
                            providerPaymentIntentId:
                                open.providerPaymentIntentId,
                            clientSecret: null,
                            publishableKey: getStripePublishableKey(),
                            reused: true,
                            message:
                                "An open checkout already exists for this order. Confirm payment received or cancel it first.",
                        },
                    };
                }
            } catch (_) {
                /* create fresh below if PI is gone */
            }
        }
        throw new AppError(
            `Open checkout ${open.paymentNumber} already exists for this order (status=${open.status}). Complete or cancel it first.`,
            409
        );
    }

    let customer = null;
    if (order.customerId) {
        customer = await Customer.findById(order.customerId)
            .select("fullName name email phone customerCode")
            .lean();
    }

    const paymentNumber = await generatePaymentNumber();
    const payment = await Payment.create({
        companyId,
        branchId: order.branchId || null,
        paymentNumber,
        paymentDate: new Date(),
        paymentType: "CustomerPayment",
        purpose: "againstPayable",
        partyType: "Customer",
        partyId: order.customerId || order._id,
        salesOrderId: order._id,
        currency,
        amountMinor,
        amount,
        paidAmountMinor: 0,
        paidAmount: 0,
        dueAmountMinor: amountMinor,
        dueAmount: amount,
        paymentMethod,
        paymentProvider,
        status: paymentProvider === "STRIPE" ? "processing" : "approved",
        requiresApproval: false,
        requestedBy: user._id,
        createdBy: user._id,
        note: String(payload.note || "").trim().slice(0, 1000),
        sourceModule: "Sales",
        isManualEntry: paymentProvider === "NONE",
        referenceType: "SalesOrder",
        referenceId: order._id,
        allocations: [
            {
                targetType: "SalesOrder",
                targetId: order._id,
                amountMinor,
                note: "customer checkout",
            },
        ],
    });

    let checkout = {
        provider: paymentProvider,
        publishableKey: null,
        clientSecret: null,
        providerPaymentIntentId: null,
        ephemeralKey: null,
        providerCustomerId: null,
    };

    try {
        if (paymentProvider === "STRIPE") {
            const stripe = getPaymentProvider("STRIPE");
            const intent = await stripe.createPayment({
                amountMinor,
                currency,
                customerEmail: customer?.email || payload.email,
                customerName:
                    customer?.fullName ||
                    customer?.name ||
                    payload.customerName,
                description: `SO ${order.orderNumber || order._id}`,
                createEphemeralKey: payload.createEphemeralKey === true,
                metadata: {
                    companyId: String(companyId),
                    paymentId: String(payment._id),
                    paymentNumber: payment.paymentNumber,
                    salesOrderId: String(order._id),
                    orderNumber: String(order.orderNumber || ""),
                },
            });
            payment.providerPaymentIntentId = intent.providerPaymentIntentId;
            payment.providerCustomerId = intent.providerCustomerId || "";
            payment.providerTransactionId = intent.providerTransactionId || "";
            await payment.save();

            checkout = {
                provider: "STRIPE",
                publishableKey: intent.publishableKey || getStripePublishableKey(),
                clientSecret: intent.clientSecret,
                providerPaymentIntentId: intent.providerPaymentIntentId,
                ephemeralKey: intent.ephemeralKey,
                providerCustomerId: intent.providerCustomerId,
                status: intent.status,
            };
        }
    } catch (err) {
        payment.status = "failed";
        payment.failureReason = err.message || String(err);
        await payment.save();
        if (err instanceof PaymentProviderError) {
            throw new AppError(err.message, err.statusCode || 400);
        }
        throw err;
    }

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Create",
        description: `Customer payment ${payment.paymentNumber} checkout created (${formatMoney(amountMinor)})`,
        payment,
        ipAddress: meta.ipAddress || "",
    });

    // Manual NONE path can complete immediately (owner only)
    if (paymentProvider === "NONE" && payload.completeImmediately === true) {
        if (!isOwner(user)) {
            throw new AppError(
                "Only the owner can post offline customer payments immediately.",
                403
            );
        }
        return completeCheckout(payment._id, user, {
            ...meta,
            skipProviderCheck: true,
        });
    }

    return {
        payment: serializePayment(
            await populatePayment(Payment.findById(payment._id))
        ),
        checkout,
        salesOrder: {
            _id: order._id,
            orderNumber: order.orderNumber,
            grandTotal: order.grandTotal,
            paidAmount: order.paidAmount,
            dueAmount: order.dueAmount,
            dueMinor,
        },
    };
};

/**
 * Confirm checkout after client success or Stripe webhook.
 * Hardens: conditional status claim, Stripe amount match, SO due re-check, overpay reject.
 */
const completeCheckout = async (paymentId, user, meta = {}) => {
    const companyId = user ? await ensureUserCompany(user) : meta.companyId;
    if (!companyId) throw new AppError("companyId required.", 400);

    // Atomic claim — prevents double complete (webhook + client race)
    const claimable = [
        "draft",
        "pendingApproval",
        "approved",
        "processing",
    ];
    const claimed = await Payment.findOneAndUpdate(
        {
            _id: paymentId,
            companyId,
            paymentType: "CustomerPayment",
            ...NOT_DELETED,
            status: { $in: claimable },
            originalPaymentId: null,
        },
        {
            $set: {
                status: "processing",
                updatedAt: new Date(),
            },
        },
        { new: false }
    );

    if (!claimed) {
        const existing = await Payment.findOne({
            _id: paymentId,
            ...NOT_DELETED,
        });
        if (!existing) throw new AppError("Payment not found.", 404);
        assertDocumentCompany(existing, companyId, "Payment");
        if (existing.status === "paid") {
            return {
                payment: serializePayment(
                    await populatePayment(Payment.findById(existing._id))
                ),
                alreadyPaid: true,
            };
        }
        throw new AppError(
            `Cannot complete payment in status ${existing.status}.`,
            400
        );
    }

    const payment = await getPaymentOrFail(paymentId, companyId);

    try {
        if (payment.paymentProvider === "STRIPE") {
            if (!payment.providerPaymentIntentId) {
                throw new AppError("Missing Stripe PaymentIntent id.", 400);
            }
            let status;
            if (meta.skipProviderCheck === true) {
                // Webhook path — still enforce amount when provided
                status = {
                    succeeded: true,
                    amountReceivedMinor: meta.webhookAmountMinor,
                    currency: meta.webhookCurrency,
                    providerTransactionId: meta.providerTransactionId || null,
                };
                // Prefer live retrieve when possible for amount safety
                try {
                    const live = await getPaymentProvider("STRIPE").getPaymentStatus(
                        payment.providerPaymentIntentId
                    );
                    status = { ...live, succeeded: live.succeeded };
                    if (!live.succeeded) {
                        throw new AppError(
                            `Stripe payment not succeeded (status=${live.status}).`,
                            400
                        );
                    }
                } catch (err) {
                    if (err instanceof AppError) throw err;
                    // Fall back to webhook payload if retrieve fails transiently
                    if (meta.webhookAmountMinor == null) throw err;
                }
            } else {
                status = await getPaymentProvider("STRIPE").getPaymentStatus(
                    payment.providerPaymentIntentId
                );
                if (!status.succeeded) {
                    throw new AppError(
                        `Stripe payment not succeeded (status=${status.status}).`,
                        400
                    );
                }
            }

            const received =
                status.amountReceivedMinor != null
                    ? Number(status.amountReceivedMinor)
                    : Number(status.amountMinor);
            if (
                Number.isFinite(received) &&
                received > 0 &&
                received !== Number(payment.amountMinor)
            ) {
                throw new AppError(
                    `Stripe amount mismatch (received ${received}, expected ${payment.amountMinor}).`,
                    400
                );
            }
            if (
                status.currency &&
                String(status.currency).toLowerCase() !==
                    String(payment.currency || DEFAULT_CURRENCY).toLowerCase()
            ) {
                throw new AppError("Stripe currency mismatch.", 400);
            }
            payment.providerTransactionId =
                status.providerTransactionId || payment.providerTransactionId;
        } else if (!isOwner(user) && !meta.skipProviderCheck) {
            // Manual (CASH / BANK) complete is owner-only
            throw new AppError(
                "Only the owner can complete offline customer payments.",
                403
            );
        }

        // Re-check SO outstanding before posting
        if (payment.salesOrderId) {
            const order = await loadSalesOrder(payment.salesOrderId, companyId);
            const dueMinor = dueMinorOfOrder(order, payment.currency);
            assertNotOverpaying(
                payment.amountMinor,
                dueMinor,
                "Customer payment"
            );
        }

        // Restore approved → processing → paid path (claim already set processing)
        payment.status = "processing";
        applyStatusTransition(payment, "paid", user?._id || null);
        payment.paidAmountMinor = payment.amountMinor;
        payment.paidAmount = payment.amount;
        payment.dueAmountMinor = 0;
        payment.dueAmount = 0;
        payment.transactionDate = new Date();
        payment.postedBy = user?._id || null;
        payment.postedAt = new Date();
        await payment.save();

        if (payment.salesOrderId) {
            const order = await loadSalesOrder(payment.salesOrderId, companyId);
            const addMajor = toMajor(payment.amountMinor, payment.currency);
            const newPaid = (Number(order.paidAmount) || 0) + addMajor;
            const grand = Number(order.grandTotal) || 0;
            if (newPaid > grand + 0.009) {
                throw new AppError("Payment would overpay the sales order.", 400);
            }
            await markPaid(
                order._id,
                {
                    paidAmount: newPaid,
                    paymentMethod:
                        payment.paymentMethod === "CARD"
                            ? "Card"
                            : payment.paymentMethod === "CASH"
                              ? "Cash"
                              : payment.paymentMethod === "BANK_TRANSFER"
                                ? "Bank"
                                : order.paymentMethod,
                },
                user?._id || null
            );
        }

        if (user) {
            await auditPayment({
                user,
                companyId,
                branchId: payment.branchId,
                activityType: "Payment",
                description: `Customer payment ${payment.paymentNumber} completed`,
                payment,
                ipAddress: meta.ipAddress || "",
            });
        }

        return {
            payment: serializePayment(
                await populatePayment(Payment.findById(payment._id))
            ),
            alreadyPaid: false,
        };
    } catch (err) {
        // Release claim so operator can retry / cancel
        try {
            if (claimed.status && claimable.includes(claimed.status)) {
                await Payment.updateOne(
                    { _id: paymentId, status: "processing" },
                    { $set: { status: claimed.status } }
                );
            }
        } catch (_) {
            /* ignore rollback noise */
        }
        throw err;
    }
};

/**
 * Webhook / polling: complete by PaymentIntent id.
 */
const completeByPaymentIntent = async (providerPaymentIntentId, meta = {}) => {
    const payment = await Payment.findOne({
        providerPaymentIntentId,
        paymentType: "CustomerPayment",
        ...NOT_DELETED,
        originalPaymentId: null,
    });
    if (!payment) {
        return { ignored: true, reason: "payment_not_found" };
    }
    if (payment.status === "paid") {
        return { ignored: true, reason: "already_paid", paymentId: payment._id };
    }
    return completeCheckout(payment._id, null, {
        companyId: payment.companyId,
        skipProviderCheck: meta.skipProviderCheck === true,
        webhookAmountMinor: meta.webhookAmountMinor,
        webhookCurrency: meta.webhookCurrency,
        ...meta,
    });
};

const cancelCheckout = async (paymentId, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(paymentId, companyId);
    if (payment.status === "paid") {
        throw new AppError("Cannot cancel a paid payment.", 400);
    }
    if (!isOwner(user) && String(payment.createdBy) !== String(user._id)) {
        throw new AppError("You can only cancel your own checkout.", 403);
    }

    // Cancel Stripe PI first so a late card capture cannot orphan funds
    if (
        payment.paymentProvider === "STRIPE" &&
        payment.providerPaymentIntentId &&
        isStripeConfigured()
    ) {
        try {
            const stripe = getPaymentProvider("STRIPE");
            const result = await stripe.cancelPayment(
                payment.providerPaymentIntentId
            );
            // If PI already succeeded, refuse cancel — force complete instead
            if (result.succeeded) {
                throw new AppError(
                    "Stripe already captured this payment. Use Complete instead of Cancel.",
                    400
                );
            }
        } catch (err) {
            if (err instanceof AppError) throw err;
            // If cancel fails because already canceled, continue
            const msg = String(err.message || "");
            if (!/cancel|canceled|cancelled/i.test(msg)) {
                throw new AppError(
                    `Could not cancel Stripe PaymentIntent: ${err.message}`,
                    400
                );
            }
        }
    }

    applyStatusTransition(payment, "cancelled", user._id, {
        reason: meta.reason || "Cancelled",
    });
    await payment.save();
    return serializePayment(
        await populatePayment(Payment.findById(payment._id))
    );
};

const getCheckoutStatus = async (paymentId, companyId) => {
    const payment = await getPaymentOrFail(paymentId, companyId);
    let providerStatus = null;
    if (
        payment.paymentProvider === "STRIPE" &&
        payment.providerPaymentIntentId &&
        isStripeConfigured()
    ) {
        try {
            providerStatus = await getPaymentProvider("STRIPE").getPaymentStatus(
                payment.providerPaymentIntentId
            );
        } catch (err) {
            providerStatus = { error: err.message };
        }
    }
    return {
        payment: serializePayment(
            await populatePayment(Payment.findById(payment._id))
        ),
        providerStatus,
        stripeConfigured: isStripeConfigured(),
        publishableKey: getStripePublishableKey() || null,
    };
};

const listCustomerPayments = async (companyId, query = {}) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const filter = {
        companyId,
        ...NOT_DELETED,
        paymentType: "CustomerPayment",
        originalPaymentId: null,
    };
    if (query.status) filter.status = query.status;
    if (query.salesOrderId && toObjectId(query.salesOrderId)) {
        filter.salesOrderId = toObjectId(query.salesOrderId);
    }
    if (query.customerId && toObjectId(query.customerId)) {
        filter.partyId = toObjectId(query.customerId);
    }

    const [items, total] = await Promise.all([
        populatePayment(
            Payment.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
        ),
        Payment.countDocuments(filter),
    ]);

    return {
        items: items.map(serializePayment),
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    };
};

const getProviderInfo = () => ({
    stripeConfigured: isStripeConfigured(),
    publishableKey: getStripePublishableKey() || null,
    supportedMethods: ["CARD", "APPLE_PAY", "CASH", "BANK_TRANSFER"],
    note: "Card data never touches Lowkia servers — Stripe PaymentIntents only.",
});

module.exports = {
    createCheckout,
    completeCheckout,
    completeByPaymentIntent,
    cancelCheckout,
    getCheckoutStatus,
    listCustomerPayments,
    getProviderInfo,
    serializePayment,
    mapLegacyMethod,
};
