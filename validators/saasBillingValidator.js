const { body, param, query } = require("express-validator");
const {
    SAAS_V1_PAYMENT_METHODS,
    SAAS_PAYMENT_METHODS,
    SUBSCRIPTION_PAYMENT_INTENTS,
    SUBSCRIPTION_PAYMENT_STATUSES,
    SUBSCRIPTION_INVOICE_STATUSES,
    PAYMENT_REJECTION_REASONS,
} = require("../constants/saasBilling");

const mongoId = (field = "id", loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const createAccountValidator = [
    body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
    body("paymentMethod")
        .notEmpty()
        .isIn(SAAS_PAYMENT_METHODS)
        .withMessage("Invalid paymentMethod."),
    body("accountName").optional().isString().trim().isLength({ max: 200 }),
    body("accountNumber").optional().isString().trim().isLength({ max: 100 }),
    body("bankName").optional().isString().trim().isLength({ max: 200 }),
    body("branchName").optional().isString().trim().isLength({ max: 200 }),
    body("routingNumber").optional().isString().trim().isLength({ max: 50 }),
    body("swiftCode").optional().isString().trim().isLength({ max: 50 }),
    body("bankAddress").optional().isString().trim().isLength({ max: 500 }),
    body("phoneNumber").optional().isString().trim().isLength({ max: 40 }),
    body("qrImageUrl").optional().isString().trim().isLength({ max: 1000 }),
    body("instructions").optional().isString().trim().isLength({ max: 2000 }),
    body("isActive").optional().isBoolean(),
    body("sortOrder").optional().isInt({ min: 0 }),
];

const updateAccountValidator = [
    mongoId("id"),
    body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
    body("paymentMethod").optional().isIn(SAAS_PAYMENT_METHODS),
    body("accountName").optional().isString().trim().isLength({ max: 200 }),
    body("accountNumber").optional().isString().trim().isLength({ max: 100 }),
    body("bankName").optional().isString().trim().isLength({ max: 200 }),
    body("branchName").optional().isString().trim().isLength({ max: 200 }),
    body("routingNumber").optional().isString().trim().isLength({ max: 50 }),
    body("swiftCode").optional().isString().trim().isLength({ max: 50 }),
    body("bankAddress").optional().isString().trim().isLength({ max: 500 }),
    body("phoneNumber").optional().isString().trim().isLength({ max: 40 }),
    body("qrImageUrl").optional().isString().trim().isLength({ max: 1000 }),
    body("instructions").optional().isString().trim().isLength({ max: 2000 }),
    body("isActive").optional().isBoolean(),
    body("sortOrder").optional().isInt({ min: 0 }),
];

const accountIdValidator = [mongoId("id")];

const listAccountsValidator = [
    query("currency").optional().isString().trim(),
    query("paymentMethod").optional().isIn(SAAS_PAYMENT_METHODS),
    query("isActive").optional().isIn(["true", "false"]),
];

const checkoutValidator = [
    body("planId").isMongoId().withMessage("planId is required."),
    body("intent")
        .optional()
        .isIn(SUBSCRIPTION_PAYMENT_INTENTS)
        .withMessage("Invalid intent."),
    body("preferredPaymentMethod")
        .optional()
        .isIn(SAAS_PAYMENT_METHODS),
    body("paymentAccountId").optional().isMongoId(),
];

const submitPaymentValidator = [
    body("invoiceId").isMongoId().withMessage("invoiceId is required."),
    body("paymentMethod")
        .notEmpty()
        .isIn(SAAS_V1_PAYMENT_METHODS)
        .withMessage("Invalid paymentMethod."),
    body("paymentAccountId").optional().isMongoId(),
    body("transactionId").optional().isString().trim().isLength({ max: 120 }),
    body("paymentDate").optional().isISO8601(),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("proofUrl").optional().isString().trim().isLength({ max: 1000 }),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
];

const paymentIdValidator = [mongoId("id")];
const invoiceIdValidator = [mongoId("id")];

const rejectPaymentValidator = [
    mongoId("id"),
    body("reason")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 200 }),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
];

const listPaymentsValidator = [
    query("status").optional().isIn(SUBSCRIPTION_PAYMENT_STATUSES),
    query("companyId").optional().isMongoId(),
    query("paymentMethod").optional().isIn(SAAS_PAYMENT_METHODS),
];

const listInvoicesValidator = [
    query("status").optional().isIn(SUBSCRIPTION_INVOICE_STATUSES),
    query("companyId").optional().isMongoId(),
    query("intent").optional().isIn(SUBSCRIPTION_PAYMENT_INTENTS),
];

module.exports = {
    createAccountValidator,
    updateAccountValidator,
    accountIdValidator,
    listAccountsValidator,
    checkoutValidator,
    submitPaymentValidator,
    paymentIdValidator,
    invoiceIdValidator,
    rejectPaymentValidator,
    listPaymentsValidator,
    listInvoicesValidator,
    PAYMENT_REJECTION_REASONS,
};
