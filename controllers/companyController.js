const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const {
    listCompanies,
    createCompany,
    updateCompany,
    getCompanyRaw,
    enterCompany,
    exitCompany,
    ensureDefaultCompany,
    ensureUserCompany,
    getCompanyById,
} = require("../services/companyService");
const { isGlobalSuperAdmin } = require("../utils/roleAccess");

const clientIp = (req) =>
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    "";

/**
 * GET /api/company/me
 */
exports.getMyCompany = asyncHandler(async (req, res) => {
    if (isGlobalSuperAdmin(req.user.role)) {
        if (!req.companyId) {
            return success(res, "Platform mode — no home company", null);
        }
        const company = await getCompanyById(req.companyId);
        return success(res, "Active company context", company);
    }

    const companyId = await ensureUserCompany(req.user);
    const company = await getCompanyById(companyId);
    return success(res, "Company retrieved", company);
});

/**
 * POST /api/company/bootstrap
 */
exports.bootstrapCompany = asyncHandler(async (req, res) => {
    const company = await ensureDefaultCompany(req.user._id);
    await ensureUserCompany(req.user);
    return success(res, "Company ready", company);
});

// ---------- Platform (Global Super Admin) ----------

exports.listPlatformCompanies = asyncHandler(async (req, res) => {
    const result = await listCompanies(req.query);
    return success(res, "Companies retrieved", result);
});

exports.getPlatformCompany = asyncHandler(async (req, res) => {
    const company = await getCompanyRaw(req.params.id);
    return success(res, "Company retrieved", company);
});

exports.createPlatformCompany = asyncHandler(async (req, res) => {
    const company = await createCompany(req.body || {}, req.user._id);
    return success(res, "Company created", company, 201);
});

exports.updatePlatformCompany = asyncHandler(async (req, res) => {
    const company = await updateCompany(
        req.params.id,
        req.body || {},
        req.user._id
    );
    return success(res, "Company updated", company);
});

exports.enterCompany = asyncHandler(async (req, res) => {
    const companyId = req.body?.companyId || req.params.id;
    const result = await enterCompany(req.user, companyId, {
        ipAddress: clientIp(req),
    });
    return success(res, "Entered company", result);
});

exports.exitCompany = asyncHandler(async (req, res) => {
    const result = await exitCompany(req.user, req.activeCompanyId, {
        ipAddress: clientIp(req),
    });
    return success(res, "Exited company", result);
});

exports.getPlatformSession = asyncHandler(async (req, res) => {
    let company = null;
    if (req.activeCompanyId) {
        try {
            company = await getCompanyRaw(req.activeCompanyId);
        } catch (_) {
            company = null;
        }
    }
    return success(res, "Platform session", {
        role: req.user.role,
        destination: req.activeCompanyId ? "company_erp" : "global_console",
        activeCompanyId: req.activeCompanyId || null,
        company,
    });
});
