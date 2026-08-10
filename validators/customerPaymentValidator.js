const { body, param, query } = require("express-validator");
const { PAYMENT_STATUSES, PAYMENT_PROVIDERS } = require("../config/finance");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid payment id."),
];

const createCheckoutValidator = [
    body("salesOrderId")
        .notEmpty()
        .withMessage("salesOrderId is required.")
        .isMongoId(),
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("paymentMethod").optional().isString().trim(),
    body("method").optional().isString().trim(),
    body("paymentProvider").optional().isIn(PAYMENT_PROVIDERS),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("completeImmediately").optional().isBoolean(),
    body("createEphemeralKey").optional().isBoolean(),
    body("email").optional().isEmail(),
    body("customerName").optional().isString().trim(),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("salesOrderId").optional().isMongoId(),
    query("customerId").optional().isMongoId(),
];

const reasonValidator = [
    body("reason").optional().isString().trim(),
    body("note").optional().isString().trim(),
];

module.exports = {
    idValidator,
    createCheckoutValidator,
    listValidator,
    reasonValidator,
};
