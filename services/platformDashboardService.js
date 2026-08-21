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
 * Real SaaS metrics from Company + CompanySubscription.
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
        subs,
        paidThisMonth,
        paidPrevMonth,
        expiringSoon,
        unpaidCount,
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
        CompanySubscription.find({
            ...NOT_DELETED,
            status: { $in: ["trialing", "active", "past_due", "cancelled", "expired"] },
        })
            .select(
                "companyId planCode planName status paymentStatus billingInterval amountMinor currency currentPeriodEnd trialEndsAt"
            )
            .lean(),
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
        CompanySubscription.find({
            ...NOT_DELETED,
            status: { $in: ["active", "trialing"] },
            $or: [
                {
                    currentPeriodEnd: { $gte: now, $lte: in7 },
                },
                {
                    trialEndsAt: { $gte: now, $lte: in7 },
                },
            ],
        })
            .populate("companyId", "companyCode legalName tradeName status logoUrl")
            .sort({ currentPeriodEnd: 1, trialEndsAt: 1 })
            .limit(20)
            .lean(),
        CompanySubscription.countDocuments({
            ...NOT_DELETED,
            paymentStatus: { $in: ["unpaid"] },
            status: { $in: ["trialing", "active", "past_due"] },
        }),
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

    // Derived expired: company Active/Trial but sub expired, OR company Closed after expiry
    const expiredSubs = subs.filter((s) => s.status === "expired").length;

    // MRR from active paid monthly + yearly/12
    let mrrMinor = 0;
    const planDist = {};
    for (const s of subs) {
        const key = s.planCode || s.planName || "Unknown";
        if (!planDist[key]) {
            planDist[key] = { planCode: key, planName: s.planName || key, count: 0 };
        }
        if (s.status === "active" || s.status === "trialing") {
            planDist[key].count += 1;
        }
        if (s.status === "active" && s.paymentStatus === "paid") {
            const amt = Number(s.amountMinor || 0);
            if (s.billingInterval === "yearly") mrrMinor += Math.round(amt / 12);
            else mrrMinor += amt;
        }
    }

    const collectedThisMonth =
        paidThisMonth[0]?.totalMinor || 0;
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
        planDistribution: Object.values(planDist).sort(
            (a, b) => b.count - a.count
        ),
        expiringSoon: expiringSoon.map((s) => ({
            subscriptionId: s._id,
            company: s.companyId,
            planCode: s.planCode,
            planName: s.planName,
            status: s.status,
            paymentStatus: s.paymentStatus,
            amountMinor: s.amountMinor,
            currency: s.currency,
            expiresAt: s.trialEndsAt || s.currentPeriodEnd,
            billingInterval: s.billingInterval,
        })),
    };
};

module.exports = {
    getPlatformDashboard,
};
