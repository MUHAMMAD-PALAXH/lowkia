const { body, param, query } = require("express-validator");

const REQUEST_TYPES = [
    "checkInCorrection",
    "checkOutCorrection",
    "breakCorrection",
    "statusCorrection"
];

const STATUSES = [
    "Present",
    "Absent",
    "Late",
    "Half Day",
    "Leave",
    "Holiday",
    "Weekend",
    "Incomplete",
    "Remote",
    "Work From Home"
];

const mongoId = param("id").isMongoId().withMessage("Invalid correction id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(["pending", "approved", "rejected", "cancelled"]),
    query("requestType").optional().isIn(REQUEST_TYPES),
    query("employeeId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("attendanceId").optional().isMongoId(),
    query("search").optional().isString()
];

const createCorrectionValidator = [
    body("attendanceId")
        .notEmpty()
        .withMessage("attendanceId is required.")
        .isMongoId(),
    body("requestType")
        .notEmpty()
        .withMessage("requestType is required.")
        .isIn(REQUEST_TYPES),
    body("reason")
        .notEmpty()
        .withMessage("Reason is required.")
        .isLength({ min: 5, max: 1000 })
        .trim(),
    body("requestedCheckIn").optional({ nullable: true }).isISO8601(),
    body("requestedCheckOut").optional({ nullable: true }).isISO8601(),
    body("requestedStatus").optional().isIn(STATUSES),
    body("requestedBreaks").optional().isArray(),
    body("employeeId")
        .not()
        .exists()
        .withMessage("employeeId cannot be set by client.")
];

const approveValidator = [
    mongoId,
    body("reviewNote").optional().isString().trim(),
    body("comment").optional().isString().trim()
];

const rejectValidator = [
    mongoId,
    body("reviewNote")
        .optional()
        .isString()
        .trim(),
    body("reason").optional().isString().trim(),
    body().custom((_, { req }) => {
        const note = req.body.reviewNote || req.body.reason;
        if (!note || !String(note).trim()) {
            throw new Error("Rejection reason (reviewNote) is required.");
        }
        return true;
    })
];

const cancelValidator = [mongoId];

const idValidator = [mongoId];

const adminAdjustValidator = [
    param("attendanceId").isMongoId().withMessage("Invalid attendance id."),
    body("checkIn").optional({ nullable: true }).isISO8601(),
    body("checkOut").optional({ nullable: true }).isISO8601(),
    body("attendanceStatus").optional().isIn(STATUSES),
    body("breaks").optional().isArray(),
    body("reason").optional().isString().trim()
];

module.exports = {
    listValidator,
    createCorrectionValidator,
    approveValidator,
    rejectValidator,
    cancelValidator,
    idValidator,
    adminAdjustValidator
};
