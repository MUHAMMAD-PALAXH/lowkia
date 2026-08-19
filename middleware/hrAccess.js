const Branch = require("../model/branch");
const Employee = require("../model/employee");
const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };

/**
 * Owner / HR admin for attendance configuration.
 * Maps product "Owner" → AdminUser.role === "admin".
 */
const attendanceAdminOnly = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required.",
            data: null,
            errors: null
        });
    }
    if (req.user.role === "vendor" || req.user.role === "supplier") {
        return res.status(403).json({
            success: false,
            message: "Vendors and suppliers cannot access employee attendance.",
            data: null,
            errors: null
        });
    }
    if (!["admin", "branch_manager"].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message:
                "Only admin or branch manager can manage attendance settings.",
            data: null,
            errors: null
        });
    }
    next();
};

/** Strict owner (admin) for global policy / timezone. */
const ownerOnly = (req, res, next) => {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Only owner/admin can perform this action.",
            data: null,
            errors: null
        });
    }
    next();
};

/** Block pure vendors from any HR attendance route. */
const blockVendor = (req, res, next) => {
    if (req.user?.role === "vendor" || req.user?.role === "supplier") {
        return res.status(403).json({
            success: false,
            message: "Vendors and suppliers cannot access employee attendance.",
            data: null,
            errors: null
        });
    }
    next();
};

/**
 * Branches managed by a branch_manager (Branch.managerId).
 * Admin → null (no restriction).
 */
const getManagedBranchIds = async (user) => {
    if (!user) return [];
    if (user.role === "admin") return null;
    if (user.role !== "branch_manager") return [];
    const branches = await Branch.find({
        managerId: user._id,
        ...NOT_DELETED
    }).select("_id");
    return branches.map((b) => b._id);
};

/**
 * Attach req.managedBranchIds for downstream services.
 * null = unrestricted (owner/admin).
 */
const attachBranchScope = async (req, res, next) => {
    try {
        req.managedBranchIds = await getManagedBranchIds(req.user);
        if (
            Array.isArray(req.managedBranchIds) &&
            req.managedBranchIds.length === 0 &&
            req.user?.role === "branch_manager"
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "No branches assigned to this branch manager. Contact owner.",
                data: null,
                errors: null
            });
        }
        next();
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Failed to resolve branch scope.",
            data: null,
            errors: null
        });
    }
};

/**
 * Apply branch scope to a mongoose filter (mutates filter).
 * If query.branchId is outside scope → throw.
 */
const applyBranchScopeFilter = (filter, managedBranchIds, requestedBranchId) => {
    if (managedBranchIds === null) {
        // admin unrestricted
        if (requestedBranchId) filter.branchId = requestedBranchId;
        return filter;
    }
    const allowed = managedBranchIds.map(String);
    if (requestedBranchId) {
        if (!allowed.includes(String(requestedBranchId))) {
            throw new AppError(
                "You cannot access attendance outside your branches.",
                403
            );
        }
        filter.branchId = requestedBranchId;
        return filter;
    }
    filter.branchId = { $in: managedBranchIds };
    return filter;
};

const assertBranchInScope = (managedBranchIds, branchId) => {
    if (managedBranchIds === null) return;
    if (!branchId) {
        throw new AppError("Branch is required.", 400);
    }
    if (!managedBranchIds.map(String).includes(String(branchId))) {
        throw new AppError(
            "You cannot access attendance outside your branches.",
            403
        );
    }
};

/**
 * Resolve Employee linked to logged-in AdminUser.
 * Does not trust body.employeeId for self actions.
 */
const resolveEmployeeFromUser = async (user, { requireActive = true } = {}) => {
    if (!user?._id) {
        throw new AppError("Authentication required.", 401);
    }
    const employee = await Employee.findOne({
        userId: user._id,
        isDeleted: { $ne: true }
    })
        .populate(
            "branchId",
            "branchCode name"
        )
        .populate("shiftId")
        .populate("departmentId", "departmentCode departmentName")
        .populate("designationId", "designationCode designationName");

    if (!employee) {
        throw new AppError(
            "No employee profile linked to this account.",
            403
        );
    }

    if (requireActive) {
        if (employee.isActive === false) {
            throw new AppError("Employee account is inactive.", 403);
        }
        if (
            ["Suspended", "Resigned", "Terminated"].includes(
                employee.employmentStatus
            )
        ) {
            throw new AppError(
                `Employee status is ${employee.employmentStatus}.`,
                403
            );
        }
    }

    return employee;
};

const attachEmployee = (options = {}) => async (req, res, next) => {
    try {
        req.employee = await resolveEmployeeFromUser(req.user, options);
        next();
    } catch (err) {
        const status = err.statusCode || 403;
        return res.status(status).json({
            success: false,
            message: err.message || "Employee resolution failed.",
            data: null,
            errors: null
        });
    }
};

/** Strip identity spoofing fields from body (defense in depth). */
const stripSpoofFields = (req, _res, next) => {
    if (req.body && typeof req.body === "object") {
        delete req.body.employeeId;
        delete req.body.companyId;
        delete req.body.userId;
        delete req.body.approvedOvertimeMinutes;
        delete req.body.approvedBy;
        delete req.body.reviewedBy;
        delete req.body.finalApprovedBy;
        delete req.body.attendanceStatus;
        delete req.body.isApproved;
        delete req.body.payrollProcessed;
    }
    next();
};

module.exports = {
    attendanceAdminOnly,
    ownerOnly,
    blockVendor,
    resolveEmployeeFromUser,
    attachEmployee,
    getManagedBranchIds,
    attachBranchScope,
    applyBranchScopeFilter,
    assertBranchInScope,
    stripSpoofFields
};
