const { query, param } = require("express-validator");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "query" ? query(field) : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const listOrdersValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isString().trim(),
    query("paymentStatus").optional().isString().trim(),
    query("companyId").optional().isMongoId(),
    query("search").optional().isString().trim().isLength({ max: 80 }),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
];

const listPaymentsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isString().trim(),
    query("paymentMethod").optional().isString().trim(),
    query("search").optional().isString().trim().isLength({ max: 80 }),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
];

const listRefundsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(["pending", "processing", "completed", "failed", "cancelled"]),
    query("companyId").optional().isMongoId(),
];

const masterOrderIdValidator = [mongoId("masterOrderId")];
const paymentIdValidator = [mongoId("paymentId")];

module.exports = {
    listOrdersValidator,
    listPaymentsValidator,
    listRefundsValidator,
    masterOrderIdValidator,
    paymentIdValidator,
};
