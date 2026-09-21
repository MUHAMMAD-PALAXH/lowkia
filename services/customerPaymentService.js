const mongoose = require("mongoose");
const Payment = require("../model/payment");
const SalesOrder = require("../model/salesOrder");
const Customer = require("../model/customer");
const RepairTicket = require("../model/repairTicket");
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
    isCloverConfigured,
    getStripePublishableKey,
} = require("./paymentProviders");
const { markPaid } = require("./salesOrderService");
const {
    applyPaymentToRepairTicket,
} = require("./repairTicketService");
const {
    resolveDeviceForCharge,
} = require("./cloverConnectionService");
const { newIdempotencyKey } = require("../utils/secretCrypto");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const { isCompanyOwner } = require("../utils/roleAccess");
const isOwner = (user) => isCompanyOwner(user?.role);

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
            "orderNumber grandTotal paidAmount dueAmount paymentStatus status customerId customerName"
        )
        .populate(
            "repairTicketId",
            "ticketNumber totalAmount paidAmount dueAmount paymentStatus status customerId customerName"
        )
        .populate("partyId", "fullName name customerCode phone email")
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

const loadRepairTicket = async (repairTicketId, companyId = null) => {
    const ticket = await RepairTicket.findOne({
        _id: repairTicketId,
        ...NOT_DELETED,
    });
    if (!ticket) throw new AppError("Repair ticket not found.", 404);
    if (String(ticket.status || "").toLowerCase() === "cancelled") {
        throw new AppError("Cannot checkout a cancelled repair ticket.", 400);
    }
    if (companyId) {
        assertDocumentCompany(ticket, companyId, "Repair ticket");
    }
    return ticket;
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

const dueMinorOfRepair = (ticket, currency = DEFAULT_CURRENCY) => {
    const dueMajor =
        ticket.dueAmount != null
            ? Number(ticket.dueAmount)
            : Math.max(
                  (Number(ticket.totalAmount) || 0) -
                      (Number(ticket.paidAmount) || 0),
                  0
              );
    return toMinor(dueMajor, currency);
};

/**
 * Start Stripe / Clover / manual checkout against a sales order OR repair ticket.
 * CARD / APPLE_PAY → STRIPE PaymentIntent (online) or CLOVER (terminal).
 * CASH / BANK_* → NONE (manual complete).
 */
const createCheckout = async (payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const salesOrderId = toObjectId(payload.salesOrderId);
    const repairTicketId = toObjectId(payload.repairTicketId);
    if (!salesOrderId && !repairTicketId) {
        throw new AppError("salesOrderId or repairTicketId is required.", 400);
    }
    if (salesOrderId && repairTicketId) {
        throw new AppError(
            "Provide either salesOrderId or repairTicketId, not both.",
            400
        );
    }

    const currency = DEFAULT_CURRENCY;
    let order = null;
    let ticket = null;
    let dueMinor = 0;
    let branchId = null;
    let partyId = null;
    let sourceModule = "Sales";
    let referenceType = "SalesOrder";
    let referenceId = null;
    let allocationTargetType = "SalesOrder";
    let displayLabel = "";

    if (salesOrderId) {
        order = await loadSalesOrder(salesOrderId, companyId);
        dueMinor = dueMinorOfOrder(order, currency);
        if (dueMinor <= 0) {
            throw new AppError("Sales order has no outstanding balance.", 400);
        }
        branchId = order.branchId || null;
        partyId = order.customerId || order._id;
        sourceModule = "Sales";
        referenceType = "SalesOrder";
        referenceId = order._id;
        allocationTargetType = "SalesOrder";
        displayLabel = `SO ${order.orderNumber || order._id}`;
    } else {
        ticket = await loadRepairTicket(repairTicketId, companyId);
        dueMinor = dueMinorOfRepair(ticket, currency);
        if (dueMinor <= 0) {
            throw new AppError("Repair ticket has no outstanding balance.", 400);
        }
        branchId = ticket.branchId || null;
        partyId = ticket.customerId || ticket._id;
        sourceModule = "Repair";
        referenceType = "RepairTicket";
        referenceId = ticket._id;
        allocationTargetType = "RepairTicket";
        displayLabel = `Repair ${ticket.ticketNumber || ticket._id}`;
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
        if (methodRaw === "CARD" || methodRaw === "APPLE_PAY") {
            // Explicit CLOVER request, else default Stripe for online wallets/cards
            provider =
                String(payload.channel || "").toUpperCase() === "CLOVER" ||
                String(payload.terminal || "").toUpperCase() === "CLOVER"
                    ? "CLOVER"
                    : "STRIPE";
        } else {
            provider = "NONE";
        }
    }
    if (String(provider).toUpperCase() === "CLOVER") {
        provider = "CLOVER";
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
    if (paymentProvider === "STRIPE" && repairTicketId) {
        throw new AppError(
            "Stripe online checkout is not available for repair tickets. Use Clover Flex or record payment on the ticket.",
            400
        );
    }

    // Avoid duplicate open checkouts for same SO / repair (all providers)
    const openFilter = {
        companyId,
        paymentType: "CustomerPayment",
        ...NOT_DELETED,
        status: { $in: ["draft", "pendingApproval", "approved", "processing"] },
        originalPaymentId: null,
    };
    if (salesOrderId) openFilter.salesOrderId = order._id;
    if (repairTicketId) openFilter.repairTicketId = ticket._id;

    const open = await Payment.findOne(openFilter).select(
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
            `Open checkout ${open.paymentNumber} already exists (status=${open.status}). Complete or cancel it first.`,
            409
        );
    }

    let customer = null;
    if (order?.customerId || ticket?.customerId) {
        customer = await Customer.findById(order?.customerId || ticket?.customerId)
            .select("fullName name email phone customerCode")
            .lean();
    }

    const paymentNumber = await generatePaymentNumber();
    const payment = await Payment.create({
        companyId,
        branchId,
        paymentNumber,
        paymentDate: new Date(),
        paymentType: "CustomerPayment",
        purpose: "againstPayable",
        partyType: "Customer",
        partyId,
        salesOrderId: order?._id || null,
        repairTicketId: ticket?._id || null,
        currency,
        amountMinor,
        amount,
        paidAmountMinor: 0,
        paidAmount: 0,
        dueAmountMinor: amountMinor,
        dueAmount: amount,
        paymentMethod,
        paymentProvider,
        status: paymentProvider === "NONE" ? "approved" : "processing",
        requiresApproval: false,
        requestedBy: user._id,
        createdBy: user._id,
        note: String(payload.note || "").trim().slice(0, 1000),
        sourceModule,
        isManualEntry: paymentProvider === "NONE",
        referenceType,
        referenceId,
        allocations: [
            {
                targetType: allocationTargetType,
                targetId: referenceId,
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
                description: displayLabel,
                createEphemeralKey: payload.createEphemeralKey === true,
                erpPaymentMethod: paymentMethod,
                metadata: {
                    companyId: String(companyId),
                    paymentId: String(payment._id),
                    paymentNumber: payment.paymentNumber,
                    salesOrderId: order ? String(order._id) : "",
                    repairTicketId: ticket ? String(ticket._id) : "",
                    orderNumber: String(order?.orderNumber || ""),
                    ticketNumber: String(ticket?.ticketNumber || ""),
                    paymentMethod: String(paymentMethod),
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
        } else if (paymentProvider === "CLOVER") {
            const {
                accessToken,
                device,
                posId,
                connection,
            } = await resolveDeviceForCharge(
                companyId,
                payload.deviceSerial || payload.cloverDeviceId || null
            );

            const idempotencyKey = newIdempotencyKey();
            const externalPaymentId = String(payment.paymentNumber || payment._id)
                .replace(/[^A-Za-z0-9_-]/g, "")
                .slice(0, 42);

            payment.paymentMethodReference = idempotencyKey;
            payment.providerPaymentIntentId = externalPaymentId;
            payment.transactionReference = device.serialNumber;
            payment.note = [
                payment.note,
                `Clover Flex ${device.serialNumber}`,
            ]
                .filter(Boolean)
                .join(" · ")
                .slice(0, 1000);
            await payment.save();

            // Optional short message on idle device before charge
            const clover = getPaymentProvider("CLOVER");
            try {
                await clover.displayMessage({
                    accessToken,
                    deviceId: device.serialNumber,
                    posId,
                    text: `${displayLabel} · Pay ${formatMoney(amountMinor)}`,
                    beep: false,
                });
            } catch (_) {
                /* display is best-effort */
            }

            const result = await clover.createPayment({
                accessToken,
                deviceId: device.serialNumber,
                posId,
                amountMinor,
                currency,
                externalPaymentId,
                idempotencyKey,
                timeoutSec: Number(payload.timeoutSec) || 120,
            });

            payment.providerTransactionId = result.cloverPaymentId || "";
            payment.paymentMethodReference = idempotencyKey;
            if (result.cardLast4) {
                payment.providerCustomerId = `${result.cardBrand || "CARD"} ****${result.cardLast4}`;
            }
            await payment.save();

            connection.lastUsedAt = new Date();
            device.lastSeenAt = new Date();
            device.lastError = "";
            await connection.save();

            try {
                await clover.showWelcome({
                    accessToken,
                    deviceId: device.serialNumber,
                    posId,
                });
            } catch (_) {
                /* welcome best-effort */
            }

            if (!result.succeeded) {
                payment.status = "failed";
                payment.failureReason = `Clover result=${result.status}`;
                await payment.save();
                throw new AppError(
                    `Clover payment did not succeed (status=${result.status}).`,
                    400
                );
            }

            // Complete ledger + SO/Repair immediately after verified device success
            const completed = await completeCheckout(payment._id, user, {
                ...meta,
                skipProviderCheck: true,
                webhookAmountMinor: result.amountMinor,
                providerTransactionId: result.cloverPaymentId,
            });

            return {
                ...completed,
                checkout: {
                    provider: "CLOVER",
                    status: "succeeded",
                    deviceSerial: device.serialNumber,
                    cloverPaymentId: result.cloverPaymentId,
                    cardLast4: result.cardLast4,
                    cardBrand: result.cardBrand,
                    entryType: result.entryType,
                    idempotencyKey,
                },
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

    const entitySummary = order
        ? {
              salesOrder: {
                  _id: order._id,
                  orderNumber: order.orderNumber,
                  grandTotal: order.grandTotal,
                  paidAmount: order.paidAmount,
                  dueAmount: order.dueAmount,
                  dueMinor,
              },
          }
        : {
              repairTicket: {
                  _id: ticket._id,
                  ticketNumber: ticket.ticketNumber,
                  totalAmount: ticket.totalAmount,
                  paidAmount: ticket.paidAmount,
                  dueAmount: ticket.dueAmount,
                  dueMinor,
              },
          };

    return {
        payment: serializePayment(
            await populatePayment(Payment.findById(payment._id))
        ),
        checkout,
        ...entitySummary,
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

        // Re-check SO / repair outstanding before posting
        if (payment.salesOrderId) {
            const order = await loadSalesOrder(payment.salesOrderId, companyId);
            const dueMinor = dueMinorOfOrder(order, payment.currency);
            assertNotOverpaying(
                payment.amountMinor,
                dueMinor,
                "Customer payment"
            );
        }
        if (payment.repairTicketId) {
            const ticket = await loadRepairTicket(
                payment.repairTicketId,
                companyId
            );
            const dueMinor = dueMinorOfRepair(ticket, payment.currency);
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
                            : payment.paymentMethod === "APPLE_PAY"
                              ? "Apple Pay"
                              : payment.paymentMethod === "CASH"
                                ? "Cash"
                                : payment.paymentMethod === "BANK_TRANSFER"
                                  ? "Bank"
                                  : order.paymentMethod,
                    skipPaymentLedger: true,
                },
                user?._id || null
            );
        }

        if (payment.repairTicketId) {
            const addMajor = toMajor(payment.amountMinor, payment.currency);
            await applyPaymentToRepairTicket(
                payment.repairTicketId,
                addMajor,
                companyId,
                user?._id || null,
                payment.paymentProvider === "CLOVER"
                    ? "Card"
                    : payment.paymentMethod === "CASH"
                      ? "Cash"
                      : payment.paymentMethod === "BANK_TRANSFER"
                        ? "Bank"
                        : "Partial"
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

    // Best-effort cancel on Flex if still waiting
    if (payment.paymentProvider === "CLOVER") {
        try {
            const {
                accessToken,
                device,
                posId,
            } = await resolveDeviceForCharge(
                companyId,
                payment.transactionReference || null
            );
            await getPaymentProvider("CLOVER").cancelDevice({
                accessToken,
                deviceId: device.serialNumber,
                posId,
            });
        } catch (_) {
            /* device may already be idle */
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

/**
 * Recover unknown Clover checkout by replaying the same Idempotency-Key.
 * Safe: Clover returns the original result — no double charge.
 */
const recoverCheckout = async (paymentId, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can recover Clover checkouts.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(paymentId, companyId);
    if (payment.status === "paid") {
        return {
            payment: serializePayment(
                await populatePayment(Payment.findById(payment._id))
            ),
            alreadyPaid: true,
        };
    }
    if (payment.paymentProvider !== "CLOVER") {
        throw new AppError("Recover is only supported for Clover checkouts.", 400);
    }
    if (!["processing", "failed", "approved"].includes(payment.status)) {
        throw new AppError(
            `Cannot recover payment in status ${payment.status}.`,
            400
        );
    }
    const idempotencyKey = payment.paymentMethodReference;
    const externalPaymentId = payment.providerPaymentIntentId;
    if (!idempotencyKey || !externalPaymentId) {
        throw new AppError(
            "Missing Clover idempotency key / external payment id on this payment.",
            400
        );
    }

    const {
        accessToken,
        device,
        posId,
        connection,
    } = await resolveDeviceForCharge(
        companyId,
        payment.transactionReference || meta.deviceSerial || null
    );

    const clover = getPaymentProvider("CLOVER");
    const result = await clover.createPayment({
        accessToken,
        deviceId: device.serialNumber,
        posId,
        amountMinor: payment.amountMinor,
        currency: payment.currency || DEFAULT_CURRENCY,
        externalPaymentId,
        idempotencyKey,
        timeoutSec: Number(meta.timeoutSec) || 120,
    });

    payment.providerTransactionId =
        result.cloverPaymentId || payment.providerTransactionId;
    await payment.save();
    connection.lastUsedAt = new Date();
    device.lastSeenAt = new Date();
    await connection.save();

    if (!result.succeeded) {
        payment.status = "failed";
        payment.failureReason = `Clover recover result=${result.status}`;
        await payment.save();
        throw new AppError(
            `Clover recovery did not succeed (status=${result.status}).`,
            400
        );
    }

    const completed = await completeCheckout(payment._id, user, {
        ...meta,
        skipProviderCheck: true,
        webhookAmountMinor: result.amountMinor,
        providerTransactionId: result.cloverPaymentId,
    });
    return {
        ...completed,
        checkout: {
            provider: "CLOVER",
            status: "succeeded",
            recovered: true,
            cloverPaymentId: result.cloverPaymentId,
            deviceSerial: device.serialNumber,
        },
    };
};

/**
 * Refund a paid CLOVER customer payment (full or partial). Creates CustomerRefund ledger row.
 */
const refundCloverPayment = async (paymentId, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can refund Clover payments.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const original = await Payment.findOne({
        _id: paymentId,
        companyId,
        paymentType: "CustomerPayment",
        ...NOT_DELETED,
        originalPaymentId: null,
    });
    if (!original) throw new AppError("Payment not found.", 404);
    assertDocumentCompany(original, companyId, "Payment");
    if (original.status !== "paid") {
        throw new AppError("Only paid payments can be refunded.", 400);
    }
    if (original.paymentProvider !== "CLOVER") {
        throw new AppError("This payment was not collected on Clover.", 400);
    }
    if (!original.providerTransactionId) {
        throw new AppError("Missing Clover payment id for refund.", 400);
    }

    const currency = original.currency || DEFAULT_CURRENCY;
    const fullRefund = payload.fullRefund === true || payload.amount == null;
    let amountMinor;
    if (fullRefund) {
        amountMinor = Number(original.amountMinor);
    } else {
        ({ amountMinor } = resolveAmountMinor(payload, currency));
    }
    assertPositiveMinor(amountMinor, "Refund");
    if (amountMinor > Number(original.amountMinor)) {
        throw new AppError("Refund cannot exceed original payment.", 400);
    }

    const {
        accessToken,
        device,
        posId,
        connection,
    } = await resolveDeviceForCharge(
        companyId,
        payload.deviceSerial || original.transactionReference || null
    );

    const idempotencyKey = newIdempotencyKey();
    const clover = getPaymentProvider("CLOVER");
    const result = await clover.refundPayment(original.providerTransactionId, {
        accessToken,
        deviceId: device.serialNumber,
        posId,
        idempotencyKey,
        fullRefund,
        amountMinor: fullRefund ? null : amountMinor,
        timeoutSec: Number(payload.timeoutSec) || 120,
    });

    const refundNumber = await generatePaymentNumber();
    const refundAmount = toMajor(amountMinor, currency);
    const refund = await Payment.create({
        companyId,
        branchId: original.branchId || null,
        paymentNumber: refundNumber,
        paymentDate: new Date(),
        paymentType: "CustomerRefund",
        purpose: "other",
        partyType: original.partyType,
        partyId: original.partyId,
        salesOrderId: original.salesOrderId,
        repairTicketId: original.repairTicketId,
        salesReturnId: payload.salesReturnId
            ? toObjectId(payload.salesReturnId)
            : null,
        currency,
        amountMinor,
        amount: refundAmount,
        paidAmountMinor: amountMinor,
        paidAmount: refundAmount,
        dueAmountMinor: 0,
        dueAmount: 0,
        paymentMethod: original.paymentMethod,
        paymentProvider: "CLOVER",
        status: "paid",
        originalPaymentId: original._id,
        providerTransactionId: result.refundId || "",
        paymentMethodReference: idempotencyKey,
        transactionReference: device.serialNumber,
        note: String(payload.note || meta.reason || "Clover refund")
            .trim()
            .slice(0, 1000),
        sourceModule: original.sourceModule || "Sales",
        createdBy: user._id,
        postedBy: user._id,
        postedAt: new Date(),
        transactionDate: new Date(),
        referenceType: "CloverRefund",
        referenceId: original._id,
    });

    if (amountMinor >= Number(original.amountMinor)) {
        applyStatusTransition(original, "reversed", user._id, {
            reason: meta.reason || "Clover refund",
            originalPaymentId: original._id,
        });
        original.reversedBy = user._id;
        original.reversedAt = new Date();
        await original.save();
    }

    connection.lastUsedAt = new Date();
    device.lastSeenAt = new Date();
    await connection.save();

    await auditPayment({
        user,
        companyId,
        branchId: refund.branchId,
        activityType: "Payment",
        description: `Clover refund ${refund.paymentNumber} for ${original.paymentNumber}`,
        payment: refund,
        ipAddress: meta.ipAddress || "",
    });

    return {
        refund: serializePayment(
            await populatePayment(Payment.findById(refund._id))
        ),
        original: serializePayment(
            await populatePayment(Payment.findById(original._id))
        ),
        clover: {
            refundId: result.refundId,
            status: result.status,
            amountMinor: result.amountMinor,
            deviceSerial: device.serialNumber,
        },
    };
};

/**
 * Find the latest paid CLOVER payment for a sales order (for return refunds).
 */
const findPaidCloverPaymentForOrder = async (salesOrderId, companyId) => {
    return Payment.findOne({
        companyId,
        salesOrderId,
        paymentType: "CustomerPayment",
        paymentProvider: "CLOVER",
        status: "paid",
        ...NOT_DELETED,
        originalPaymentId: null,
    }).sort({ postedAt: -1, createdAt: -1 });
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
    if (query.paymentMethod) {
        filter.paymentMethod = String(query.paymentMethod)
            .trim()
            .toUpperCase()
            .replace(/\s+/g, "_");
    }
    if (query.salesOrderId && toObjectId(query.salesOrderId)) {
        filter.salesOrderId = toObjectId(query.salesOrderId);
    }
    if (query.repairTicketId && toObjectId(query.repairTicketId)) {
        filter.repairTicketId = toObjectId(query.repairTicketId);
    }
    if (query.customerId && toObjectId(query.customerId)) {
        filter.partyId = toObjectId(query.customerId);
    }
    if (query.search) {
        const s = String(query.search).trim();
        if (s) {
            filter.$or = [
                { paymentNumber: { $regex: s, $options: "i" } },
                { note: { $regex: s, $options: "i" } },
                { providerTransactionId: { $regex: s, $options: "i" } },
            ];
        }
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
    cloverConfigured: isCloverConfigured(),
    publishableKey: getStripePublishableKey() || null,
    supportedMethods: ["CARD", "APPLE_PAY", "CASH", "BANK_TRANSFER"],
    supportedTerminals: ["CLOVER"],
    note:
        "Card / Apple Pay online: Stripe PaymentIntents. Card-present / contactless on Flex: Clover REST Pay Display (Cloud Pay Display). Enable Apple Pay in Stripe Dashboard for wallets.",
});

module.exports = {
    createCheckout,
    completeCheckout,
    completeByPaymentIntent,
    cancelCheckout,
    recoverCheckout,
    refundCloverPayment,
    findPaidCloverPaymentForOrder,
    getCheckoutStatus,
    listCustomerPayments,
    getProviderInfo,
    serializePayment,
    mapLegacyMethod,
};
