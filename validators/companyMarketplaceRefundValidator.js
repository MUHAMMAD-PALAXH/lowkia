const { body, param, query } = require("express-validator");
const { REFUND_SCOPES, REFUND_STATUSES } = require("../constants/marketplace");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const companyOrderIdValidator = [mongoId("companyOrderId")];

const refundIdValidator = [mongoId("refundId")];

const createCompanyRefundValidator = [
    mongoId("companyOrderId"),
    body("scope")
        .optional()
        .isIn(["company_order", "order_item"])
        .withMessage("scope must be company_order or order_item."),
    body("orderItemId")
        .if(body("scope").equals("order_item"))
        .notEmpty()
        .isMongoId()
        .withMessage("orderItemId is required for order_item scope."),
    body("quantity")
        .if(body("scope").equals("order_item"))
        .isInt({ min: 1 })
        .withMessage("quantity is required for order_item scope."),
    body("reason").optional().isString().trim().isLength({ max: 1000 }),
];

const completeRefundValidator = [
    mongoId("refundId"),
    body("providerRefundId").optional().isString().trim().isLength({ max: 200 }),
];

const listRefundsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(REFUND_STATUSES),
];

module.exports = {
    companyOrderIdValidator,
    refundIdValidator,
    createCompanyRefundValidator,
    completeRefundValidator,
    listRefundsValidator,
};
