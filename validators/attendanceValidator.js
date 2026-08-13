const { body, param, query } = require("express-validator");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid attendance id.")
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("branchId").optional().isMongoId(),
    query("employeeId").optional().isMongoId(),
    query("shiftId").optional().isMongoId(),
    query("status").optional().isString(),
    query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("workDate").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("year").optional().isInt({ min: 2000, max: 2100 })
];

const historyValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("status").optional().isString(),
    query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("workDate").optional().matches(/^\d{4}-\d{2}-\d{2}$/)
];

const monthlyValidator = [
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("year").optional().isInt({ min: 2000, max: 2100 })
];

const checkInValidator = [
    body("latitude")
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }),
    body("longitude")
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }),
    body("locationName").optional().isString().trim().isLength({ max: 240 }),
    body("deviceId").optional().isString().trim(),
    body("deviceName").optional().isString().trim(),
    body("platform").optional().isString().trim(),
    body("appVersion").optional().isString().trim(),
    body("selfie").optional().isString(),
    body("checkInSelfie").optional().isString(),
    body("source")
        .optional()
        .isIn([
            "Biometric",
            "Face Recognition",
            "RFID Card",
            "QR Code",
            "Mobile App",
            "Web Panel",
            "Manual"
        ]),
    body("employeeId")
        .not()
        .exists()
        .withMessage("employeeId cannot be set by client."),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client.")
];

const checkOutValidator = [
    body("latitude")
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }),
    body("longitude")
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }),
    body("locationName").optional().isString().trim().isLength({ max: 240 }),
    body("deviceId").optional().isString().trim(),
    body("platform").optional().isString().trim(),
    body("appVersion").optional().isString().trim(),
    body("selfie").optional().isString(),
    body("checkOutSelfie").optional().isString(),
    body("employeeId")
        .not()
        .exists()
        .withMessage("employeeId cannot be set by client.")
];

const startBreakValidator = [
    body("type")
        .optional()
        .isIn(["lunch", "prayer", "personal", "other"])
];

const dailyReportValidator = [
    query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("workDate").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("branchId").optional().isMongoId(),
    query("departmentId").optional().isMongoId(),
    query("shiftId").optional().isMongoId(),
    query("employeeId").optional().isMongoId(),
    query("status").optional().isString()
];

const monthlyReportValidator = [
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("branchId").optional().isMongoId(),
    query("departmentId").optional().isMongoId(),
    query("employeeId").optional().isMongoId()
];

const branchReportValidator = [
    query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("workDate").optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query("branchId").optional().isMongoId(),
    query("departmentId").optional().isMongoId(),
    query("shiftId").optional().isMongoId(),
    query("status").optional().isString()
];

module.exports = {
    idValidator,
    listValidator,
    historyValidator,
    monthlyValidator,
    checkInValidator,
    checkOutValidator,
    startBreakValidator,
    dailyReportValidator,
    monthlyReportValidator,
    branchReportValidator
};
