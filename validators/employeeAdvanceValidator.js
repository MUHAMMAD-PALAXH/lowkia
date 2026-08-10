const { body, param, query } = require("express-validator");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid employee advance id."),
];

const employeeIdParamValidator = [
    param("employeeId").isMongoId().withMessage("Invalid employee id."),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn([
            "draft",
            "pendingApproval",
            "approved",
            "rejected",
            "cancelled",
            "disbursed",
            "recovering",
            "settled",
            "reversed",
        ]),
    query("employeeId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("search").optional().isString().trim(),
];

const createValidator = [
    body("employeeId").optional().isMongoId(),
    body("requestedAmount").optional().isFloat({ gt: 0 }),
    body("requestedAmountMinor").optional().isInt({ min: 1 }),
    body("amount").optional().isFloat({ gt: 0 }),
    body("reason").optional().isString().trim(),
    body("notes").optional().isString().trim(),
    body("repaymentType")
        .optional()
        .isIn(["Single", "Installment", "Payroll"]),
    body("installmentCount").optional().isInt({ min: 1, max: 60 }),
    body("submit").optional().isBoolean(),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
    body().custom((_, { req }) => {
        const has =
            req.body.requestedAmount != null ||
            req.body.requestedAmountMinor != null ||
            req.body.amount != null;
        if (!has) throw new Error("requestedAmount is required.");
        return true;
    }),
];

const updateValidator = [
    ...idValidator,
    body("requestedAmount").optional().isFloat({ gt: 0 }),
    body("requestedAmountMinor").optional().isInt({ min: 1 }),
    body("employeeId").optional().isMongoId(),
    body("reason").optional().isString().trim(),
    body("notes").optional().isString().trim(),
    body("repaymentType")
        .optional()
        .isIn(["Single", "Installment", "Payroll"]),
    body("installmentCount").optional().isInt({ min: 1, max: 60 }),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

const approveValidator = [
    ...idValidator,
    body("approvedAmount").optional().isFloat({ gt: 0 }),
    body("approvedAmountMinor").optional().isInt({ min: 1 }),
    body("note").optional().isString().trim(),
    body("notes").optional().isString().trim(),
];

const reasonValidator = [
    ...idValidator,
    body("reason").optional().isString().trim(),
    body("notes").optional().isString().trim(),
];

const disburseValidator = [
    ...idValidator,
    body("disbursedAmount").optional().isFloat({ gt: 0 }),
    body("disbursedAmountMinor").optional().isInt({ min: 1 }),
    body("paymentId").optional().isMongoId(),
    body("notes").optional().isString().trim(),
];

const recoverValidator = [
    ...idValidator,
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("source").optional().isIn(["payroll", "manual", "payment", "reversal"]),
    body("payrollId").optional().isMongoId(),
    body("paymentId").optional().isMongoId(),
    body("note").optional().isString().trim(),
    body("notes").optional().isString().trim(),
    body().custom((_, { req }) => {
        if (req.body.amount == null && req.body.amountMinor == null) {
            throw new Error("Recovery amount is required.");
        }
        return true;
    }),
];

module.exports = {
    idValidator,
    employeeIdParamValidator,
    listValidator,
    createValidator,
    updateValidator,
    approveValidator,
    reasonValidator,
    disburseValidator,
    recoverValidator,
};
