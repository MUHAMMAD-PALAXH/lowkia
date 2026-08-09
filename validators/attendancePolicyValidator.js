const { body, param, query } = require("express-validator");

const DAYS = [
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday"
];

const mongoId = param("id").isMongoId().withMessage("Invalid id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("status").optional().isIn(["Active", "Inactive"]),
    query("deleted").optional(),
    query("trash").optional()
];

const createPolicyValidator = [
    body("policyName")
        .notEmpty()
        .withMessage("Policy name is required.")
        .isLength({ min: 2, max: 120 })
        .trim(),
    body("gracePeriodMinutes").optional().isInt({ min: 0, max: 240 }),
    body("standardBreakMinutes").optional().isInt({ min: 0, max: 480 }),
    body("minimumWorkingMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("halfDayThresholdMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("lateThresholdMinutes").optional().isInt({ min: 0, max: 240 }),
    body("earlyLeaveThresholdMinutes").optional().isInt({ min: 0, max: 240 }),
    body("overtimeAfterMinutes").optional().isInt({ min: 0, max: 480 }),
    body("overtimeEnabled").optional().isBoolean(),
    body("overtimeRequiresApproval").optional().isBoolean(),
    body("locationRequired").optional().isBoolean(),
    body("selfieRequired").optional().isBoolean(),
    body("isDefault").optional().isBoolean(),
    body("weeklyOff")
        .optional()
        .isArray()
        .withMessage("weeklyOff must be an array."),
    body("weeklyOff.*").optional().isIn(DAYS),
    body("officeStartTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .withMessage("officeStartTime must be HH:mm."),
    body("officeEndTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .withMessage("officeEndTime must be HH:mm.")
];

const updatePolicyValidator = [
    mongoId,
    body("policyName").optional().isLength({ min: 2, max: 120 }).trim(),
    body("gracePeriodMinutes").optional().isInt({ min: 0, max: 240 }),
    body("standardBreakMinutes").optional().isInt({ min: 0, max: 480 }),
    body("minimumWorkingMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("halfDayThresholdMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("lateThresholdMinutes").optional().isInt({ min: 0, max: 240 }),
    body("earlyLeaveThresholdMinutes").optional().isInt({ min: 0, max: 240 }),
    body("overtimeAfterMinutes").optional().isInt({ min: 0, max: 480 }),
    body("overtimeEnabled").optional().isBoolean(),
    body("overtimeRequiresApproval").optional().isBoolean(),
    body("locationRequired").optional().isBoolean(),
    body("selfieRequired").optional().isBoolean(),
    body("isDefault").optional().isBoolean(),
    body("status").optional().isIn(["Active", "Inactive"]),
    body("weeklyOff").optional().isArray(),
    body("weeklyOff.*").optional().isIn(DAYS),
    body("officeStartTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body("officeEndTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
];

const idValidator = [mongoId];

module.exports = {
    listValidator,
    createPolicyValidator,
    updatePolicyValidator,
    idValidator
};
