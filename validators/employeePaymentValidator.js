const { body, param, query } = require("express-validator");
const {
    PAYMENT_PROVIDERS,
    PAYMENT_PURPOSES,
    PAYMENT_STATUSES,
} = require("../config/finance");

const mongoId = (field = "id", loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const createValidator = [
    body("payrollId").optional().isMongoId(),
    body("employeeAdvanceId").optional().isMongoId(),
    body("advanceId").optional().isMongoId(),
    body("employeeId").optional().isMongoId(),
    body("partyId").optional().isMongoId(),
    body("paymentType")
        .optional()
        .isIn([
            "EmployeeSalary",
            "EmployeeAdvance",
            "EmployeeBonus",
            "EmployeeOther",
        ]),
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("purpose").optional().isIn(PAYMENT_PURPOSES),
    body("paymentMethod").optional().isString().trim(),
    body("method").optional().isString().trim(),
    body("paymentProvider").optional().isIn(PAYMENT_PROVIDERS),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("completeImmediately").optional().isBoolean(),
    body("forcePending").optional().isBoolean(),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
    body().custom((_, { req }) => {
        if (req.body.amount == null && req.body.amountMinor == null) {
            throw new Error("amount or amountMinor is required.");
        }
        const hasTarget =
            req.body.payrollId ||
            req.body.employeeAdvanceId ||
            req.body.advanceId ||
            req.body.employeeId ||
            req.body.partyId ||
            req.body.paymentType === "EmployeeBonus" ||
            req.body.paymentType === "EmployeeOther";
        if (!hasTarget) {
            throw new Error(
                "payrollId, employeeAdvanceId, or employeeId is required."
            );
        }
        return true;
    }),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("employeeId").optional().isMongoId(),
    query("payrollId").optional().isMongoId(),
    query("payrollRunId").optional().isMongoId(),
    query("employeeAdvanceId").optional().isMongoId(),
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("purpose").optional().isIn(PAYMENT_PURPOSES),
    query("paymentType")
        .optional()
        .isIn([
            "EmployeeSalary",
            "EmployeeAdvance",
            "EmployeeBonus",
            "EmployeeOther",
        ]),
];

const idValidator = [mongoId("id")];

const reasonValidator = [
    body("reason").optional().isString().trim(),
    body("note").optional().isString().trim(),
    body("reversalReason").optional().isString().trim(),
];

const reverseValidator = [
    ...idValidator,
    body("reason")
        .notEmpty()
        .withMessage("Reversal reason is required.")
        .isString()
        .trim()
        .isLength({ min: 3, max: 500 }),
];

module.exports = {
    createValidator,
    listValidator,
    idValidator,
    reasonValidator,
    reverseValidator,
};
