const asyncHandler = require("express-async-handler");
const { isCompanyOwner } = require("../utils/roleAccess");
const { error } = require("../utils/apiResponse");

// =======================================================
// Permission Middleware
// Auth/role system will be completed in authentication phase
// =======================================================

const permit = (...roles) => {
    return asyncHandler(async (req, res, next) => {
        if (!req.user) {
            return error(res, "Authentication required.", 401);
        }

        // Company owner (or legacy admin) can do everything in company ERP
        if (isCompanyOwner(req.user.role) || req.user.role === "Owner") {
            return next();
        }

        if (roles.length && !roles.includes(req.user.role)) {
            return error(res, "Permission denied.", 403);
        }

        next();
    });
};

module.exports = {
    permit
};
