const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");

const AdminUser = require("../model/adminUser");
const {
    hasAdminPower,
    hasManagerPower,
    isVendor,
    isGlobalSuperAdmin,
} = require("../utils/roleAccess");
const { error } = require("../utils/apiResponse");
const { t } = require("../utils/i18n");



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
        return error(res, "Authentication token is missing.", 401);
    }

    try {

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user = await AdminUser.findById(decoded.id)
            .select("-password");

        if (!user) {
            return error(res, "User not found.", 401);
        }

        // Soft Deleted User

        if (user.isDeleted) {
            return error(res, "Your account has been deleted.", 403);
        }

        // Suspended / Blocked

        if (
            user.status === "Suspended" ||
            user.status === "Blocked"
        ) {
            return error(
                res,
                t(req, "Your account is {status}.", { status: user.status }),
                403
            );
        }

        req.user = user;
        req.authClaims = decoded;
        // Global SA Enter Company scope (JWT only; never from body)
        req.activeCompanyId = decoded.activeCompanyId || null;

        next();

    } catch (err) {

        if (err.name === "TokenExpiredError") {
            return error(res, "Token expired. Please login again.", 401);
        }

        if (err.name === "JsonWebTokenError") {
            return error(res, "Invalid token.", 401);
        }

        return error(res, err.message || "Internal server error", 500);
    }

});



// ==========================================
// Admin Only (company owner + global SA)
// ==========================================

const adminOnly = (req, res, next) => {

    if (!hasAdminPower(req.user?.role)) {
        return error(res, "Only admin can access this resource.", 403);
    }

    next();

};



// ==========================================
// Vendor or Admin
// ==========================================

const vendorOrAdmin = (req, res, next) => {

    const role = req.user?.role;

    if (!(hasAdminPower(role) || isVendor(role))) {
        return error(res, "Access denied.", 403);
    }

    next();

};



// ==========================================
// Branch Manager / Employee / Admin
// ==========================================

const branchManagerOrAdmin = (req, res, next) => {

    if (!hasManagerPower(req.user?.role)) {
        return error(res, "Access denied.", 403);
    }

    next();

};



// ==========================================
// Platform Global Super Admin only
// ==========================================

const globalSuperAdminOnly = (req, res, next) => {

    if (!isGlobalSuperAdmin(req.user?.role)) {
        return error(res, "Global Super Admin access required.", 403);
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
            return error(res, "Permission denied.", 403);
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
