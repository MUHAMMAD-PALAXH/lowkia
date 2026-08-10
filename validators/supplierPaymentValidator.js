const { body, param, query } = require("express-validator");
const { PAYMENT_METHODS, PAYMENT_PROVIDERS, PAYMENT_PURPOSES, PAYMENT_STATUSES } = require("../config/finance");

const mongoId = (field = "id", loc = "param") => {
    const chain = loc === "body" ? body(field) : loc === "query" ? query(field) : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const createValidator = [
    body("purchaseOrderId").isMongoId().withMessage("purchaseOrderId is required."),
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("purpose").optional().isIn(PAYMENT_PURPOSES),
    body("paymentMethod").optional().isString().trim(),
    body("method").optional().isString().trim(),
    body("paymentProvider").optional().isIn(PAYMENT_PROVIDERS),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("completeImmediately").optional().isBoolean(),
    body("forcePending").optional().isBoolean(),
    body("phase").optional().isInt({ min: 0 }),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
    body().custom((_, { req }) => {
        if (req.body.amount == null && req.body.amountMinor == null) {
            throw new Error("amount or amountMinor is required.");
        }
        return true;
    }),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("supplierId").optional().isMongoId(),
    query("purchaseOrderId").optional().isMongoId(),
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("purpose").optional().isIn(PAYMENT_PURPOSES),
    query("paymentMethod").optional().isString(),
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
    PAYMENT_METHODS,
};
