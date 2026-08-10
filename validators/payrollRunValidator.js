const { body, param, query } = require("express-validator");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid payroll run id."),
];

const payrollIdValidator = [
    param("payrollId").isMongoId().withMessage("Invalid payroll id."),
];

const listRunsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn([
            "draft",
            "calculating",
            "calculated",
            "pendingApproval",
            "approved",
            "locked",
            "paid",
            "cancelled",
        ]),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("branchId").optional().isMongoId(),
];

const listLinesValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("payrollRunId").optional().isMongoId(),
    query("employeeId").optional().isMongoId(),
    query("status")
        .optional()
        .isIn([
            "draft",
            "calculated",
            "approved",
            "paid",
            "cancelled",
            "skipped",
        ]),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("month").optional().isInt({ min: 1, max: 12 }),
];

const createValidator = [
    body("payrollMonth")
        .optional()
        .isInt({ min: 1, max: 12 }),
    body("month").optional().isInt({ min: 1, max: 12 }),
    body("payrollYear").optional().isInt({ min: 2000, max: 2100 }),
    body("year").optional().isInt({ min: 2000, max: 2100 }),
    body("branchId").optional({ nullable: true }).isMongoId(),
    body("notes").optional().isString().trim(),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
    body().custom((_, { req }) => {
        const month = req.body.payrollMonth ?? req.body.month;
        const year = req.body.payrollYear ?? req.body.year;
        if (month == null || year == null) {
            throw new Error("payrollMonth and payrollYear are required.");
        }
        return true;
    }),
];

const adjustValidator = [
    ...payrollIdValidator,
    body("adjustmentMinor").optional().isInt(),
    body("adjustmentAmount").optional().isFloat(),
    body("notes").optional().isString().trim(),
];

const reasonValidator = [
    ...idValidator,
    body("reason").optional().isString().trim(),
    body("notes").optional().isString().trim(),
];

module.exports = {
    idValidator,
    payrollIdValidator,
    listRunsValidator,
    listLinesValidator,
    createValidator,
    adjustValidator,
    reasonValidator,
};
