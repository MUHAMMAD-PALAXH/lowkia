const mongoose = require("mongoose");
const SubscriptionPlan = require("../model/subscriptionPlan");
const CompanySubscription = require("../model/companySubscription");
const Company = require("../model/company");
const SubscriptionInvoice = require("../model/subscriptionInvoice");
const SubscriptionPayment = require("../model/subscriptionPayment");
const PlatformPaymentAccount = require("../model/platformPaymentAccount");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");
const { writeActivityLog } = require("./activityLogService");
const { getCompanyRaw } = require("./companyService");
const {
    METHODS_REQUIRING_TXN_ID,
    SUBSCRIPTION_PAYMENT_INTENTS,
    PAYMENT_REJECTION_REASONS,
} = require("../constants/saasBilling");

const NOT_DELETED = { isDeleted: { $ne: true } };

const addInterval = (from, interval) => {
    const d = new Date(from);
    if (interval === "lifetime") {
        d.setFullYear(d.getFullYear() + 100);
    } else if (interval === "yearly") {
        d.setFullYear(d.getFullYear() + 1);
    } else if (interval === "quarterly") {
        d.setMonth(d.getMonth() + 3);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return d;
};

const buildPaymentReference = (companyCode, subscriptionNumber) => {
    const co = String(companyCode || "CO")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
    const sub = String(subscriptionNumber || "SUB")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
    return `FAP-${co}-${sub}`;
};

/**
 * Pure period rules for approve activation (V1).
 * - early renew (active + period still valid): extend from period end
 * - expire renew / trial buy / new: from approval `now`
 * - upgrade: immediate from `now` (no proration)
 * - downgrade_schedule: no period change
 */
const resolveActivationPeriods = ({
    intent,
    subStatus,
    currentPeriodEnd,
    billingInterval,
    now = new Date(),
}) => {
    if (intent === "downgrade_schedule") {
        return {
            mode: "downgrade_scheduled",
            periodStart: null,
            periodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
            changePlan: false,
            changePeriod: false,
        };
    }

    const periodStillValid =
        currentPeriodEnd && new Date(currentPeriodEnd) > now;

    let periodStart = now;
    let mode = intent || "new";

    if (intent === "renew" && periodStillValid && subStatus === "active") {
        periodStart = new Date(currentPeriodEnd);
        mode = "early_renew";
    } else if (intent === "upgrade") {
        mode = "upgrade";
    } else if (intent === "renew") {
        mode = "expire_renew";
    } else {
        mode = intent === "new" ? "new_or_trial_buy" : String(intent || "new");
    }

    const periodEnd = addInterval(periodStart, billingInterval || "monthly");
    return {
        mode,
        periodStart,
        periodEnd,
        changePlan: true,
        changePeriod: true,
    };
};

const getActivePlanOrFail = async (planId, session = null) => {
    const q = SubscriptionPlan.findOne({
        _id: planId,
        ...NOT_DELETED,
        status: "Active",
    });
    if (session) q.session(session);
    const plan = await q;
    if (!plan) throw new AppError("Active plan not found.", 404);
    return plan;
};

const getCompanySubscriptionOrFail = async (
    companyId,
    session = null
) => {
    const company = session
        ? await Company.findById(companyId).session(session)
        : await getCompanyRaw(companyId);
    if (!company || company.isDeleted) {
        throw new AppError("Company not found.", 404);
    }

    let sub = null;
    if (company.currentSubscriptionId) {
        const q = CompanySubscription.findOne({
            _id: company.currentSubscriptionId,
            companyId: company._id,
            ...NOT_DELETED,
        });
        if (session) q.session(session);
        sub = await q;
    }
    if (!sub) {
        const q = CompanySubscription.findOne({
            companyId: company._id,
            ...NOT_DELETED,
        }).sort({ createdAt: -1 });
        if (session) q.session(session);
        sub = await q;
    }
    if (!sub) throw new AppError("No subscription found for company.", 404);
    return { company, sub };
};

/**
 * Create unpaid invoice for plan purchase / renew / upgrade / downgrade schedule.
 * Does NOT activate subscription.
 */
const createCheckoutInvoice = async ({
    companyId,
    planId,
    intent = "new",
    preferredPaymentMethod = null,
    paymentAccountId = null,
    actor,
}) => {
    if (!SUBSCRIPTION_PAYMENT_INTENTS.includes(intent)) {
        throw new AppError("Invalid checkout intent.", 400);
    }

    const plan = await getActivePlanOrFail(planId);
    const { company, sub } = await getCompanySubscriptionOrFail(companyId);

    // Block duplicate open invoices for same intent+plan
    const open = await SubscriptionInvoice.findOne({
        companyId: company._id,
        subscriptionId: sub._id,
        planId: plan._id,
        intent,
        status: { $in: ["unpaid", "pending", "draft"] },
        ...NOT_DELETED,
    });
    if (open) {
        return populateInvoice(open._id);
    }

    if (intent === "upgrade" || intent === "downgrade_schedule") {
        if (String(sub.planId) === String(plan._id)) {
            throw new AppError("Selected plan is already current.", 400);
        }
    }

    const invoiceNumber = await generateCode("subscription_invoice");
    let paymentReference = buildPaymentReference(
        company.companyCode,
        sub.subscriptionNumber
    );
    // Ensure uniqueness if same company/sub reuses reference pattern
    const clash = await SubscriptionInvoice.exists({
        paymentReference,
        ...NOT_DELETED,
    });
    if (clash) {
        paymentReference = `${paymentReference}-${invoiceNumber.replace(
            /\D/g,
            ""
        )}`;
    }

    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 7);

    const invoice = await SubscriptionInvoice.create({
        invoiceNumber,
        paymentReference,
        companyId: company._id,
        subscriptionId: sub._id,
        planId: plan._id,
        planCode: plan.planCode,
        planName: plan.name,
        billingInterval: plan.billingInterval,
        intent,
        amountMinor: plan.priceMinor || 0,
        currency: plan.currency || "USD",
        status: "unpaid",
        preferredPaymentMethod: preferredPaymentMethod || undefined,
        paymentAccountId: paymentAccountId || undefined,
        dueAt,
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });

    sub.currentInvoiceId = invoice._id;
    if (["unpaid", "trialing", "expired", "past_due"].includes(sub.status)) {
        // Keep trial/active as-is; pending only when already past trial without pay
        if (sub.status === "expired" || sub.status === "past_due") {
            sub.status = "pending";
        }
    }
    sub.paymentStatus = "unpaid";
    sub.updatedBy = actor?._id || sub.updatedBy;
    await sub.save();

    await writeActivityLog({
        user: actor,
        companyId: company._id,
        activityType: "Create",
        module: "Billing",
        subModule: "Checkout",
        description: `Created subscription invoice ${invoiceNumber} (${intent}) for ${company.companyCode}`,
        shortDescription: `Invoice ${invoiceNumber}`,
        referenceType: "SubscriptionInvoice",
        referenceId: invoice._id,
        newData: {
            invoiceNumber,
            paymentReference,
            amountMinor: invoice.amountMinor,
            intent,
            planCode: plan.planCode,
        },
        securityLevel: "Medium",
    });

    return populateInvoice(invoice._id);
};

const populateInvoice = (id) =>
    SubscriptionInvoice.findById(id)
        .populate("planId", "planCode name billingInterval priceMinor currency")
        .populate("paymentAccountId")
        .populate("currentPaymentId")
        .lean();

const populatePayment = (id) =>
    SubscriptionPayment.findById(id)
        .populate("invoiceId")
        .populate("paymentAccountId")
        .populate("subscriptionId", "subscriptionNumber status planCode")
        .populate("companyId", "companyCode name status")
        .lean();

/**
 * Company submits offline payment proof. Moves invoice → pending.
 * Does NOT activate plan.
 */
const submitSubscriptionPayment = async ({
    companyId,
    invoiceId,
    paymentAccountId,
    paymentMethod,
    transactionId = "",
    paymentDate,
    amountMinor,
    proofUrl = "",
    note = "",
    actor,
}) => {
    const invoice = await SubscriptionInvoice.findOne({
        _id: invoiceId,
        companyId,
        ...NOT_DELETED,
    });
    if (!invoice) throw new AppError("Invoice not found.", 404);
    // Do not allow a second pending submission (prevents double-approve activation).
    if (!["unpaid", "overdue", "draft"].includes(invoice.status)) {
        throw new AppError(
            `Cannot submit payment for invoice status "${invoice.status}".${
                invoice.status === "pending"
                    ? " Wait for verification, or ask Global Console to reject the current submission."
                    : ""
            }`,
            400
        );
    }

    const method = String(paymentMethod || invoice.preferredPaymentMethod || "")
        .trim()
        .toLowerCase();
    if (!method) throw new AppError("paymentMethod is required.", 400);

    const txn = String(transactionId || "").trim();
    if (METHODS_REQUIRING_TXN_ID.has(method) && !txn) {
        throw new AppError(
            "Transaction / TrxID is required for this payment method.",
            400
        );
    }

    const paidWhen = paymentDate ? new Date(paymentDate) : new Date();
    if (Number.isNaN(paidWhen.getTime())) {
        throw new AppError("Invalid paymentDate.", 400);
    }

    const amount =
        amountMinor != null ? Number(amountMinor) : Number(invoice.amountMinor);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new AppError("amountMinor must be a non-negative number.", 400);
    }
    if (amount !== Number(invoice.amountMinor)) {
        throw new AppError(
            `Amount mismatch. Invoice expects ${invoice.amountMinor} minor units.`,
            400
        );
    }
    if (invoice.amountMinor > 0 && amount <= 0) {
        throw new AppError("amountMinor must be a positive number.", 400);
    }

    let account = null;
    let accountSnapshot = null;
    if (paymentAccountId) {
        account = await PlatformPaymentAccount.findOne({
            _id: paymentAccountId,
            ...NOT_DELETED,
            isActive: true,
        });
        if (!account) throw new AppError("Payment account not found.", 404);
        if (
            account.currency !== invoice.currency ||
            account.paymentMethod !== method
        ) {
            throw new AppError(
                "Payment account does not match invoice currency/method.",
                400
            );
        }
        accountSnapshot = {
            accountCode: account.accountCode,
            currency: account.currency,
            paymentMethod: account.paymentMethod,
            accountName: account.accountName,
            accountNumber: account.accountNumber,
            bankName: account.bankName,
            phoneNumber: account.phoneNumber,
        };
    }

    // Reject duplicate pending txn for same method+id (anti double-submit)
    if (txn) {
        const dup = await SubscriptionPayment.findOne({
            transactionId: txn,
            paymentMethod: method,
            status: { $in: ["pending_verification", "verified"] },
            ...NOT_DELETED,
        });
        if (dup) {
            throw new AppError(
                "This transaction ID was already submitted.",
                409
            );
        }
    }

    const paymentNumber = await generateCode("subscription_payment");
    const payment = await SubscriptionPayment.create({
        paymentNumber,
        companyId,
        invoiceId: invoice._id,
        subscriptionId: invoice.subscriptionId,
        paymentAccountId: account?._id || null,
        paymentAccountSnapshot: accountSnapshot,
        amountMinor: amount,
        currency: invoice.currency,
        paymentMethod: method,
        transactionId: txn,
        paymentDate: paidWhen,
        proofUrl: String(proofUrl || "").trim(),
        note: String(note || "").trim(),
        status: "pending_verification",
        submittedBy: actor?._id || null,
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });

    invoice.status = "pending";
    invoice.currentPaymentId = payment._id;
    invoice.preferredPaymentMethod = method;
    if (account) invoice.paymentAccountId = account._id;
    invoice.updatedBy = actor?._id || invoice.updatedBy;
    await invoice.save();

    await CompanySubscription.updateOne(
        { _id: invoice.subscriptionId },
        {
            $set: {
                paymentStatus: "pending",
                updatedBy: actor?._id || null,
            },
        }
    );

    await writeActivityLog({
        user: actor,
        companyId,
        activityType: "Create",
        module: "Billing",
        subModule: "SubmitPayment",
        description: `Submitted subscription payment ${paymentNumber} (pending verification)`,
        shortDescription: `Pay ${paymentNumber}`,
        referenceType: "SubscriptionPayment",
        referenceId: payment._id,
        newData: {
            paymentNumber,
            amountMinor: amount,
            paymentMethod: method,
            transactionId: txn,
            invoiceNumber: invoice.invoiceNumber,
        },
        securityLevel: "High",
    });

    return populatePayment(payment._id);
};

/**
 * Apply plan + period rules after payment verification.
 */
const applyActivationOnApprove = async ({
    sub,
    company,
    plan,
    intent,
    payment,
    actor,
    session,
}) => {
    const now = new Date();
    const resolved = resolveActivationPeriods({
        intent,
        subStatus: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        billingInterval: plan.billingInterval,
        now,
    });

    if (!resolved.changePlan) {
        // Downgrade: schedule only — keep current plan/period/status.
        sub.scheduledPlanId = plan._id;
        sub.paymentStatus = "paid";
        sub.paidAt = payment.paymentDate || now;
        sub.paidBy = actor?._id || null;
        sub.paymentMethod = payment.paymentMethod;
        if (payment.note) sub.paymentNote = payment.note;
        sub.bankPayment = {
            bankName: payment.paymentAccountSnapshot?.bankName || "",
            transactionRef: payment.transactionId || "",
            payerName: "",
            chequeNumber: "",
        };
        sub.updatedBy = actor?._id || sub.updatedBy;
        await sub.save({ session });
        return {
            mode: resolved.mode,
            periodEnd: sub.currentPeriodEnd,
            scheduledPlanId: plan._id,
        };
    }

    const { periodStart, periodEnd, mode } = resolved;

    sub.planId = plan._id;
    sub.planCode = plan.planCode;
    sub.planName = plan.name;
    sub.billingInterval = plan.billingInterval;
    sub.amountMinor = plan.priceMinor || 0;
    sub.currency = plan.currency || sub.currency;
    sub.limits = plan.limits || {};
    sub.features = plan.features || [];
    sub.status = "active";
    sub.paymentStatus = "paid";
    sub.paidAt = payment.paymentDate || now;
    sub.paidBy = actor?._id || null;
    sub.paymentMethod = payment.paymentMethod;
    sub.paymentNote = payment.note || "";
    sub.bankPayment = {
        bankName: payment.paymentAccountSnapshot?.bankName || "",
        transactionRef: payment.transactionId || "",
        payerName: "",
        chequeNumber: "",
    };
    sub.currentPeriodStart = periodStart;
    sub.currentPeriodEnd = periodEnd;
    sub.scheduledPlanId = null;
    sub.trialEndsAt = null;
    sub.updatedBy = actor?._id || sub.updatedBy;
    await sub.save({ session });

    company.currentSubscriptionId = sub._id;
    company.status = "Active";
    company.trialEndsAt = null;
    company.updatedBy = actor?._id || company.updatedBy;
    await company.save({ session });

    return { mode, periodStart, periodEnd };
};

/**
 * GSA approves pending payment inside a MongoDB transaction.
 */
const approveSubscriptionPayment = async (paymentId, actor) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Atomic claim — prevents concurrent double-approve of the same payment.
        const payment = await SubscriptionPayment.findOneAndUpdate(
            {
                _id: paymentId,
                status: "pending_verification",
                ...NOT_DELETED,
            },
            {
                $set: {
                    status: "verified",
                    verifiedAt: new Date(),
                    verifiedBy: actor?._id || null,
                    updatedBy: actor?._id || null,
                },
            },
            { new: true, session }
        );
        if (!payment) {
            throw new AppError(
                "Payment not found or already processed.",
                404
            );
        }

        const invoice = await SubscriptionInvoice.findOne({
            _id: payment.invoiceId,
            ...NOT_DELETED,
        }).session(session);
        if (!invoice) throw new AppError("Invoice not found.", 404);
        if (!["pending", "unpaid", "overdue"].includes(invoice.status)) {
            throw new AppError(
                `Invoice is "${invoice.status}" and cannot be approved.`,
                400
            );
        }
        if (Number(payment.amountMinor) !== Number(invoice.amountMinor)) {
            throw new AppError(
                "Payment amount does not match invoice amount.",
                400
            );
        }

        const sub = await CompanySubscription.findOne({
            _id: payment.subscriptionId,
            ...NOT_DELETED,
        }).session(session);
        if (!sub) throw new AppError("Subscription not found.", 404);

        const company = await Company.findById(payment.companyId).session(
            session
        );
        if (!company || company.isDeleted) {
            throw new AppError("Company not found.", 404);
        }

        // Cancel sibling pending submissions on this invoice (safety net).
        await SubscriptionPayment.updateMany(
            {
                invoiceId: invoice._id,
                _id: { $ne: payment._id },
                status: "pending_verification",
                ...NOT_DELETED,
            },
            {
                $set: {
                    status: "cancelled",
                    rejectionReason: "Superseded by approved payment",
                    updatedBy: actor?._id || null,
                },
            },
            { session }
        );

        // Downgrade takes effect on next renew: prefer scheduled plan when renewing.
        let planIdToApply = invoice.planId;
        if (
            invoice.intent === "renew" &&
            sub.scheduledPlanId &&
            String(sub.scheduledPlanId) !== String(invoice.planId)
        ) {
            planIdToApply = sub.scheduledPlanId;
        }
        const plan = await getActivePlanOrFail(planIdToApply, session);

        const now = new Date();
        invoice.status = "paid";
        invoice.paidAt = now;
        invoice.currentPaymentId = payment._id;
        invoice.updatedBy = actor?._id || null;
        await invoice.save({ session });

        const activation = await applyActivationOnApprove({
            sub,
            company,
            plan,
            intent: invoice.intent,
            payment,
            actor,
            session,
        });

        await session.commitTransaction();

        await writeActivityLog({
            user: actor,
            companyId: company._id,
            activityType: "Update",
            module: "Platform",
            subModule: "ApprovePayment",
            description: `Approved subscription payment ${payment.paymentNumber} for ${company.companyCode}`,
            shortDescription: `Approve ${payment.paymentNumber}`,
            referenceType: "SubscriptionPayment",
            referenceId: payment._id,
            newData: {
                paymentNumber: payment.paymentNumber,
                invoiceNumber: invoice.invoiceNumber,
                intent: invoice.intent,
                activation,
            },
            securityLevel: "High",
        });

        return populatePayment(payment._id);
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const rejectSubscriptionPayment = async (
    paymentId,
    actor,
    { reason = "", note = "" } = {}
) => {
    const payment = await SubscriptionPayment.findOne({
        _id: paymentId,
        ...NOT_DELETED,
    });
    if (!payment) throw new AppError("Payment not found.", 404);
    if (payment.status !== "pending_verification") {
        throw new AppError(
            `Payment is "${payment.status}", cannot reject.`,
            400
        );
    }

    const rejectionReason = String(reason || "").trim() || "Other";
    if (
        !PAYMENT_REJECTION_REASONS.includes(rejectionReason) &&
        rejectionReason !== "Other"
    ) {
        // allow free-text via Other + note
    }

    payment.status = "rejected";
    payment.rejectionReason = rejectionReason;
    payment.rejectionNote = String(note || "").trim();
    payment.rejectedAt = new Date();
    payment.rejectedBy = actor?._id || null;
    payment.updatedBy = actor?._id || null;
    await payment.save();

    const invoice = await SubscriptionInvoice.findById(payment.invoiceId);
    if (invoice && invoice.status === "pending") {
        invoice.status = "unpaid";
        if (
            invoice.currentPaymentId &&
            String(invoice.currentPaymentId) === String(payment._id)
        ) {
            invoice.currentPaymentId = null;
        }
        invoice.updatedBy = actor?._id || invoice.updatedBy;
        await invoice.save();
    }

    await CompanySubscription.updateOne(
        { _id: payment.subscriptionId },
        {
            $set: {
                paymentStatus: "unpaid",
                updatedBy: actor?._id || null,
            },
        }
    );

    await writeActivityLog({
        user: actor,
        companyId: payment.companyId,
        activityType: "Update",
        module: "Platform",
        subModule: "RejectPayment",
        description: `Rejected subscription payment ${payment.paymentNumber}: ${rejectionReason}`,
        shortDescription: `Reject ${payment.paymentNumber}`,
        referenceType: "SubscriptionPayment",
        referenceId: payment._id,
        newData: {
            rejectionReason,
            rejectionNote: payment.rejectionNote,
        },
        securityLevel: "High",
    });

    return populatePayment(payment._id);
};

const listIncomingPayments = async (query = {}) => {
    const filter = { ...NOT_DELETED };
    if (query.status) filter.status = String(query.status);
    else filter.status = "pending_verification";
    if (query.companyId) filter.companyId = query.companyId;
    if (query.paymentMethod) {
        filter.paymentMethod = String(query.paymentMethod).toLowerCase();
    }

    return SubscriptionPayment.find(filter)
        .sort({ createdAt: -1 })
        .populate("companyId", "companyCode name status")
        .populate(
            "invoiceId",
            "invoiceNumber paymentReference amountMinor currency intent"
        )
        .populate("subscriptionId", "subscriptionNumber planCode status")
        .populate("paymentAccountId", "accountCode accountName paymentMethod")
        .lean();
};

/** All subscription payments (transactions ledger). */
const listSubscriptionTransactions = async (query = {}) => {
    const filter = { ...NOT_DELETED };
    if (query.status) filter.status = String(query.status);
    if (query.companyId) filter.companyId = query.companyId;
    if (query.paymentMethod) {
        filter.paymentMethod = String(query.paymentMethod).toLowerCase();
    }

    return SubscriptionPayment.find(filter)
        .sort({ createdAt: -1 })
        .populate("companyId", "companyCode name status")
        .populate(
            "invoiceId",
            "invoiceNumber paymentReference amountMinor currency intent"
        )
        .populate("subscriptionId", "subscriptionNumber planCode status")
        .populate("paymentAccountId", "accountCode accountName paymentMethod")
        .lean();
};

const listSubscriptionInvoices = async (query = {}) => {
    const filter = { ...NOT_DELETED };
    if (query.companyId) filter.companyId = query.companyId;
    if (query.status) filter.status = String(query.status);
    if (query.intent) filter.intent = String(query.intent);

    return SubscriptionInvoice.find(filter)
        .sort({ createdAt: -1 })
        .populate("companyId", "companyCode name")
        .populate("planId", "planCode name billingInterval")
        .populate("currentPaymentId", "paymentNumber status transactionId")
        .lean();
};

const listCompanyInvoices = async (companyId) =>
    listSubscriptionInvoices({ companyId });

const listCompanyPayments = async (companyId) => {
    return SubscriptionPayment.find({ companyId, ...NOT_DELETED })
        .sort({ createdAt: -1 })
        .populate("invoiceId", "invoiceNumber paymentReference status intent")
        .lean();
};

const getBillingOverview = async () => {
    const monthStart = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
    );

    const [
        pendingPayments,
        unpaidInvoices,
        overdueInvoices,
        paidInvoicesMonth,
        verifiedPaymentsMonth,
        rejectedPaymentsMonth,
        activeAccounts,
        totalAccounts,
        recentPendingPayments,
        recentUnpaidInvoices,
        revenueByCurrency,
        accountsByMethod,
        unpaidSubscriptions,
    ] = await Promise.all([
        SubscriptionPayment.countDocuments({
            status: "pending_verification",
            ...NOT_DELETED,
        }),
        SubscriptionInvoice.countDocuments({
            status: { $in: ["unpaid", "overdue", "pending"] },
            ...NOT_DELETED,
        }),
        SubscriptionInvoice.countDocuments({
            status: "overdue",
            ...NOT_DELETED,
        }),
        SubscriptionInvoice.countDocuments({
            status: "paid",
            paidAt: { $gte: monthStart },
            ...NOT_DELETED,
        }),
        SubscriptionPayment.countDocuments({
            status: "verified",
            verifiedAt: { $gte: monthStart },
            ...NOT_DELETED,
        }),
        SubscriptionPayment.countDocuments({
            status: "rejected",
            rejectedAt: { $gte: monthStart },
            ...NOT_DELETED,
        }),
        PlatformPaymentAccount.countDocuments({
            isActive: true,
            ...NOT_DELETED,
        }),
        PlatformPaymentAccount.countDocuments({ ...NOT_DELETED }),
        SubscriptionPayment.find({
            status: "pending_verification",
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .limit(8)
            .populate("companyId", "companyCode name")
            .populate(
                "invoiceId",
                "invoiceNumber paymentReference amountMinor currency intent"
            )
            .lean(),
        SubscriptionInvoice.find({
            status: { $in: ["unpaid", "overdue", "pending"] },
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .limit(8)
            .populate("companyId", "companyCode name")
            .populate("planId", "planCode name")
            .lean(),
        SubscriptionInvoice.aggregate([
            {
                $match: {
                    status: "paid",
                    paidAt: { $gte: monthStart },
                    isDeleted: { $ne: true },
                },
            },
            {
                $group: {
                    _id: "$currency",
                    totalMinor: { $sum: "$amountMinor" },
                    count: { $sum: 1 },
                },
            },
            { $sort: { totalMinor: -1 } },
        ]),
        PlatformPaymentAccount.aggregate([
            { $match: { isActive: true, isDeleted: { $ne: true } } },
            { $group: { _id: "$paymentMethod", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        CompanySubscription.countDocuments({
            paymentStatus: { $in: ["unpaid", "pending"] },
            status: { $in: ["active", "trialing", "pending", "suspended"] },
            ...NOT_DELETED,
        }),
    ]);

    return {
        pendingPayments,
        unpaidInvoices,
        overdueInvoices,
        paidInvoicesThisMonth: paidInvoicesMonth,
        verifiedPaymentsThisMonth: verifiedPaymentsMonth,
        rejectedPaymentsThisMonth: rejectedPaymentsMonth,
        activePaymentAccounts: activeAccounts,
        totalPaymentAccounts: totalAccounts,
        unpaidSubscriptions,
        recentPendingPayments,
        recentUnpaidInvoices,
        revenueThisMonth: revenueByCurrency.map((r) => ({
            currency: r._id || "USD",
            totalMinor: r.totalMinor || 0,
            count: r.count || 0,
        })),
        accountsByMethod: accountsByMethod.map((r) => ({
            method: r._id || "unknown",
            count: r.count || 0,
        })),
        generatedAt: new Date().toISOString(),
    };
};

const getSubscriptionPayment = async (id) => {
    const row = await populatePayment(id);
    if (!row || row.isDeleted) throw new AppError("Payment not found.", 404);
    return row;
};

const getSubscriptionInvoice = async (id, companyId = null) => {
    const filter = { _id: id, ...NOT_DELETED };
    if (companyId) filter.companyId = companyId;
    const row = await SubscriptionInvoice.findOne(filter)
        .populate("planId")
        .populate("paymentAccountId")
        .populate("currentPaymentId")
        .lean();
    if (!row) throw new AppError("Invoice not found.", 404);
    return row;
};

module.exports = {
    createCheckoutInvoice,
    submitSubscriptionPayment,
    approveSubscriptionPayment,
    rejectSubscriptionPayment,
    listIncomingPayments,
    listSubscriptionTransactions,
    listSubscriptionInvoices,
    listCompanyInvoices,
    listCompanyPayments,
    getBillingOverview,
    getSubscriptionPayment,
    getSubscriptionInvoice,
    buildPaymentReference,
    resolveActivationPeriods,
    _test: {
        addInterval,
        buildPaymentReference,
        resolveActivationPeriods,
    },
};
