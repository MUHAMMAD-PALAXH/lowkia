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

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const mongoId = param("id").isMongoId().withMessage("Invalid shift id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("status").optional().isIn(["Active", "Inactive"]),
    query("shiftType").optional().isIn([
        "Regular",
        "Night",
        "Rotational",
        "Flexible"
    ]),
    query("deleted").optional(),
    query("trash").optional()
];

const createShiftValidator = [
    body("shiftName")
        .notEmpty()
        .withMessage("Shift name is required.")
        .isLength({ min: 2, max: 120 })
        .trim(),
    body("startTime")
        .notEmpty()
        .withMessage("Start time is required.")
        .matches(TIME)
        .withMessage("startTime must be HH:mm."),
    body("endTime")
        .notEmpty()
        .withMessage("End time is required.")
        .matches(TIME)
        .withMessage("endTime must be HH:mm."),
    body("breakStartTime").optional({ nullable: true }).matches(TIME),
    body("breakEndTime").optional({ nullable: true }).matches(TIME),
    body("workingHours").optional().isFloat({ min: 0, max: 24 }),
    body("lateGraceMinutes").optional().isInt({ min: 0, max: 240 }),
    body("earlyLeaveGraceMinutes").optional().isInt({ min: 0, max: 240 }),
    body("overtimeAfterMinutes").optional().isInt({ min: 0, max: 480 }),
    body("minimumWorkingMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("shiftType")
        .optional()
        .isIn(["Regular", "Night", "Rotational", "Flexible"]),
    body("weeklyOff").optional().isArray(),
    body("weeklyOff.*").optional().isIn(DAYS),
    body("status").optional().isIn(["Active", "Inactive"]),
    body("description").optional().isString()
];

const updateShiftValidator = [
    mongoId,
    body("shiftName").optional().isLength({ min: 2, max: 120 }).trim(),
    body("startTime").optional().matches(TIME),
    body("endTime").optional().matches(TIME),
    body("breakStartTime").optional({ nullable: true }).matches(TIME),
    body("breakEndTime").optional({ nullable: true }).matches(TIME),
    body("workingHours").optional().isFloat({ min: 0, max: 24 }),
    body("lateGraceMinutes").optional().isInt({ min: 0, max: 240 }),
    body("earlyLeaveGraceMinutes").optional().isInt({ min: 0, max: 240 }),
    body("overtimeAfterMinutes").optional().isInt({ min: 0, max: 480 }),
    body("minimumWorkingMinutes").optional().isInt({ min: 0, max: 1440 }),
    body("shiftType")
        .optional()
        .isIn(["Regular", "Night", "Rotational", "Flexible"]),
    body("weeklyOff").optional().isArray(),
    body("weeklyOff.*").optional().isIn(DAYS),
    body("status").optional().isIn(["Active", "Inactive"]),
    body("description").optional().isString()
];

const idValidator = [mongoId];

module.exports = {
    listValidator,
    createShiftValidator,
    updateShiftValidator,
    idValidator
};
