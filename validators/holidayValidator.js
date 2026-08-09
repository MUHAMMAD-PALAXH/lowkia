const { body, param, query } = require("express-validator");

const mongoId = param("id").isMongoId().withMessage("Invalid holiday id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("status").optional().isIn(["Active", "Inactive"]),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("deleted").optional(),
    query("trash").optional()
];

const createHolidayValidator = [
    body("holidayName")
        .notEmpty()
        .withMessage("Holiday name is required.")
        .isLength({ min: 2, max: 150 })
        .trim(),
    body("startDate")
        .notEmpty()
        .withMessage("Start date is required.")
        .isISO8601(),
    body("endDate")
        .notEmpty()
        .withMessage("End date is required.")
        .isISO8601(),
    body("holidayType")
        .optional()
        .isIn(["National", "Company", "Religious", "Optional", "Other"]),
    body("isPaid").optional().isBoolean(),
    body("applicableBranchIds").optional().isArray(),
    body("applicableBranchIds.*").optional().isMongoId(),
    body("description").optional().isString(),
    body("status").optional().isIn(["Active", "Inactive"])
];

const updateHolidayValidator = [
    mongoId,
    body("holidayName").optional().isLength({ min: 2, max: 150 }).trim(),
    body("startDate").optional().isISO8601(),
    body("endDate").optional().isISO8601(),
    body("holidayType")
        .optional()
        .isIn(["National", "Company", "Religious", "Optional", "Other"]),
    body("isPaid").optional().isBoolean(),
    body("applicableBranchIds").optional().isArray(),
    body("applicableBranchIds.*").optional().isMongoId(),
    body("description").optional().isString(),
    body("status").optional().isIn(["Active", "Inactive"])
];

const idValidator = [mongoId];

module.exports = {
    listValidator,
    createHolidayValidator,
    updateHolidayValidator,
    idValidator
};
