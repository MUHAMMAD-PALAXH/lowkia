const Company = require("../model/company");
const AdminUser = require("../model/adminUser");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");
const { DEFAULT_CURRENCY } = require("../config/finance");
const { isGlobalSuperAdmin } = require("../utils/roleAccess");
const { writeActivityLog } = require("./activityLogService");

/**
 * Ensure a default Company exists for current single-tenant → SaaS migration.
 */
const ensureDefaultCompany = async (actorId = null) => {
    let company = await Company.findOne({
        isDefault: true,
        isDeleted: { $ne: true },
    });

    if (company) return company;

    company = await Company.findOne({ isDeleted: { $ne: true } }).sort({
        createdAt: 1,
    });

    if (company) {
        if (!company.isDefault) {
            company.isDefault = true;
            company.updatedBy = actorId || company.updatedBy;
            await company.save();
        }
        return company;
    }

    const companyCode = await generateCode("company");
    company = await Company.create({
        companyCode,
        legalName: "Lowkia",
        tradeName: "Lowkia",
        defaultCurrency: DEFAULT_CURRENCY,
        countryCode: "US",
        timezone: "America/New_York",
        status: "Active",
        isDefault: true,
        createdBy: actorId || null,
    });

    return company;
};

/**
 * Attach companyId to AdminUser if missing (backfill).
 * Global Super Admin never gets a home company assigned.
 */
const ensureUserCompany = async (user) => {
    if (!user?._id) {
        throw new AppError("Authenticated user required.", 401);
    }

    if (isGlobalSuperAdmin(user.role)) {
        return null;
    }

    if (user.companyId) {
        return user.companyId;
    }

    const company = await ensureDefaultCompany(user._id);

    await AdminUser.updateOne(
        { _id: user._id, $or: [{ companyId: null }, { companyId: { $exists: false } }] },
        { $set: { companyId: company._id } }
    );

    user.companyId = company._id;
    return company._id;
};

/** ERP use — Active / Trial only. */
const getCompanyById = async (companyId) => {
    const company = await Company.findOne({
        _id: companyId,
        isDeleted: { $ne: true },
    });
    if (!company) {
        throw new AppError("Company not found.", 404);
    }
    const operable = ["Active", "Trial"].includes(company.status);
    if (!operable) {
        throw new AppError(`Company is ${company.status}.`, 403);
    }
    return company;
};

/** Platform console — any non-deleted status. */
const getCompanyRaw = async (companyId) => {
    const company = await Company.findOne({
        _id: companyId,
        isDeleted: { $ne: true },
    });
    if (!company) {
        throw new AppError("Company not found.", 404);
    }
    return company;
};

const assertDocumentCompany = (doc, companyId, label = "Record") => {
    if (!doc) {
        throw new AppError(`${label} not found.`, 404);
    }
    const docCompany = doc.companyId?.toString?.() || String(doc.companyId || "");
    const tenant = companyId?.toString?.() || String(companyId || "");
    if (!docCompany || !tenant || docCompany !== tenant) {
        throw new AppError(`${label} not found.`, 404);
    }
    return doc;
};

const listCompanies = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: { $ne: true } };
    if (query.status) filter.status = query.status;
    if (query.search) {
        const q = String(query.search).trim();
        filter.$or = [
            { legalName: { $regex: q, $options: "i" } },
            { tradeName: { $regex: q, $options: "i" } },
            { companyCode: { $regex: q, $options: "i" } },
        ];
    }

    const [items, total] = await Promise.all([
        Company.find(filter)
            .populate({
                path: "currentSubscriptionId",
                select:
                    "subscriptionNumber planCode planName status paymentStatus billingInterval amountMinor currency trialEndsAt currentPeriodEnd paidAt",
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Company.countDocuments(filter),
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1,
        },
    };
};

const createCompany = async (payload = {}, actorId = null) => {
    const legalName = String(payload.legalName || "").trim();
    if (!legalName) {
        throw new AppError("legalName is required.", 400);
    }

    const companyCode = await generateCode("company");
    const company = await Company.create({
        companyCode,
        legalName,
        tradeName: String(payload.tradeName || legalName).trim(),
        logoUrl: String(payload.logoUrl || "").trim(),
        defaultCurrency: String(
            payload.defaultCurrency || DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase(),
        countryCode: String(payload.countryCode || "US")
            .trim()
            .toUpperCase(),
        timezone: String(payload.timezone || "America/New_York").trim(),
        status: ["Trial", "Active", "Suspended", "Blocked", "Cancelled", "Closed"].includes(
            payload.status
        )
            ? payload.status
            : "Trial",
        settings: payload.settings && typeof payload.settings === "object"
            ? payload.settings
            : {},
        trialEndsAt: payload.trialEndsAt || null,
        isDefault: false,
        createdBy: actorId || null,
    });

    // Optional: auto-assign plan on create (default Starter Monthly trial)
    if (payload.planId || payload.autoAssignPlan !== false) {
        try {
            const {
                ensureDefaultPlans,
                listPlans,
                assignSubscription,
            } = require("./subscriptionService");
            await ensureDefaultPlans(actorId);
            let planId = payload.planId;
            if (!planId) {
                const plans = await listPlans({ activeOnly: true });
                const starter = plans.find((p) => p.planCode === "STARTER_MONTHLY");
                planId = starter?._id || plans[0]?._id;
            }
            if (planId) {
                await assignSubscription(company._id, planId, actorId, {
                    startTrial: true,
                });
            }
        } catch (err) {
            console.warn("[createCompany] auto plan assign skipped:", err.message);
        }
    }

    return Company.findById(company._id).populate({
        path: "currentSubscriptionId",
        select:
            "subscriptionNumber planCode planName status paymentStatus billingInterval amountMinor currency trialEndsAt currentPeriodEnd",
    });
};

const updateCompany = async (companyId, payload = {}, actorId = null) => {
    const company = await getCompanyRaw(companyId);

    const fields = [
        "legalName",
        "tradeName",
        "logoUrl",
        "defaultCurrency",
        "countryCode",
        "timezone",
        "status",
        "settings",
        "trialEndsAt",
    ];

    for (const key of fields) {
        if (payload[key] === undefined) continue;
        if (key === "status") {
            if (
                ![
                    "Trial",
                    "Active",
                    "Suspended",
                    "Blocked",
                    "Cancelled",
                    "Closed",
                ].includes(payload.status)
            ) {
                throw new AppError("Invalid company status.", 400);
            }
            company.status = payload.status;
            continue;
        }
        if (key === "settings") {
            company.settings =
                payload.settings && typeof payload.settings === "object"
                    ? payload.settings
                    : company.settings;
            continue;
        }
        if (key === "legalName") {
            const name = String(payload.legalName || "").trim();
            if (!name) throw new AppError("legalName cannot be empty.", 400);
            company.legalName = name;
            continue;
        }
        if (typeof payload[key] === "string") {
            company[key] = payload[key].trim();
        } else {
            company[key] = payload[key];
        }
    }

    company.updatedBy = actorId || company.updatedBy;
    await company.save();
    return company;
};

/**
 * Issue JWT with activeCompanyId for Global SA Enter Company.
 * Global SA may enter even expired/suspended companies for support (audited).
 */
const enterCompany = async (
    user,
    companyId,
    { ipAddress = "", reason = "" } = {}
) => {
    if (!isGlobalSuperAdmin(user.role)) {
        throw new AppError("Only Global Super Admin can enter a company.", 403);
    }

    const company = await getCompanyRaw(companyId);

    const token = user.generateToken({ activeCompanyId: company._id });

    await writeActivityLog({
        user,
        companyId: company._id,
        activityType: "Login",
        module: "Platform",
        subModule: "EnterCompany",
        description: `Global Super Admin entered company ${company.companyCode} (${company.legalName})${reason ? ` — ${reason}` : ""}`,
        shortDescription: `Enter company ${company.companyCode}`,
        referenceType: "Company",
        referenceId: company._id,
        newData: {
            activeCompanyId: String(company._id),
            companyStatus: company.status,
            reason: reason || "",
        },
        ipAddress,
        securityLevel: "High",
    });

    return {
        token,
        company,
        destination: "company_erp",
        activeCompanyId: company._id,
        bypassNote:
            ["Active", "Trial"].includes(company.status)
                ? null
                : `Company is ${company.status} — Global Admin support access`,
    };
};

/**
 * Clear Enter Company scope — back to Global Console.
 */
const exitCompany = async (user, previousCompanyId = null, { ipAddress = "" } = {}) => {
    if (!isGlobalSuperAdmin(user.role)) {
        throw new AppError("Only Global Super Admin can exit a company.", 403);
    }

    const token = user.generateToken(); // no activeCompanyId

    await writeActivityLog({
        user,
        companyId: previousCompanyId || null,
        activityType: "Logout",
        module: "Platform",
        subModule: "ExitCompany",
        description: "Global Super Admin exited company context",
        shortDescription: "Exit company",
        referenceType: "Company",
        referenceId: previousCompanyId || null,
        oldData: previousCompanyId
            ? { activeCompanyId: String(previousCompanyId) }
            : null,
        ipAddress,
        securityLevel: "High",
    });

    return {
        token,
        company: null,
        destination: "global_console",
        activeCompanyId: null,
    };
};

/**
 * Administrative company lifecycle (suspend / reactivate / block / cancel).
 */
const setCompanyLifecycle = async (
    companyId,
    nextStatus,
    actor,
    { reason = "" } = {}
) => {
    const allowed = ["Active", "Suspended", "Blocked", "Cancelled", "Trial"];
    if (!allowed.includes(nextStatus)) {
        throw new AppError("Invalid lifecycle status.", 400);
    }
    const company = await getCompanyRaw(companyId);
    const prev = company.status;
    company.status = nextStatus;
    company.statusReason = String(reason || "").trim();
    company.updatedBy = actor?._id || company.updatedBy;
    await company.save();

    await writeActivityLog({
        user: actor,
        companyId: company._id,
        activityType: "Update",
        module: "Platform",
        subModule: "CompanyLifecycle",
        description: `Company ${company.companyCode} status ${prev} → ${nextStatus}${reason ? `: ${reason}` : ""}`,
        shortDescription: `${company.companyCode} → ${nextStatus}`,
        referenceType: "Company",
        referenceId: company._id,
        oldData: { status: prev },
        newData: { status: nextStatus, reason },
        securityLevel: "High",
    });

    return company;
};

module.exports = {
    ensureDefaultCompany,
    ensureUserCompany,
    getCompanyById,
    getCompanyRaw,
    assertDocumentCompany,
    listCompanies,
    createCompany,
    updateCompany,
    enterCompany,
    exitCompany,
    setCompanyLifecycle,
};
