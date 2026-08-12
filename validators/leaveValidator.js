const { body, param, query } = require("express-validator");

const LEAVE_TYPES = [
    "Casual Leave",
    "Sick Leave",
    "Annual Leave",
    "Emergency Leave",
    "Maternity Leave",
    "Paternity Leave",
    "Unpaid Leave",
    "Other"
];

const mongoId = param("id").isMongoId().withMessage("Invalid leave id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("employeeId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("approvalStatus")
        .optional()
        .isIn(["Pending", "Approved", "Rejected", "Cancelled"]),
    query("leaveType").optional().isIn(LEAVE_TYPES),
    query("deleted").optional(),
    query("trash").optional(),
    query("sort").optional().isString(),
    query("sortBy").optional().isString()
];

const createLeaveValidator = [
    body("leaveType")
        .notEmpty()
        .withMessage("Leave type is required.")
        .isIn(LEAVE_TYPES),
    body("startDate")
        .notEmpty()
        .withMessage("Start date is required.")
        .isISO8601(),
    body("endDate")
        .notEmpty()
        .withMessage("End date is required.")
        .isISO8601(),
    body("reason")
        .notEmpty()
        .withMessage("Reason is required.")
        .isLength({ min: 3, max: 1000 })
        .trim(),
    body("leaveDuration")
        .optional()
        .isIn(["Full Day", "Half Day"]),
    body("halfDayType")
        .optional()
        .isIn(["First Half", "Second Half"]),
    body("leaveCategory").optional().isIn(["Paid", "Unpaid"]),
    body("employeeNote").optional().isString(),
    body("employeeId").optional().isMongoId()
];

const rejectValidator = [
    mongoId,
    body("reason")
        .notEmpty()
        .withMessage("Rejection reason is required.")
        .trim()
];

const approveValidator = [
    mongoId,
    body("comment").optional().isString().trim()
];

const cancelValidator = [
    mongoId,
    body("reason").optional().isString().trim()
];

const idValidator = [mongoId];

module.exports = {
    listValidator,
    createLeaveValidator,
    rejectValidator,
    approveValidator,
    cancelValidator,
    idValidator
};
