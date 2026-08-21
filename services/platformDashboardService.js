const Company = require("../model/company");
const CompanySubscription = require("../model/companySubscription");
const AdminUser = require("../model/adminUser");
const SubscriptionPlan = require("../model/subscriptionPlan");
const { ROLES } = require("../constants/roles");

const NOT_DELETED = { isDeleted: { $ne: true } };

const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
};

/** Inclusive month window in local server time (start → next month start). */
const monthWindow = (ref = new Date()) => {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
};

/**
 * Load only each company's *current* subscription (not historical rows).
 */
const loadCurrentSubscriptions = async () => {
    const companies = await Company.find({
        ...NOT_DELETED,
        currentSubscriptionId: { $ne: null },
    })
        .select(
            "_id companyCode legalName tradeName status logoUrl currentSubscriptionId"
        )
        .lean();

    if (!companies.length) return { companies: [], subscriptions: [], paired: [] };

    const subIds = companies
        .map((c) => c.currentSubscriptionId)
        .filter(Boolean);

    const subscriptions = await CompanySubscription.find({
        _id: { $in: subIds },
        ...NOT_DELETED,
    })
        .select(
            "companyId planId planCode planName status paymentStatus billingInterval amountMinor currency currentPeriodEnd trialEndsAt paidAt"
        )
        .lean();

    const byId = Object.fromEntries(
        subscriptions.map((s) => [String(s._id), s])
    );

    const paired = [];
    for (const company of companies) {
        const sub = byId[String(company.currentSubscriptionId)];
        if (!sub) continue;
        paired.push({ company, sub });
    }

    return { companies, subscriptions: paired.map((p) => p.sub), paired };
};

/**
 * Active login users that belong to a non-deleted company (excludes Global SA).
 */
const countActiveCompanyUsers = async () => {
    const companyIds = await Company.find({ ...NOT_DELETED }).distinct("_id");
    if (!companyIds.length) return 0;

    return AdminUser.countDocuments({
        isDeleted: { $ne: true },
        role: { $ne: ROLES.GLOBAL_SUPER_ADMIN },
        companyId: { $in: companyIds },
        status: "Active",
        isApproved: true,
    });
};

/**
 * Real SaaS metrics from Company + current CompanySubscription only.
 * Never fabricates revenue — only sums paid subscription amounts.
 */
const getPlatformDashboard = async () => {
    const now = new Date();
    const in7 = daysFromNow(7);
    const { start: monthStart, end: monthEnd } = monthWindow(now);

    const [
        totalCompanies,
        byStatus,
        newThisMonth,
        current,
        companyUsers,
        activePlans,
        totalPlans,
    ] = await Promise.all([
        Company.countDocuments(NOT_DELETED),
        Company.aggregate([
            { $match: NOT_DELETED },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Company.countDocuments({
            ...NOT_DELETED,
            createdAt: { $gte: monthStart, $lt: monthEnd },
        }),
        loadCurrentSubscriptions(),
        countActiveCompanyUsers(),
        SubscriptionPlan.countDocuments({
            ...NOT_DELETED,
            $or: [
                { status: "Active" },
                { status: { $exists: false }, isActive: true },
            ],
        }),
        SubscriptionPlan.countDocuments(NOT_DELETED),
    ]);

    const statusMap = Object.fromEntries(
        byStatus.map((r) => [r._id || "Unspecified", r.count])
    );

    const activeCompanies = statusMap.Active || 0;
    const trialCompanies = statusMap.Trial || 0;
    const suspendedCompanies = statusMap.Suspended || 0;
    const cancelledCompanies = statusMap.Cancelled || 0;
    const closedCompanies = statusMap.Closed || 0;
    const blockedCompanies = statusMap.Blocked || 0;

    const currentSubs = current.paired || [];
    const liveSubs = currentSubs.filter(
        (p) =>
            p.sub.status === "active" ||
            p.sub.status === "trialing" ||
            p.sub.status === "past_due"
    );

    const expiredSubs = currentSubs.filter(
        (p) => p.sub.status === "expired"
    ).length;

    let mrrMinor = 0;
    let mrrCurrency = "USD";
    const planDist = {};
    let unpaidCount = 0;
    const expiringSoon = [];

    for (const { company, sub } of currentSubs) {
        const planLabel =
            (sub.planName && String(sub.planName).trim()) ||
            (sub.planCode && String(sub.planCode).trim()) ||
            "Unassigned plan";
        const key = (sub.planCode && String(sub.planCode).trim()) || planLabel;
        if (!planDist[key]) {
            planDist[key] = {
                planCode: key,
                planName: planLabel,
                count: 0,
            };
        }

        if (
            sub.status === "active" ||
            sub.status === "trialing" ||
            sub.status === "past_due"
        ) {
            planDist[key].count += 1;
        }

        if (sub.status === "active" && sub.paymentStatus === "paid") {
            const amt = Number(sub.amountMinor || 0);
            if (sub.billingInterval === "yearly") {
                mrrMinor += Math.round(amt / 12);
            } else {
                mrrMinor += amt;
            }
            if (sub.currency) mrrCurrency = String(sub.currency).toUpperCase();
        }

        if (
            sub.paymentStatus === "unpaid" &&
            ["trialing", "active", "past_due"].includes(sub.status)
        ) {
            unpaidCount += 1;
        }

        if (["active", "trialing"].includes(sub.status)) {
            const ends = sub.trialEndsAt || sub.currentPeriodEnd;
            if (ends) {
                const end = new Date(ends);
                if (end >= now && end <= in7) {
                    expiringSoon.push({
                        subscriptionId: sub._id,
                        company: {
                            _id: company._id,
                            companyCode: company.companyCode,
                            legalName: company.legalName,
                            tradeName: company.tradeName,
                            status: company.status,
                            logoUrl: company.logoUrl,
                        },
                        planCode: sub.planCode,
                        planName: planLabel,
                        status: sub.status,
                        paymentStatus: sub.paymentStatus,
                        amountMinor: sub.amountMinor || 0,
                        currency: sub.currency || "USD",
                        expiresAt: ends,
                        billingInterval: sub.billingInterval,
                    });
                }
            }
        }
    }

    expiringSoon.sort((a, b) => {
        const da = new Date(a.expiresAt).getTime();
        const db = new Date(b.expiresAt).getTime();
        return da - db;
    });

    const subscribedCurrent = liveSubs.length;
    const planDistribution = Object.values(planDist)
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((p) => ({
            ...p,
            pct:
                subscribedCurrent > 0
                    ? Math.round((p.count / subscribedCurrent) * 1000) / 10
                    : 0,
        }));

    return {
        generatedAt: now.toISOString(),
        companies: {
            total: totalCompanies,
            active: activeCompanies,
            trial: trialCompanies,
            suspended: suspendedCompanies,
            cancelled: cancelledCompanies,
            closed: closedCompanies,
            blocked: blockedCompanies,
            expiredSubscriptions: expiredSubs,
            subscribedCurrent,
            newThisMonth,
            activePct:
                totalCompanies > 0
                    ? Math.round((activeCompanies / totalCompanies) * 1000) / 10
                    : 0,
        },
        billing: {
            mrrMinor,
            currency: String(mrrCurrency || "USD").toUpperCase(),
            unpaidSubscriptions: unpaidCount,
        },
        plans: {
            active: activePlans,
            total: totalPlans,
        },
        users: {
            activeCompanyUsers: companyUsers,
        },
        planDistribution,
        expiringSoon: expiringSoon.slice(0, 20),
    };
};

module.exports = {
    getPlatformDashboard,
};
