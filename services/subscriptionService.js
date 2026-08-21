const SubscriptionPlan = require("../model/subscriptionPlan");
const CompanySubscription = require("../model/companySubscription");
const Company = require("../model/company");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");
const { writeActivityLog } = require("./activityLogService");
const { getCompanyRaw } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const addInterval = (from, interval) => {
    const d = new Date(from);
    if (interval === "yearly") {
        d.setFullYear(d.getFullYear() + 1);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return d;
};

const addDays = (from, days) => {
    const d = new Date(from);
    d.setDate(d.getDate() + Number(days || 0));
    return d;
};

const DEFAULT_PLANS = [
    {
        planCode: "STARTER_MONTHLY",
        name: "Starter Monthly",
        description: "Core ERP for small teams",
        billingInterval: "monthly",
        priceMinor: 4900,
        currency: "USD",
        trialDays: 14,
        limits: {
            maxUsers: 10,
            maxBranches: 3,
            maxWarehouses: 5,
            maxProducts: 2000,
        },
        features: ["sales", "purchase", "inventory", "attendance"],
        sortOrder: 10,
    },
    {
        planCode: "STARTER_YEARLY",
        name: "Starter Yearly",
        description: "Starter billed annually",
        billingInterval: "yearly",
        priceMinor: 49000,
        currency: "USD",
        trialDays: 14,
        limits: {
            maxUsers: 10,
            maxBranches: 3,
            maxWarehouses: 5,
            maxProducts: 2000,
        },
        features: ["sales", "purchase", "inventory", "attendance"],
        sortOrder: 11,
    },
    {
        planCode: "PRO_MONTHLY",
        name: "Pro Monthly",
        description: "Full modules + higher limits",
        billingInterval: "monthly",
        priceMinor: 9900,
        currency: "USD",
        trialDays: 14,
        limits: {
            maxUsers: 50,
            maxBranches: 20,
            maxWarehouses: 40,
            maxProducts: 20000,
        },
        features: [
            "sales",
            "purchase",
            "inventory",
            "attendance",
            "finance",
            "payroll",
            "reports",
        ],
        sortOrder: 20,
    },
    {
        planCode: "PRO_YEARLY",
        name: "Pro Yearly",
        description: "Pro billed annually",
        billingInterval: "yearly",
        priceMinor: 99000,
        currency: "USD",
        trialDays: 14,
        limits: {
            maxUsers: 50,
            maxBranches: 20,
            maxWarehouses: 40,
            maxProducts: 20000,
        },
        features: [
            "sales",
            "purchase",
            "inventory",
            "attendance",
            "finance",
            "payroll",
            "reports",
        ],
        sortOrder: 21,
    },
];

const ensureDefaultPlans = async (actorId = null) => {
    const created = [];
    for (const plan of DEFAULT_PLANS) {
        const existing = await SubscriptionPlan.findOne({
            planCode: plan.planCode,
        });
        if (existing) continue;
        const doc = await SubscriptionPlan.create({
            ...plan,
            createdBy: actorId || null,
        });
        created.push(doc.planCode);
    }
    return created;
};

const listPlans = async (query = {}) => {
    const filter = { ...NOT_DELETED };
    if (query.activeOnly === "true" || query.activeOnly === true) {
        filter.isActive = true;
    }
    return SubscriptionPlan.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
};

const getPlanById = async (planId) => {
    const plan = await SubscriptionPlan.findOne({
        _id: planId,
        ...NOT_DELETED,
    });
    if (!plan) throw new AppError("Subscription plan not found.", 404);
    return plan;
};

const populateSub = (q) =>
    q.populate("planId", "planCode name billingInterval priceMinor currency")
        .populate("companyId", "companyCode legalName tradeName status")
        .populate("paidBy", "firstName lastName email")
        .populate("createdBy", "firstName lastName email");

/**
 * Assign (or re-assign) a plan to a company. Starts trial when plan.trialDays > 0.
 */
const assignSubscription = async (
    companyId,
    planId,
    actorId = null,
    { startTrial = true, note = "" } = {}
) => {
    const company = await getCompanyRaw(companyId);
    const plan = await getPlanById(planId);
    if (!plan.isActive) {
        throw new AppError("Plan is inactive.", 400);
    }

    const now = new Date();
    const trialDays = startTrial ? Number(plan.trialDays || 0) : 0;
    const trialing = trialDays > 0;

    const trialEndsAt = trialing ? addDays(now, trialDays) : null;
    const periodStart = now;
    const periodEnd = trialing
        ? trialEndsAt
        : addInterval(now, plan.billingInterval);

    const subscriptionNumber = await generateCode("company_subscription");

    const sub = await CompanySubscription.create({
        subscriptionNumber,
        companyId: company._id,
        planId: plan._id,
        planCode: plan.planCode,
        planName: plan.name,
        billingInterval: plan.billingInterval,
        status: trialing ? "trialing" : "active",
        paymentStatus: trialing ? "unpaid" : "unpaid",
        amountMinor: plan.priceMinor,
        currency: plan.currency,
        trialStartsAt: trialing ? now : null,
        trialEndsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        limits: plan.limits || {},
        features: plan.features || [],
        paymentNote: note || "",
        createdBy: actorId || null,
    });

    company.currentSubscriptionId = sub._id;
    company.trialEndsAt = trialEndsAt;
    if (trialing) {
        company.status = "Trial";
    } else if (company.status === "Trial" || company.status === "Suspended") {
        // stay unpaid until mark-paid; keep Trial until paid if was trial
        company.status = company.status === "Suspended" ? "Suspended" : "Trial";
    }
    company.updatedBy = actorId || company.updatedBy;
    await company.save();

    return populateSub(CompanySubscription.findById(sub._id));
};

/**
 * Manual mark-paid (V1). Activates subscription period and company.
 */
const markSubscriptionPaid = async (
    subscriptionId,
    actor,
    {
        paymentNote = "",
        paymentMethod = "manual",
        extendFromNow = true,
    } = {}
) => {
    const sub = await CompanySubscription.findOne({
        _id: subscriptionId,
        ...NOT_DELETED,
    });
    if (!sub) throw new AppError("Subscription not found.", 404);

    const now = new Date();
    const periodStart = extendFromNow
        ? now
        : sub.currentPeriodStart || now;
    const periodEnd = addInterval(periodStart, sub.billingInterval);

    sub.paymentStatus = "paid";
    sub.status = "active";
    sub.paidAt = now;
    sub.paidBy = actor?._id || null;
    sub.paymentMethod = [
        "manual",
        "bank_transfer",
        "cash",
        "other",
        "gateway",
    ].includes(paymentMethod)
        ? paymentMethod
        : "manual";
    if (paymentNote) sub.paymentNote = String(paymentNote).trim();
    sub.currentPeriodStart = periodStart;
    sub.currentPeriodEnd = periodEnd;
    sub.updatedBy = actor?._id || sub.updatedBy;
    await sub.save();

    const company = await getCompanyRaw(sub.companyId);
    company.currentSubscriptionId = sub._id;
    company.status = "Active";
    company.trialEndsAt = null;
    company.updatedBy = actor?._id || company.updatedBy;
    await company.save();

    await writeActivityLog({
        user: actor,
        companyId: company._id,
        activityType: "Update",
        module: "Platform",
        subModule: "MarkPaid",
        description: `Marked subscription ${sub.subscriptionNumber} paid for ${company.companyCode}`,
        shortDescription: `Mark paid ${sub.subscriptionNumber}`,
        referenceType: "CompanySubscription",
        referenceId: sub._id,
        newData: {
            paymentStatus: "paid",
            periodEnd,
            amountMinor: sub.amountMinor,
        },
        securityLevel: "High",
    });

    return populateSub(CompanySubscription.findById(sub._id));
};

const cancelSubscription = async (
    subscriptionId,
    actorId = null,
    reason = ""
) => {
    const sub = await CompanySubscription.findOne({
        _id: subscriptionId,
        ...NOT_DELETED,
    });
    if (!sub) throw new AppError("Subscription not found.", 404);

    sub.status = "cancelled";
    sub.cancelledAt = new Date();
    sub.cancelReason = String(reason || "").trim();
    sub.updatedBy = actorId || sub.updatedBy;
    await sub.save();

    return populateSub(CompanySubscription.findById(sub._id));
};

/**
 * Extend trial by N days (audit reason required for platform ops).
 */
const extendTrial = async (
    subscriptionId,
    actor,
    { days = 7, reason = "" } = {}
) => {
    const n = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
    const sub = await CompanySubscription.findOne({
        _id: subscriptionId,
        ...NOT_DELETED,
    });
    if (!sub) throw new AppError("Subscription not found.", 404);

    const base =
        sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()
            ? new Date(sub.trialEndsAt)
            : new Date();
    const nextEnd = addDays(base, n);

    sub.status = "trialing";
    sub.trialEndsAt = nextEnd;
    if (!sub.trialStartsAt) sub.trialStartsAt = new Date();
    sub.currentPeriodEnd = nextEnd;
    sub.updatedBy = actor?._id || sub.updatedBy;
    await sub.save();

    const company = await getCompanyRaw(sub.companyId);
    company.status = "Trial";
    company.trialEndsAt = nextEnd;
    company.updatedBy = actor?._id || company.updatedBy;
    await company.save();

    await writeActivityLog({
        user: actor,
        companyId: company._id,
        activityType: "Update",
        module: "Platform",
        subModule: "ExtendTrial",
        description: `Extended trial for ${company.companyCode} by ${n} days${reason ? `: ${reason}` : ""}`,
        shortDescription: `Extend trial +${n}d`,
        referenceType: "CompanySubscription",
        referenceId: sub._id,
        newData: { trialEndsAt: nextEnd, days: n, reason },
        securityLevel: "High",
    });

    return populateSub(CompanySubscription.findById(sub._id));
};

/**
 * Renew: extend period from currentPeriodEnd (early renewal preserves remaining time).
 * Leaves payment unpaid until mark-paid unless markPaidNow.
 */
const renewSubscription = async (
    subscriptionId,
    actor,
    { markPaidNow = false, paymentNote = "", paymentMethod = "manual" } = {}
) => {
    const sub = await CompanySubscription.findOne({
        _id: subscriptionId,
        ...NOT_DELETED,
    });
    if (!sub) throw new AppError("Subscription not found.", 404);

    const now = new Date();
    const baseEnd =
        sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now
            ? new Date(sub.currentPeriodEnd)
            : now;
    const periodStart = baseEnd;
    const periodEnd = addInterval(periodStart, sub.billingInterval);

    sub.currentPeriodStart = periodStart;
    sub.currentPeriodEnd = periodEnd;
    sub.status = markPaidNow ? "active" : sub.status === "expired" ? "active" : sub.status;
    if (markPaidNow) {
        sub.paymentStatus = "paid";
        sub.paidAt = now;
        sub.paidBy = actor?._id || null;
        sub.paymentMethod = paymentMethod || "manual";
        if (paymentNote) sub.paymentNote = String(paymentNote).trim();
    } else {
        sub.paymentStatus = "unpaid";
    }
    sub.updatedBy = actor?._id || sub.updatedBy;
    await sub.save();

    const company = await getCompanyRaw(sub.companyId);
    company.currentSubscriptionId = sub._id;
    if (markPaidNow) {
        company.status = "Active";
        company.trialEndsAt = null;
    }
    company.updatedBy = actor?._id || company.updatedBy;
    await company.save();

    await writeActivityLog({
        user: actor,
        companyId: company._id,
        activityType: "Update",
        module: "Platform",
        subModule: "Renew",
        description: `Renewed subscription ${sub.subscriptionNumber} for ${company.companyCode}`,
        shortDescription: `Renew ${sub.subscriptionNumber}`,
        referenceType: "CompanySubscription",
        referenceId: sub._id,
        newData: {
            periodStart,
            periodEnd,
            paymentStatus: sub.paymentStatus,
            markPaidNow,
        },
        securityLevel: "High",
    });

    return populateSub(CompanySubscription.findById(sub._id));
};

const getCompanySubscription = async (companyId) => {
    const company = await getCompanyRaw(companyId);
    if (company.currentSubscriptionId) {
        const current = await populateSub(
            CompanySubscription.findOne({
                _id: company.currentSubscriptionId,
                ...NOT_DELETED,
            })
        );
        if (current) return current;
    }
    return populateSub(
        CompanySubscription.findOne({
            companyId,
            ...NOT_DELETED,
        }).sort({ createdAt: -1 })
    );
};

const listCompanySubscriptions = async (companyId) => {
    return populateSub(
        CompanySubscription.find({ companyId, ...NOT_DELETED }).sort({
            createdAt: -1,
        })
    );
};

/**
 * Soft-check subscription health for Enter Company / ERP.
 * Does not block Trial; blocks Suspended/Cancelled/Closed companies (via getCompanyById).
 */
const assertSubscriptionAllowsAccess = async (company) => {
    if (!company?.currentSubscriptionId) return null;
    const sub = await CompanySubscription.findById(company.currentSubscriptionId);
    if (!sub || sub.isDeleted) return null;

    if (sub.status === "cancelled" || sub.status === "expired") {
        throw new AppError(
            `Subscription is ${sub.status}. Renew or mark paid to continue.`,
            403
        );
    }

    if (
        sub.status === "trialing" &&
        sub.trialEndsAt &&
        new Date(sub.trialEndsAt) < new Date()
    ) {
        sub.status = "expired";
        await sub.save();
        company.status = "Suspended";
        await company.save();
        throw new AppError("Trial expired. Mark paid to reactivate.", 403);
    }

    if (
        sub.status === "active" &&
        sub.currentPeriodEnd &&
        new Date(sub.currentPeriodEnd) < new Date() &&
        sub.paymentStatus !== "paid"
    ) {
        sub.status = "past_due";
        await sub.save();
    }

    return sub;
};

module.exports = {
    ensureDefaultPlans,
    listPlans,
    getPlanById,
    assignSubscription,
    markSubscriptionPaid,
    cancelSubscription,
    extendTrial,
    renewSubscription,
    getCompanySubscription,
    listCompanySubscriptions,
    assertSubscriptionAllowsAccess,
    // exported for unit tests
    _test: { addInterval, addDays },
};
