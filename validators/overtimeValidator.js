const { body, param, query } = require("express-validator");

const mongoId = param("id").isMongoId().withMessage("Invalid overtime id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(["pending", "approved", "rejected", "cancelled"]),
    query("employeeId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("attendanceId").optional().isMongoId(),
    query("search").optional().isString()
];

const createOvertimeValidator = [
    body("attendanceId")
        .notEmpty()
        .withMessage("attendanceId is required.")
        .isMongoId(),
    body("requestedMinutes")
        .optional()
        .isInt({ min: 1, max: 24 * 60 }),
    body("reason")
        .notEmpty()
        .withMessage("Reason is required.")
        .isLength({ min: 5, max: 1000 })
        .trim(),
    body("employeeId")
        .not()
        .exists()
        .withMessage("employeeId cannot be set by client.")
];

const approveValidator = [
    mongoId,
    body("approvedMinutes").optional().isInt({ min: 1, max: 24 * 60 }),
    body("reviewNote").optional().isString().trim(),
    body("comment").optional().isString().trim()
];

const rejectValidator = [
    mongoId,
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

module.exports = {
    listValidator,
    createOvertimeValidator,
    approveValidator,
    rejectValidator,
    cancelValidator,
    idValidator
};
