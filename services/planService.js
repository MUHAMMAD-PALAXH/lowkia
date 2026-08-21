const mongoose = require("mongoose");
const SubscriptionPlan = require("../model/subscriptionPlan");
const CompanySubscription = require("../model/companySubscription");
const AppError = require("../utils/appError");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const PLAN_FEATURE_CATALOG = [
    { key: "pos", label: "POS", group: "Core ERP" },
    { key: "sales", label: "Sales", group: "Core ERP" },
    { key: "purchase", label: "Purchase", group: "Core ERP" },
    { key: "inventory", label: "Inventory", group: "Inventory" },
    { key: "warehouse", label: "Warehouse", group: "Inventory" },
    { key: "imei", label: "IMEI Tracking", group: "Operations" },
    { key: "repair", label: "Repair Management", group: "Service" },
    { key: "attendance", label: "Attendance", group: "People" },
    { key: "finance", label: "Finance", group: "Finance" },
    { key: "payroll", label: "Payroll", group: "Finance" },
    { key: "reports", label: "Reports", group: "Analytics" },
    { key: "analytics", label: "Analytics", group: "Analytics" },
    { key: "coupons", label: "Coupons", group: "Operations" },
    { key: "notifications", label: "Notifications", group: "Operations" },
];

const deriveProductFamily = (planCode = "", name = "") => {
    const code = String(planCode || "").toUpperCase();
    if (code.includes("STARTER")) return "STARTER";
    if (code.includes("PRO")) return "PRO";
    if (code.includes("ENTERPRISE")) return "ENTERPRISE";
    const base = code.replace(/_(MONTHLY|YEARLY)$/i, "").trim();
    if (base) return base;
    return (
        String(name || "OTHER")
            .toUpperCase()
            .replace(/\s+(MONTHLY|YEARLY)$/i, "")
            .replace(/\s+/g, "_")
            .slice(0, 32) || "OTHER"
    );
};

const normalizeLimits = (raw = {}) => {
    const out = {};
    for (const key of [
        "maxUsers",
        "maxBranches",
        "maxWarehouses",
        "maxProducts",
    ]) {
        if (raw[key] === null || raw[key] === undefined || raw[key] === "") {
            out[key] = null;
            continue;
        }
        const n = Number(raw[key]);
        if (!Number.isFinite(n) || n < 0) {
            throw new AppError(
                `${key} must be a non-negative number or Unlimited.`,
                400
            );
        }
        out[key] = Math.floor(n);
    }
    return out;
};

const toObjectId = (id) => {
    try {
        return new mongoose.Types.ObjectId(String(id));
    } catch (_) {
        return null;
    }
};

const planStatsForIds = async (planIds = []) => {
    const oids = planIds.map(toObjectId).filter(Boolean);
    if (!oids.length) return {};

    const rows = await CompanySubscription.aggregate([
        {
            $match: {
                ...NOT_DELETED,
                planId: { $in: oids },
            },
        },
        {
            $group: {
                _id: "$planId",
                subscribers: { $sum: 1 },
                active: {
                    $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
                },
                trialing: {
                    $sum: { $cond: [{ $eq: ["$status", "trialing"] }, 1, 0] },
                },
                expired: {
                    $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] },
                },
                cancelled: {
                    $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
                },
                mrrMinor: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ["$status", "active"] },
                                    { $eq: ["$paymentStatus", "paid"] },
                                ],
                            },
                            {
                                $cond: [
                                    { $eq: ["$billingInterval", "yearly"] },
                                    { $divide: ["$amountMinor", 12] },
                                    "$amountMinor",
                                ],
                            },
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const map = {};
    for (const r of rows) {
        map[String(r._id)] = {
            subscribers: r.subscribers || 0,
            active: r.active || 0,
            trialing: r.trialing || 0,
            expired: r.expired || 0,
            cancelled: r.cancelled || 0,
            mrrMinor: Math.round(r.mrrMinor || 0),
        };
    }
    return map;
};

const enrichPlan = (plan, stats = null) => {
    const plain = plan.toObject ? plan.toObject() : { ...plan };
    const limits = plain.limits || {};
    const status =
        plain.status || (plain.isActive === false ? "Inactive" : "Active");
    return {
        ...plain,
        id: String(plain._id),
        code: plain.planCode,
        productFamily:
            plain.productFamily ||
            deriveProductFamily(plain.planCode, plain.name),
        status,
        isActive: status === "Active",
        description: plain.description || "",
        limits: {
            maxUsers: limits.maxUsers ?? null,
            maxBranches: limits.maxBranches ?? null,
            maxWarehouses: limits.maxWarehouses ?? null,
            maxProducts: limits.maxProducts ?? null,
        },
        features: Array.isArray(plain.features) ? plain.features : [],
        stats: stats || {
            subscribers: 0,
            active: 0,
            trialing: 0,
            expired: 0,
            cancelled: 0,
            mrrMinor: 0,
        },
    };
};

const getPlanById = async (planId) => {
    const plan = await SubscriptionPlan.findOne({
        _id: planId,
        ...NOT_DELETED,
    });
    if (!plan) throw new AppError("Subscription plan not found.", 404);
    return plan;
};

const listPlansEnriched = async (query = {}) => {
    const filter = { ...NOT_DELETED };

    if (query.activeOnly === "true" || query.activeOnly === true) {
        filter.$or = [
            { status: "Active" },
            { status: { $exists: false }, isActive: true },
        ];
    }
    if (query.status) filter.status = query.status;
    if (query.billingInterval) filter.billingInterval = query.billingInterval;
    if (query.search) {
        const q = String(query.search).trim();
        filter.$or = [
            { name: { $regex: q, $options: "i" } },
            { planCode: { $regex: q, $options: "i" } },
            { description: { $regex: q, $options: "i" } },
        ];
    }

    const plans = await SubscriptionPlan.find(filter)
        .sort({ sortOrder: 1, name: 1 })
        .lean();
    const statsMap = await planStatsForIds(plans.map((p) => p._id));
    return plans.map((p) => enrichPlan(p, statsMap[String(p._id)]));
};

const getPlansSummary = async () => {
    const plans = await SubscriptionPlan.find(NOT_DELETED).lean();
    const statsMap = await planStatsForIds(plans.map((p) => p._id));
    let totalSubscribers = 0;
    let mrrMinor = 0;
    let activePlans = 0;
    for (const p of plans) {
        const st = p.status || (p.isActive === false ? "Inactive" : "Active");
        if (st === "Active") activePlans += 1;
        const s = statsMap[String(p._id)] || {};
        totalSubscribers += s.subscribers || 0;
        mrrMinor += s.mrrMinor || 0;
    }
    return {
        totalPlans: plans.length,
        activePlans,
        totalSubscribers,
        mrrMinor,
        currency: "USD",
        featureCatalog: PLAN_FEATURE_CATALOG,
    };
};

const getPlanDetail = async (planId) => {
    const plan = await getPlanById(planId);
    const statsMap = await planStatsForIds([plan._id]);
    return enrichPlan(plan, statsMap[String(plan._id)]);
};

const createPlan = async (payload = {}, actor = null) => {
    const name = String(payload.name || "").trim();
    const planCode = String(payload.planCode || payload.code || "")
        .trim()
        .toUpperCase();
    if (!name) throw new AppError("Plan name is required.", 400);
    if (!planCode) throw new AppError("Plan code is required.", 400);

    const exists = await SubscriptionPlan.findOne({ planCode });
    if (exists) throw new AppError("Plan code already exists.", 409);

    const billingInterval = ["monthly", "yearly"].includes(
        payload.billingInterval
    )
        ? payload.billingInterval
        : "monthly";
    const priceMinor = Number(payload.priceMinor);
    if (!Number.isFinite(priceMinor) || priceMinor < 0) {
        throw new AppError("priceMinor must be a non-negative number.", 400);
    }
    const trialDays = Math.max(0, parseInt(payload.trialDays, 10) || 0);
    const status = ["Active", "Inactive", "Archived"].includes(payload.status)
        ? payload.status
        : "Active";

    const doc = await SubscriptionPlan.create({
        name,
        planCode,
        description: String(payload.description || "").trim(),
        billingInterval,
        priceMinor,
        currency: String(payload.currency || "USD").trim().toUpperCase(),
        trialDays,
        limits: normalizeLimits(payload.limits || {}),
        features: Array.isArray(payload.features)
            ? payload.features
                  .map((f) => String(f).trim().toLowerCase())
                  .filter(Boolean)
            : [],
        status,
        isActive: status === "Active",
        visibility: payload.visibility === "Private" ? "Private" : "Public",
        isRecommended: payload.isRecommended === true,
        productFamily:
            String(payload.productFamily || "").trim().toUpperCase() ||
            deriveProductFamily(planCode, name),
        sortOrder: Number(payload.sortOrder) || 0,
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });

    await writeActivityLog({
        user: actor,
        companyId: null,
        activityType: "Create",
        module: "Platform",
        subModule: "Plan",
        description: `Created plan ${doc.planCode}`,
        shortDescription: `Plan created ${doc.planCode}`,
        referenceType: "CompanySubscription",
        referenceId: doc._id,
        newData: { planCode: doc.planCode, priceMinor: doc.priceMinor },
        securityLevel: "High",
    });

    return enrichPlan(doc);
};

const updatePlan = async (planId, payload = {}, actor = null) => {
    const plan = await getPlanById(planId);
    const old = {
        priceMinor: plan.priceMinor,
        status: plan.status || (plan.isActive ? "Active" : "Inactive"),
        limits: plan.limits,
        features: [...(plan.features || [])],
    };

    if (payload.name !== undefined) {
        const name = String(payload.name || "").trim();
        if (!name) throw new AppError("Plan name cannot be empty.", 400);
        plan.name = name;
    }
    if (payload.description !== undefined) {
        plan.description = String(payload.description || "").trim();
    }
    if (payload.billingInterval !== undefined) {
        if (!["monthly", "yearly"].includes(payload.billingInterval)) {
            throw new AppError("Invalid billingInterval.", 400);
        }
        plan.billingInterval = payload.billingInterval;
    }
    if (payload.priceMinor !== undefined) {
        const priceMinor = Number(payload.priceMinor);
        if (!Number.isFinite(priceMinor) || priceMinor < 0) {
            throw new AppError("priceMinor must be a non-negative number.", 400);
        }
        plan.priceMinor = priceMinor;
    }
    if (payload.currency !== undefined) {
        plan.currency = String(payload.currency || "USD").trim().toUpperCase();
    }
    if (payload.trialDays !== undefined) {
        const trialDays = parseInt(payload.trialDays, 10);
        if (!Number.isFinite(trialDays) || trialDays < 0) {
            throw new AppError("trialDays must be >= 0.", 400);
        }
        plan.trialDays = trialDays;
    }
    if (payload.limits !== undefined) {
        plan.limits = normalizeLimits(payload.limits || {});
        plan.markModified("limits");
    }
    if (payload.features !== undefined) {
        plan.features = Array.isArray(payload.features)
            ? payload.features
                  .map((f) => String(f).trim().toLowerCase())
                  .filter(Boolean)
            : [];
    }
    if (payload.status !== undefined) {
        if (!["Active", "Inactive", "Archived"].includes(payload.status)) {
            throw new AppError("Invalid plan status.", 400);
        }
        plan.status = payload.status;
        plan.isActive = payload.status === "Active";
    }
    if (payload.visibility !== undefined) {
        plan.visibility =
            payload.visibility === "Private" ? "Private" : "Public";
    }
    if (payload.isRecommended !== undefined) {
        plan.isRecommended = payload.isRecommended === true;
    }
    if (payload.productFamily !== undefined) {
        plan.productFamily = String(payload.productFamily || "")
            .trim()
            .toUpperCase();
    }
    if (payload.sortOrder !== undefined) {
        plan.sortOrder = Number(payload.sortOrder) || 0;
    }

    plan.updatedBy = actor?._id || plan.updatedBy;
    await plan.save();

    await writeActivityLog({
        user: actor,
        companyId: null,
        activityType: "Update",
        module: "Platform",
        subModule: "Plan",
        description: `Updated plan ${plan.planCode}`,
        shortDescription: `Plan updated ${plan.planCode}`,
        referenceType: "CompanySubscription",
        referenceId: plan._id,
        oldData: old,
        newData: {
            priceMinor: plan.priceMinor,
            status: plan.status,
            limits: plan.limits,
            features: plan.features,
        },
        securityLevel: "High",
    });

    const statsMap = await planStatsForIds([plan._id]);
    return enrichPlan(plan, statsMap[String(plan._id)]);
};

const setPlanStatus = async (planId, status, actor = null) =>
    updatePlan(planId, { status }, actor);

const duplicatePlan = async (planId, actor = null) => {
    const source = await getPlanById(planId);
    let planCode = `${source.planCode}_COPY`;
    let n = 1;
    while (await SubscriptionPlan.findOne({ planCode })) {
        n += 1;
        planCode = `${source.planCode}_COPY${n}`;
    }
    return createPlan(
        {
            name: `${source.name} (Copy)`,
            planCode,
            description: source.description,
            billingInterval: source.billingInterval,
            priceMinor: source.priceMinor,
            currency: source.currency,
            trialDays: source.trialDays,
            limits: source.limits,
            features: source.features,
            status: "Inactive",
            visibility: source.visibility || "Public",
            isRecommended: false,
            productFamily:
                source.productFamily ||
                deriveProductFamily(source.planCode, source.name),
            sortOrder: (source.sortOrder || 0) + 1,
        },
        actor
    );
};

const listPlanSubscribers = async (planId) => {
    await getPlanById(planId);
    const items = await CompanySubscription.find({
        planId,
        ...NOT_DELETED,
    })
        .populate(
            "companyId",
            "companyCode legalName tradeName status logoUrl"
        )
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

    return items.map((s) => ({
        ...s,
        id: String(s._id),
        company: s.companyId,
        mrrMinor:
            s.status === "active" && s.paymentStatus === "paid"
                ? s.billingInterval === "yearly"
                    ? Math.round((s.amountMinor || 0) / 12)
                    : s.amountMinor || 0
                : 0,
    }));
};

module.exports = {
    PLAN_FEATURE_CATALOG,
    listPlansEnriched,
    getPlansSummary,
    getPlanDetail,
    createPlan,
    updatePlan,
    setPlanStatus,
    duplicatePlan,
    listPlanSubscribers,
    enrichPlan,
};
