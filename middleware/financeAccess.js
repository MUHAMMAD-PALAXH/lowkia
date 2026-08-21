const asyncHandler = require("express-async-handler");
const {
    isCompanyOwner,
    hasManagerPower,
    isVendor,
    isSupplierLogin,
} = require("../utils/roleAccess");

/**
 * Finance access gates (Owner / Employee / Vendor blocked).
 * Complements hrAccess; used by payment/payroll routes.
 */

const blockVendorFromFinance = (req, res, next) => {
    if (isVendor(req.user?.role) || isSupplierLogin(req.user?.role)) {
        return res.status(403).json({
            success: false,
            message: "Vendors and suppliers cannot access finance or payroll.",
            data: null,
            errors: null,
        });
    }
    next();
};

/** Owner/admin only — approve, complete, reverse, payroll lock. */
const financeOwnerOnly = (req, res, next) => {
    if (!isCompanyOwner(req.user?.role)) {
        return res.status(403).json({
            success: false,
            message: "Only the owner can perform this financial action.",
            data: null,
            errors: null,
        });
    }
    next();
};

/** Owner or employee may initiate requests / view scoped data. */
const financeStaffOnly = (req, res, next) => {
    if (!hasManagerPower(req.user?.role)) {
        return res.status(403).json({
            success: false,
            message: "Access denied.",
            data: null,
            errors: null,
        });
    }
    next();
};

/**
 * Separation of duties: requester cannot approve their own payment request.
 */
const rejectSelfApproval = (getCreatedBy) =>
    asyncHandler(async (req, res, next) => {
        const createdBy =
            typeof getCreatedBy === "function"
                ? await getCreatedBy(req)
                : req.payment?.createdBy || req.resource?.createdBy;

        if (
            createdBy &&
            req.user?._id &&
            String(createdBy) === String(req.user._id)
        ) {
            return res.status(403).json({
                success: false,
                message: "You cannot approve your own payment request.",
                data: null,
                errors: null,
            });
        }
        next();
    });

module.exports = {
    blockVendorFromFinance,
    financeOwnerOnly,
    financeStaffOnly,
    rejectSelfApproval,
};
