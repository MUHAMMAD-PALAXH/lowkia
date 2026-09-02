const { body, param, query } = require("express-validator");
const {
    SHIPPING_RULE_TYPES,
    MARKETPLACE_CURRENCIES,
} = require("../constants/marketplace");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const createShippingRuleValidator = [
    body("name").notEmpty().trim().isLength({ min: 1, max: 120 }),
    body("ruleType")
        .notEmpty()
        .isIn(SHIPPING_RULE_TYPES)
        .withMessage("Invalid ruleType."),
    body("currency")
        .optional()
        .isIn(MARKETPLACE_CURRENCIES)
        .withMessage("Invalid currency."),
    body("flatFee").optional().isFloat({ min: 0 }),
    body("freeShippingThreshold").optional({ nullable: true }).isFloat({ min: 0 }),
    body("zones").optional().isArray(),
    body("zones.*.district").optional().isString().trim().isLength({ max: 120 }),
    body("zones.*.city").optional().isString().trim().isLength({ max: 120 }),
    body("zones.*.fee").optional().isFloat({ min: 0 }),
    body("zones.*.estimatedDays").optional().isInt({ min: 0 }),
    body("estimatedDeliveryDays").optional().isInt({ min: 0 }),
    body("isDefault").optional().isBoolean(),
    body("isActive").optional().isBoolean(),
    body("priority").optional().isInt(),
];

const updateShippingRuleValidator = [
    mongoId("id"),
    body("name").optional().trim().isLength({ min: 1, max: 120 }),
    body("ruleType").optional().isIn(SHIPPING_RULE_TYPES),
    body("currency").optional().isIn(MARKETPLACE_CURRENCIES),
    body("flatFee").optional().isFloat({ min: 0 }),
    body("freeShippingThreshold").optional({ nullable: true }).isFloat({ min: 0 }),
    body("zones").optional().isArray(),
    body("zones.*.district").optional().isString().trim().isLength({ max: 120 }),
    body("zones.*.city").optional().isString().trim().isLength({ max: 120 }),
    body("zones.*.fee").optional().isFloat({ min: 0 }),
    body("zones.*.estimatedDays").optional().isInt({ min: 0 }),
    body("estimatedDeliveryDays").optional().isInt({ min: 0 }),
    body("isDefault").optional().isBoolean(),
    body("isActive").optional().isBoolean(),
    body("priority").optional().isInt(),
];

const listShippingRulesValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("isActive").optional().isIn(["true", "false"]),
    query("ruleType").optional().isIn(SHIPPING_RULE_TYPES),
];

const shippingRuleIdValidator = [mongoId("id")];

module.exports = {
    createShippingRuleValidator,
    updateShippingRuleValidator,
    listShippingRulesValidator,
    shippingRuleIdValidator,
};
