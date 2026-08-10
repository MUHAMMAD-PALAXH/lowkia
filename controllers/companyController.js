const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const {
    ensureDefaultCompany,
    ensureUserCompany,
    getCompanyById,
} = require("../services/companyService");

/**
 * GET /api/company/me
 * Returns the authenticated user's company (auto-backfills default tenant).
 */
exports.getMyCompany = asyncHandler(async (req, res) => {
    const companyId = await ensureUserCompany(req.user);
    const company = await getCompanyById(companyId);
    return success(res, "Company retrieved", company);
});

/**
 * POST /api/company/bootstrap
 * Owner-only: ensure default company exists and current user is linked.
 */
exports.bootstrapCompany = asyncHandler(async (req, res) => {
    const company = await ensureDefaultCompany(req.user._id);
    await ensureUserCompany(req.user);
    return success(res, "Company ready", company);
});
