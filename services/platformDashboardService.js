const Company = require("../model/company");
const CompanySubscription = require("../model/companySubscription");
const AdminUser = require("../model/adminUser");
const SubscriptionPlan = require("../model/subscriptionPlan");
const SubscriptionInvoice = require("../model/subscriptionInvoice");
const SubscriptionPayment = require("../model/subscriptionPayment");
const ActivityLog = require("../model/activityLog");
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
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

const startOfDay = (ref = new Date()) =>
    new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

const startOfWeek = (ref = new Date()) => {
    const d = startOfDay(ref);
    const day = d.getDay(); // 0 Sun
    const diff = day === 0 ? 6 : day - 1; // Monday start
    d.setDate(d.getDate() - diff);
    return d;
};

const startOfYear = (ref = new Date()) =>
    new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);

const bytesFromGb = (gb) => Math.max(0, Number(gb) || 0) * 1024 * 1024 * 1024;

const formatPeriod = (rows) => {
    const byCurrency = (rows || [])
        .map((r) => ({
            currency: String(r._id || "USD").toUpperCase(),
            totalMinor: Number(r.totalMinor || 0),
            count: Number(r.count || 0),
        }))
        .sort((a, b) => b.totalMinor - a.totalMinor);
    const primary = byCurrency[0] || {
        currency: "USD",
        totalMinor: 0,
        count: 0,
    };
    return {
        currency: primary.currency,
        totalMinor: primary.totalMinor,
        count: primary.count,
        byCurrency,
    };
};

const sumPaidInvoices = async (from = null) => {
    const match = {
        status: "paid",
        ...NOT_DELETED,
    };
    if (from) {
        match.paidAt = { $gte: from };
    } else {
        match.paidAt = { $ne: null };
    }
    return SubscriptionInvoice.aggregate([
        { $match: match },
        {
            $group: {
                _id: "$currency",
                totalMinor: { $sum: "$amountMinor" },
                count: { $sum: 1 },
            },
        },
    ]);
};

const getIncomeAnalytics = async (now = new Date()) => {
    const [daily, weekly, monthly, yearly, lifetime] = await Promise.all([
        sumPaidInvoices(startOfDay(now)),
        sumPaidInvoices(startOfWeek(now)),
        sumPaidInvoices(monthWindow(now).start),
        sumPaidInvoices(startOfYear(now)),
        sumPaidInvoices(null),
    ]);
    return {
        daily: formatPeriod(daily),
        weekly: formatPeriod(weekly),
        monthly: formatPeriod(monthly),
        yearly: formatPeriod(yearly),
        lifetime: formatPeriod(lifetime),
    };
};

const getMongoStorage = async () => {
    const limitBytes =
        Number(process.env.MONGODB_STORAGE_LIMIT_BYTES) ||
        bytesFromGb(process.env.MONGODB_STORAGE_LIMIT_GB || 0.512);

    try {
        if (!mongoose.connection?.db) {
            throw new Error("MongoDB connection not ready");
        }
        const stats = await mongoose.connection.db.stats();
        const usedBytes =
            Number(stats.dataSize || 0) + Number(stats.indexSize || 0);
        const remainingBytes = Math.max(0, limitBytes - usedBytes);
        const usedPct =
            limitBytes > 0
                ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10)
                : 0;
        const remainingPct = Math.max(
            0,
            Math.round((100 - usedPct) * 10) / 10
        );
        return {
            provider: "mongodb",
            source: "db.stats",
            limitBytes,
            usedBytes,
            remainingBytes,
            usedPct,
            remainingPct,
            dataSizeBytes: Number(stats.dataSize || 0),
            indexSizeBytes: Number(stats.indexSize || 0),
            collections: Number(stats.collections || 0),
            available: true,
            note:
                process.env.MONGODB_STORAGE_LIMIT_GB ||
                process.env.MONGODB_STORAGE_LIMIT_BYTES
                    ? "Compared to MONGODB_STORAGE_LIMIT_* from env"
                    : "Default limit 0.512 GB (Atlas M0). Set MONGODB_STORAGE_LIMIT_GB to match your cluster.",
        };
    } catch (err) {
        return {
            provider: "mongodb",
            available: false,
            limitBytes,
            usedBytes: 0,
            remainingBytes: limitBytes,
            usedPct: 0,
            remainingPct: 100,
            error: err.message || "Failed to read MongoDB stats",
        };
    }
};

const getCloudinaryStorage = async () => {
    try {
        if (
            !process.env.CLOUDINARY_CLOUD_NAME ||
            !process.env.CLOUDINARY_API_KEY ||
            !process.env.CLOUDINARY_API_SECRET
        ) {
            throw new Error("Cloudinary credentials missing");
        }
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        const usage = await cloudinary.api.usage();
        const storage = usage?.storage || {};
        const usedBytes = Number(storage.usage || 0);
        const limitBytes = Number(storage.limit || 0);
        const remainingBytes =
            limitBytes > 0 ? Math.max(0, limitBytes - usedBytes) : 0;
        const usedPct =
            limitBytes > 0
                ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10)
                : 0;
        const remainingPct =
            limitBytes > 0
                ? Math.max(0, Math.round((100 - usedPct) * 10) / 10)
                : 100;
        return {
            provider: "cloudinary",
            available: true,
            limitBytes,
            usedBytes,
            remainingBytes,
            usedPct,
            remainingPct,
            plan: usage?.plan || null,
            creditsUsed: usage?.credits?.usage ?? null,
            creditsLimit: usage?.credits?.limit ?? null,
            bandwidthUsed: usage?.bandwidth?.usage ?? null,
            bandwidthLimit: usage?.bandwidth?.limit ?? null,
        };
    } catch (err) {
        return {
            provider: "cloudinary",
            available: false,
            limitBytes: 0,
            usedBytes: 0,
            remainingBytes: 0,
            usedPct: 0,
            remainingPct: 100,
            error: err.message || "Failed to read Cloudinary usage",
        };
    }
};

const computeSystemStatus = ({
    mongo,
    cloudinaryStorage,
    pendingPayments,
    overdueInvoices,
    unpaidSubscriptions,
    blockedCompanies,
    criticalFailedLogs24h,
    highFailedLogs24h,
}) => {
    const suggestions = [];
    const reasons = [];

    const mongoUsed = Number(mongo?.usedPct || 0);
    const mongoRemaining = Number(mongo?.remainingPct ?? 100);
    const cldUsed = Number(cloudinaryStorage?.usedPct || 0);
    const cldRemaining = Number(cloudinaryStorage?.remainingPct ?? 100);

    if (!mongo?.available) {
        suggestions.push(
            "MongoDB storage stats unavailable — check database connection."
        );
    }
    if (!cloudinaryStorage?.available) {
        suggestions.push(
            "Cloudinary usage unavailable — verify CLOUDINARY_* credentials."
        );
    }

    if (mongoUsed >= 80) {
        reasons.push(`MongoDB ${mongoUsed}% used (${mongoRemaining}% left)`);
        suggestions.push(
            "MongoDB space is low — archive old data, drop unused indexes, or upgrade Atlas storage."
        );
    }
    if (cldUsed >= 80) {
        reasons.push(`Cloudinary ${cldUsed}% used (${cldRemaining}% left)`);
        suggestions.push(
            "Cloudinary media storage is low — delete unused assets or upgrade the Cloudinary plan."
        );
    }
    if (pendingPayments >= 15) {
        reasons.push(`${pendingPayments} payments awaiting verification`);
        suggestions.push(
            "Clear the Incoming Payments queue so company subscriptions stay accurate."
        );
    } else if (pendingPayments >= 5) {
        suggestions.push(
            "Review pending payment proofs in Billing → Incoming."
        );
    }
    if (overdueInvoices >= 5) {
        reasons.push(`${overdueInvoices} overdue invoices`);
        suggestions.push(
            "Follow up on overdue subscription invoices to reduce churn risk."
        );
    }
    if (unpaidSubscriptions >= 10) {
        reasons.push(`${unpaidSubscriptions} unpaid subscriptions`);
        suggestions.push(
            "Many tenants are unpaid — review billing and payment accounts."
        );
    }
    if (blockedCompanies >= 3) {
        reasons.push(`${blockedCompanies} blocked companies`);
        suggestions.push(
            "Investigate blocked tenants for abuse or unpaid risk."
        );
    }
    if (highFailedLogs24h >= 20) {
        reasons.push(`${highFailedLogs24h} high-severity failed audits (24h)`);
        suggestions.push(
            "Spike in failed/high-security activity — review Activity Logs and access controls."
        );
    }
    if (criticalFailedLogs24h >= 1) {
        reasons.push(
            `${criticalFailedLogs24h} critical failed security events (24h)`
        );
        suggestions.push(
            "Critical failed audit events detected — rotate secrets, review admin access, and check for unauthorized activity."
        );
    }

    let level = "good";
    let label = "Good";
    let summary = "Platform health looks normal.";

    if (criticalFailedLogs24h >= 3 || highFailedLogs24h >= 50) {
        level = "hacked";
        label = "Hacked";
        summary =
            "Possible compromise signals — investigate critical failed security events immediately.";
    } else if (
        mongoUsed >= 95 ||
        cldUsed >= 95 ||
        (overdueInvoices >= 20 && pendingPayments >= 20)
    ) {
        level = "bad";
        label = "Bad";
        summary =
            "Critical capacity or billing backlog — action needed to keep the platform healthy.";
    } else if (
        mongoUsed >= 80 ||
        cldUsed >= 80 ||
        pendingPayments >= 10 ||
        overdueInvoices >= 5 ||
        unpaidSubscriptions >= 10 ||
        highFailedLogs24h >= 20 ||
        criticalFailedLogs24h >= 1
    ) {
        level = "risky";
        label = "Risky";
        summary =
            "Elevated risk from storage, billing backlog, or security signals.";
    } else {
        suggestions.unshift(
            "Keep verifying incoming payments daily and monitor Atlas/Cloudinary usage weekly."
        );
    }

    if (!suggestions.length) {
        suggestions.push("No urgent actions — continue routine monitoring.");
    }

    return {
        level,
        label,
        summary,
        reasons,
        suggestions: suggestions.slice(0, 6),
        checkedAt: new Date().toISOString(),
    };
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
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
        totalCompanies,
        byStatus,
        newThisMonth,
        current,
        companyUsers,
        activePlans,
        totalPlans,
        income,
        mongo,
        cloudinaryStorage,
        pendingPayments,
        overdueInvoices,
        criticalFailedLogs24h,
        highFailedLogs24h,
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
        getIncomeAnalytics(now),
        getMongoStorage(),
        getCloudinaryStorage(),
        SubscriptionPayment.countDocuments({
            status: "pending_verification",
            ...NOT_DELETED,
        }),
        SubscriptionInvoice.countDocuments({
            status: "overdue",
            ...NOT_DELETED,
        }),
        ActivityLog.countDocuments({
            createdAt: { $gte: since24h },
            securityLevel: "Critical",
            status: "Failed",
        }).catch(() => 0),
        ActivityLog.countDocuments({
            createdAt: { $gte: since24h },
            securityLevel: { $in: ["High", "Critical"] },
            status: "Failed",
        }).catch(() => 0),
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

    const systemStatus = computeSystemStatus({
        mongo,
        cloudinaryStorage,
        pendingPayments,
        overdueInvoices,
        unpaidSubscriptions: unpaidCount,
        blockedCompanies,
        criticalFailedLogs24h,
        highFailedLogs24h,
    });

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
            pendingPayments,
            overdueInvoices,
        },
        income,
        storage: {
            mongodb: mongo,
            cloudinary: cloudinaryStorage,
        },
        systemStatus,
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
