const asyncHandler = require("express-async-handler");
const {
    ensureUserCompany,
    getCompanyById,
    assertDocumentCompany,
} = require("../services/companyService");
const { isGlobalSuperAdmin } = require("../utils/roleAccess");

/**
 * After `protect`: resolve tenant from authenticated user.
 * Sets req.companyId. Never trusts body/query companyId.
 *
 * Global Super Admin:
 * - No activeCompanyId → platform mode (req.companyId = null)
 * - With JWT activeCompanyId → Enter Company session for that tenant
 */
const resolveTenant = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required.",
            data: null,
            errors: null,
        });
    }

    // Strip spoofed tenant from client payloads
    if (req.body && typeof req.body === "object") {
        delete req.body.companyId;
    }
    if (req.query && typeof req.query === "object" && req.query.companyId) {
        delete req.query.companyId;
    }

    if (isGlobalSuperAdmin(req.user.role)) {
        const activeId = req.activeCompanyId || null;
        if (!activeId) {
            req.companyId = null;
            req.company = null;
            req.isPlatformMode = true;
            return next();
        }

        try {
            req.company = await getCompanyById(activeId);
            req.companyId = req.company._id;
            req.isPlatformMode = false;
        } catch (err) {
            return res.status(err.statusCode || 403).json({
                success: false,
                message: err.message || "Invalid company context.",
                data: null,
                errors: null,
            });
        }
        return next();
    }

    const companyId = await ensureUserCompany(req.user);
    req.companyId = companyId;
    req.isPlatformMode = false;

    try {
        req.company = await getCompanyById(companyId);
    } catch (_) {
        req.company = null;
    }

    next();
});

/**
 * Require an active company on the request (after resolveTenant).
 */
const requireCompany = (req, res, next) => {
    if (!req.companyId) {
        return res.status(403).json({
            success: false,
            message: "Company context is required.",
            data: null,
            errors: null,
        });
    }
    next();
};

/**
 * Require platform mode (Global SA without Enter Company).
 */
const requirePlatformMode = (req, res, next) => {
    if (!isGlobalSuperAdmin(req.user?.role) || req.companyId) {
        return res.status(403).json({
            success: false,
            message: "Platform console access required.",
            data: null,
            errors: null,
        });
    }
    next();
};

module.exports = {
    resolveTenant,
    requireCompany,
    requirePlatformMode,
    assertDocumentCompany,
};
