const asyncHandler = require("express-async-handler");

// =======================================================
// Permission Middleware
// =======================================================

const permit = (...roles) => {

    return asyncHandler(async (req, res, next) => {

        // System Admin can do everything
        if (req.user.role === "admin") {
            return next();
        }

        // Company Owner can do everything
        if (req.companyRole === "Owner") {
            return next();
        }

        if (!roles.includes(req.companyRole)) {
            return res.status(403).json({
                success: false,
                message: "Permission denied."
            });
        }

        next();

    });

};

module.exports = {
    permit
};