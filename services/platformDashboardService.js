const Company = require("../model/company");
const CompanySubscription = require("../model/companySubscription");
const AdminUser = require("../model/adminUser");
const { ROLES } = require("../constants/roles");

const NOT_DELETED = { isDeleted: { $ne: true } };

const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
};

/**
 * Load only each company's *current* subscription (not historical rows).
 */
const loadCurrentSubscriptions = async () => {
    const companies = await Company.find({
        ...NOT_DELETED,
        currentSubscriptionId: { $ne: null },
    })
        .select("_id companyCode legalName tradeName status logoUrl currentSubscriptionId")
        .lean();

    if (!companies.length) return { companies: [], subscriptions: [] };

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
 * Real SaaS metrics from Company + current CompanySubscription only.
 * Never fabricates revenue — only sums paid subscription amounts.
 */
const getPlatformDashboard = async () => {
    const now = new Date();
    const in7 = daysFromNow(7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
        totalCompanies,
        byStatus,
        newThisMonth,
        current,
        paidThisMonth,
        paidPrevMonth,
        companyUsers,
    ] = await Promise.all([
        Company.countDocuments(NOT_DELETED),
        Company.aggregate([
            { $match: NOT_DELETED },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Company.countDocuments({
            ...NOT_DELETED,
            createdAt: { $gte: monthStart },
        }),
        loadCurrentSubscriptions(),
        // Collected this month = payments marked paid this month (all rows OK)
        CompanySubscription.aggregate([
            {
                $match: {
                    ...NOT_DELETED,
                    paymentStatus: "paid",
                    paidAt: { $gte: monthStart },
                },
            },
            {
                $group: {
                    _id: null,
                    totalMinor: { $sum: "$amountMinor" },
                    count: { $sum: 1 },
                },
            },
        ]),
        CompanySubscription.aggregate([
            {
                $match: {
                    ...NOT_DELETED,
                    paymentStatus: "paid",
                    paidAt: { $gte: prevMonthStart, $lt: monthStart },
                },
            },
            {
                $group: {
                    _id: null,
                    totalMinor: { $sum: "$amountMinor" },
                    count: { $sum: 1 },
                },
            },
        ]),
        AdminUser.countDocuments({
            isDeleted: { $ne: true },
            role: { $ne: ROLES.GLOBAL_SUPER_ADMIN },
            companyId: { $ne: null },
            status: "Active",
        }),
    ]);

    const statusMap = Object.fromEntries(
        byStatus.map((r) => [r._id || "Unknown", r.count])
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
    const planDist = {};
    let unpaidCount = 0;
    const expiringSoon = [];

    for (const { company, sub } of currentSubs) {
        const key = sub.planCode || sub.planName || "Unknown";
        if (!planDist[key]) {
            planDist[key] = {
                planCode: key,
                planName: sub.planName || key,
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
                        planName: sub.planName,
                        status: sub.status,
                        paymentStatus: sub.paymentStatus,
                        amountMinor: sub.amountMinor,
                        currency: sub.currency,
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

    const collectedThisMonth = paidThisMonth[0]?.totalMinor || 0;
    const collectedPrevMonth = paidPrevMonth[0]?.totalMinor || 0;
    let mrrChangePct = null;
    if (collectedPrevMonth > 0) {
        mrrChangePct =
            ((collectedThisMonth - collectedPrevMonth) / collectedPrevMonth) *
            100;
    }

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
            currency: "USD",
            collectedThisMonthMinor: collectedThisMonth,
            collectedPrevMonthMinor: collectedPrevMonth,
            collectedChangePct:
                mrrChangePct === null
                    ? null
                    : Math.round(mrrChangePct * 10) / 10,
            unpaidSubscriptions: unpaidCount,
            paidThisMonthCount: paidThisMonth[0]?.count || 0,
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
