const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");

const AdminUser = require("../model/adminUser");
const {
    hasAdminPower,
    hasManagerPower,
    isVendor,
    isGlobalSuperAdmin,
} = require("../utils/roleAccess");



// ==========================================
// Protect Middleware
// ==========================================

const protect = asyncHandler(async (req, res, next) => {

    let token = null;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token is missing.",
        });
    }

    try {

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user = await AdminUser.findById(decoded.id)
            .select("-password");

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found.",
            });
        }

        // Soft Deleted User

        if (user.isDeleted) {
            return res.status(403).json({
                success: false,
                message: "Your account has been deleted.",
            });
        }

        // Suspended / Blocked

        if (
            user.status === "Suspended" ||
            user.status === "Blocked"
        ) {
            return res.status(403).json({
                success: false,
                message: `Your account is ${user.status}.`,
            });
        }

        req.user = user;
        req.authClaims = decoded;
        // Global SA Enter Company scope (JWT only; never from body)
        req.activeCompanyId = decoded.activeCompanyId || null;

        next();

    } catch (error) {

        if (error.name === "TokenExpiredError") {

            return res.status(401).json({
                success: false,
                message: "Token expired. Please login again.",
            });

        }

        if (error.name === "JsonWebTokenError") {

            return res.status(401).json({
                success: false,
                message: "Invalid token.",
            });

        }

        return res.status(500).json({
            success: false,
            message: error.message,
        });

    }

});



// ==========================================
// Admin Only (company owner + global SA)
// ==========================================

const adminOnly = (req, res, next) => {

    if (!hasAdminPower(req.user?.role)) {

        return res.status(403).json({

            success: false,

            message: "Only admin can access this resource."

        });

    }

    next();

};



// ==========================================
// Vendor or Admin
// ==========================================

const vendorOrAdmin = (req, res, next) => {

    const role = req.user?.role;

    if (!(hasAdminPower(role) || isVendor(role))) {

        return res.status(403).json({

            success: false,

            message: "Access denied."

        });

    }

    next();

};



// ==========================================
// Branch Manager / Employee / Admin
// ==========================================

const branchManagerOrAdmin = (req, res, next) => {

    if (!hasManagerPower(req.user?.role)) {

        return res.status(403).json({

            success: false,

            message: "Access denied."

        });

    }

    next();

};



// ==========================================
// Platform Global Super Admin only
// ==========================================

const globalSuperAdminOnly = (req, res, next) => {

    if (!isGlobalSuperAdmin(req.user?.role)) {

        return res.status(403).json({
            success: false,
            message: "Global Super Admin access required.",
        });

    }

    next();

};



// ==========================================
// Dynamic Role Middleware
// Example:
// authorize("admin")
// authorize("admin","vendor")
// ==========================================

const authorize = (...roles) => {

    return (req, res, next) => {

        if (!roles.includes(req.user.role)) {

            return res.status(403).json({

                success: false,

                message: "Permission denied."

            });

        }

        next();

    };

};



// ==========================================
// Future Permission Middleware
// RBAC Ready
// ==========================================

const can = (permissionName) => {

    return async (req, res, next) => {

        /*
            Future

            Load Permission

            Compare Role Permission

            Allow / Deny

        */

        next();

    };

};



module.exports = {

    protect,

    adminOnly,

    vendorOrAdmin,

    branchManagerOrAdmin,

    globalSuperAdminOnly,

    authorize,

    can

};
