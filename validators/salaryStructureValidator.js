const { body, param, query } = require("express-validator");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid salary structure id."),
];

const employeeIdParamValidator = [
    param("employeeId").isMongoId().withMessage("Invalid employee id."),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(["draft", "active", "archived"]),
    query("salaryType").optional().isString(),
    query("employeeId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("currentOnly").optional().isIn(["true", "false", "1", "0"]),
    query("search").optional().isString().trim(),
];

const createValidator = [
    body("structureName")
        .notEmpty()
        .withMessage("structureName is required.")
        .isString()
        .trim(),
    body("salaryType")
        .optional()
        .isIn(["Monthly", "Daily", "Hourly", "monthly", "daily", "hourly"]),
    body("basicSalary").optional().isFloat({ min: 0 }),
    body("basicSalaryMinor").optional().isInt({ min: 0 }),
    body("dailyRate").optional().isFloat({ min: 0 }),
    body("dailyRateMinor").optional().isInt({ min: 0 }),
    body("hourlyRate").optional().isFloat({ min: 0 }),
    body("hourlyRateMinor").optional().isInt({ min: 0 }),
    body("components").optional().isArray(),
    body("employeeId").optional().isMongoId(),
    body("includeDefaults").optional().isBoolean(),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

const updateValidator = [
    ...idValidator,
    body("structureName").optional().isString().trim().notEmpty(),
    body("salaryType")
        .optional()
        .isIn(["Monthly", "Daily", "Hourly", "monthly", "daily", "hourly"]),
    body("components").optional().isArray(),
    body("status").optional().isIn(["draft", "active", "archived"]),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

const assignValidator = [
    ...idValidator,
    body("employeeId")
        .notEmpty()
        .withMessage("employeeId is required.")
        .isMongoId(),
];

const previewValidator = [
    ...idValidator,
    body("presentDays").optional().isFloat({ min: 0 }),
    body("workedHours").optional().isFloat({ min: 0 }),
    body("workedMinutes").optional().isFloat({ min: 0 }),
];

module.exports = {
    idValidator,
    employeeIdParamValidator,
    listValidator,
    createValidator,
    updateValidator,
    assignValidator,
    previewValidator,
};
