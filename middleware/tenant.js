const asyncHandler = require("express-async-handler");
const {
    ensureUserCompany,
    getCompanyById,
    assertDocumentCompany,
} = require("../services/companyService");

/**
 * After `protect`: resolve tenant from authenticated user.
 * Sets req.companyId. Never trusts body/query companyId.
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

    const companyId = await ensureUserCompany(req.user);
    req.companyId = companyId;

    // Soft-load company for currency/timezone when needed
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

module.exports = {
    resolveTenant,
    requireCompany,
    assertDocumentCompany,
};
