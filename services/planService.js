const mongoose = require("mongoose");
const SubscriptionPlan = require("../model/subscriptionPlan");
const CompanySubscription = require("../model/companySubscription");
const AppError = require("../utils/appError");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const PLAN_FEATURE_CATALOG = [
    { key: "Dashboard", label: "Overview", group: "Overview" },
    { key: "Customers", label: "Customers", group: "Sales" },
    { key: "SalesOrders", label: "Sales orders", group: "Sales" },
    { key: "SalesReturns", label: "Returns", group: "Sales" },
    { key: "Order", label: "Online orders", group: "Sales" },
    { key: "Products", label: "Products", group: "Catalog" },
    { key: "ProductApprovals", label: "Approvals", group: "Catalog" },
    { key: "Category", label: "Categories", group: "Catalog" },
    { key: "SubCategory", label: "Sub categories", group: "Catalog" },
    { key: "Brands", label: "Brands", group: "Catalog" },
    { key: "VariantType", label: "Variant types", group: "Catalog" },
    { key: "Variants", label: "Variants", group: "Catalog" },
    { key: "Supplier", label: "Suppliers", group: "Purchasing" },
    { key: "PurchaseOrders", label: "Purchase orders", group: "Purchasing" },
    { key: "GRN", label: "GRN", group: "Purchasing" },
    { key: "Warehouse", label: "Warehouses", group: "Purchasing" },
    { key: "StockManagement", label: "Stock", group: "Inventory" },
    { key: "Warranty", label: "Warranty", group: "Inventory" },
    { key: "Branches", label: "Branches", group: "Operations" },
    { key: "BranchTransfer", label: "Transfers", group: "Operations" },
    { key: "RepairTickets", label: "Repairs", group: "Operations" },
    { key: "Attendance", label: "Attendance", group: "Operations" },
    { key: "Finance", label: "Finance", group: "Operations" },
    { key: "SubscriptionPlans", label: "Plans", group: "Subscription" },
    { key: "CompanyBilling", label: "Billing", group: "Subscription" },
    { key: "SalesReport", label: "Sales order reports", group: "Insights" },
    { key: "PurchaseReport", label: "Purchase reports", group: "Insights" },
    { key: "InventoryReport", label: "Inventory reports", group: "Insights" },
    { key: "RepairReport", label: "Repair reports", group: "Insights" },
    { key: "ProfitLoss", label: "Profit / loss", group: "Insights" },
    { key: "Analytics", label: "Online sales analytics", group: "Insights" },
    { key: "Coupon", label: "Coupons", group: "Growth" },
    { key: "Poster", label: "Posters", group: "Growth" },
    { key: "Notifications", label: "Notifications", group: "Admin" },
    { key: "Users", label: "Users", group: "Admin" },
    { key: "AccountPermission", label: "Permissions", group: "Admin" },
    { key: "Profile", label: "Profile", group: "Account" },
];

const BILLING_INTERVALS = ["monthly", "quarterly", "yearly", "lifetime"];
const USER_ROLE_KEYS = [
    "company_super_admin",
    "admin",
    "employee",
    "vendor",
];
const PRODUCT_SOURCE_KEYS = ["po_completed", "manual", "vendor"];

const parseQtyCap = (key, raw) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        throw new AppError(
            `${key} must be a non-negative number or Unlimited.`,
            400
        );
    }
    return Math.floor(n);
};

const parseSlot = (label, raw = {}, { defaultEnabled = false } = {}) => {
    const enabled = raw.enabled === true || (raw.enabled == null && defaultEnabled);
    const unlimited = raw.unlimited === true;
    if (!enabled) {
        return { enabled: false, unlimited: false, qty: 0 };
    }
    if (unlimited) {
        return { enabled: true, unlimited: true, qty: null };
    }
    const qty = parseQtyCap(label, raw.qty ?? raw.max ?? 0);
    return { enabled: true, unlimited: false, qty: qty ?? 0 };
};

const sumSlots = (slots, keys) => {
    let any = false;
    let unlimited = false;
    let total = 0;
    for (const key of keys) {
        const s = slots[key];
        if (!s?.enabled) continue;
        any = true;
        if (s.unlimited) unlimited = true;
        else total += Number(s.qty) || 0;
    }
    if (!any) return 0;
    if (unlimited) return null;
    return total;
};

const deriveProductFamily = (planCode = "", name = "") => {
    const code = String(planCode || "").toUpperCase();
    if (code.includes("STARTER")) return "STARTER";
    if (code.includes("PRO")) return "PRO";
    if (code.includes("ENTERPRISE")) return "ENTERPRISE";
    const base = code
        .replace(/_(MONTHLY|QUARTERLY|YEARLY|LIFETIME)$/i, "")
        .trim();
    if (base) return base;
    return (
        String(name || "OTHER")
            .toUpperCase()
            .replace(/\s+(MONTHLY|QUARTERLY|YEARLY|LIFETIME)$/i, "")
            .replace(/\s+/g, "_")
            .slice(0, 32) || "OTHER"
    );
};

const normalizeLimits = (raw = {}) => {
    const users = {};
    const rawUsers = raw.users && typeof raw.users === "object" ? raw.users : {};
    const hasUserTree = USER_ROLE_KEYS.some((k) => rawUsers[k] != null);
    if (hasUserTree) {
        for (const key of USER_ROLE_KEYS) {
            users[key] = parseSlot(`users.${key}`, rawUsers[key] || {});
        }
    } else {
        const n = parseQtyCap("maxUsers", raw.maxUsers);
        for (const key of USER_ROLE_KEYS) {
            users[key] = {
                enabled: true,
                unlimited: n == null,
                qty: n,
            };
        }
    }

    const products = {};
    const rawProducts =
        raw.products && typeof raw.products === "object" ? raw.products : {};
    const hasProductTree = PRODUCT_SOURCE_KEYS.some((k) => rawProducts[k] != null);
    if (hasProductTree) {
        for (const key of PRODUCT_SOURCE_KEYS) {
            products[key] = parseSlot(`products.${key}`, rawProducts[key] || {});
        }
    } else {
        const n = parseQtyCap("maxProducts", raw.maxProducts);
        for (const key of PRODUCT_SOURCE_KEYS) {
            products[key] = {
                enabled: true,
                unlimited: n == null,
                qty: n,
            };
        }
    }

    const out = {
        maxBranches: parseQtyCap("maxBranches", raw.maxBranches),
        maxWarehouses: parseQtyCap("maxWarehouses", raw.maxWarehouses),
        maxSuppliers: parseQtyCap("maxSuppliers", raw.maxSuppliers),
        users,
        products,
    };
    out.maxUsers = sumSlots(users, USER_ROLE_KEYS);
    out.maxProducts = sumSlots(products, PRODUCT_SOURCE_KEYS);
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

    // Count only each company's *current* subscription — historical assign/
    // renew rows must not inflate subscriber or MRR totals.
    const rows = await CompanySubscription.aggregate([
        {
            $match: {
                ...NOT_DELETED,
                planId: { $in: oids },
            },
        },
        {
            $lookup: {
                from: "companies",
                let: { subId: "$_id", companyId: "$companyId" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$_id", "$$companyId"] },
                                    {
                                        $eq: [
                                            "$currentSubscriptionId",
                                            "$$subId",
                                        ],
                                    },
                                    { $ne: ["$isDeleted", true] },
                                ],
                            },
                        },
                    },
                    { $project: { _id: 1 } },
                ],
                as: "asCurrent",
            },
        },
        { $match: { "asCurrent.0": { $exists: true } } },
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
            maxSuppliers: limits.maxSuppliers ?? null,
            users: limits.users || {},
            products: limits.products || {},
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

    const billingInterval = BILLING_INTERVALS.includes(
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
                  .map((f) => String(f).trim())
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
        if (!BILLING_INTERVALS.includes(payload.billingInterval)) {
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
                  .map((f) => String(f).trim())
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
    const items = await CompanySubscription.aggregate([
        {
            $match: {
                planId: toObjectId(planId),
                ...NOT_DELETED,
            },
        },
        {
            $lookup: {
                from: "companies",
                let: { subId: "$_id", companyId: "$companyId" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$_id", "$$companyId"] },
                                    {
                                        $eq: [
                                            "$currentSubscriptionId",
                                            "$$subId",
                                        ],
                                    },
                                    { $ne: ["$isDeleted", true] },
                                ],
                            },
                        },
                    },
                    {
                        $project: {
                            companyCode: 1,
                            legalName: 1,
                            tradeName: 1,
                            status: 1,
                            logoUrl: 1,
                        },
                    },
                ],
                as: "company",
            },
        },
        { $match: { "company.0": { $exists: true } } },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
    ]);

    return items.map((s) => {
        const company = Array.isArray(s.company) ? s.company[0] : null;
        const interval = s.billingInterval;
        const mrr =
            s.status === "active" && s.paymentStatus === "paid"
                ? interval === "yearly"
                    ? Math.round((s.amountMinor || 0) / 12)
                    : interval === "quarterly"
                      ? Math.round((s.amountMinor || 0) / 3)
                      : interval === "lifetime"
                        ? 0
                        : s.amountMinor || 0
                : 0;
        return {
            ...s,
            id: String(s._id),
            company,
            mrrMinor: mrr,
        };
    });
};

const isPlanRoleEnabled = (limits, role) => {
    const r = role === "branch_manager" ? "employee" : String(role || "");
    const users = limits?.users;
    if (!users || typeof users !== "object" || !Object.keys(users).length) {
        return true;
    }
    return users[r]?.enabled === true;
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
    isPlanRoleEnabled,
};
