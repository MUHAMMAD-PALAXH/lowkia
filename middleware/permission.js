const asyncHandler = require("express-async-handler");

// =======================================================
// Permission Middleware
// Auth/role system will be completed in authentication phase
// =======================================================

const permit = (...roles) => {
    return asyncHandler(async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required.",
                data: null,
                errors: null
            });
        }

        // System admin can do everything
        if (req.user.role === "admin" || req.user.role === "Owner") {
            return next();
        }

        if (roles.length && !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Permission denied.",
                data: null,
                errors: null
            });
        }

        next();
    });
};

module.exports = {
    permit
};
