const { body, param, query } = require("express-validator");

const mongoId = param("id").isMongoId().withMessage("Invalid employee id.");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString(),
    query("branchId").optional().isMongoId(),
    query("departmentId").optional().isMongoId(),
    query("shiftId").optional().isMongoId(),
    query("employmentStatus")
        .optional()
        .isIn(["Active", "On Leave", "Suspended", "Resigned", "Terminated"]),
    query("deleted").optional(),
    query("trash").optional()
];

const createEmployeeValidator = [
    body("firstName").notEmpty().withMessage("First name is required.").trim(),
    body("lastName").notEmpty().withMessage("Last name is required.").trim(),
    body("phone").notEmpty().withMessage("Phone is required.").trim(),
    body("branchId")
        .notEmpty()
        .withMessage("Branch is required.")
        .isMongoId()
        .withMessage("Invalid branchId."),
    body("userId")
        .notEmpty()
        .withMessage("userId (AdminUser) is required.")
        .isMongoId()
        .withMessage("Invalid userId."),
    body("joiningDate")
        .notEmpty()
        .withMessage("Joining date is required.")
        .isISO8601()
        .withMessage("joiningDate must be a valid date."),
    body("shiftId").optional({ nullable: true }).isMongoId(),
    body("departmentId").optional({ nullable: true }).isMongoId(),
    body("designationId").optional({ nullable: true }).isMongoId(),
    body("email").optional({ checkFalsy: true }).isEmail(),
    body("employmentType")
        .optional()
        .isIn(["Permanent", "Contract", "Part Time", "Intern", "Temporary"]),
    body("employmentStatus")
        .optional()
        .isIn(["Active", "On Leave", "Suspended", "Resigned", "Terminated"])
];

const updateEmployeeValidator = [
    mongoId,
    body("firstName").optional().trim().notEmpty(),
    body("lastName").optional().trim().notEmpty(),
    body("phone").optional().trim().notEmpty(),
    body("branchId").optional().isMongoId(),
    body("userId").optional().isMongoId(),
    body("joiningDate").optional().isISO8601(),
    body("shiftId").optional({ nullable: true }).isMongoId(),
    body("departmentId").optional({ nullable: true }).isMongoId(),
    body("designationId").optional({ nullable: true }).isMongoId(),
    body("email").optional({ checkFalsy: true }).isEmail(),
    body("employmentType")
        .optional()
        .isIn(["Permanent", "Contract", "Part Time", "Intern", "Temporary"]),
    body("employmentStatus")
        .optional()
        .isIn(["Active", "On Leave", "Suspended", "Resigned", "Terminated"])
];

const assignShiftValidator = [
    mongoId,
    body("shiftId")
        .notEmpty()
        .withMessage("shiftId is required.")
        .isMongoId()
        .withMessage("Invalid shiftId.")
];

const idValidator = [mongoId];

module.exports = {
    listValidator,
    createEmployeeValidator,
    updateEmployeeValidator,
    assignShiftValidator,
    idValidator
};
