const { body, param, query } = require("express-validator");

const CUSTOMER_TYPES = [
    "Retail",
    "Wholesale",
    "Corporate",
    "Distributor",
    "VIP",
    "Other"
];

const PAYMENT_TERMS = [
    "Cash",
    "7 Days",
    "15 Days",
    "30 Days",
    "60 Days",
    "90 Days",
    "Custom"
];

const STATUSES = ["Active", "Inactive", "Blocked"];

const idValidator = [param("id").isMongoId().withMessage("Invalid customer id.")];

const listCustomerValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(STATUSES),
    query("customerType").optional().isIn(CUSTOMER_TYPES),
    query("search").optional().isString().trim()
];

const createCustomerValidator = [
    body("name")
        .notEmpty()
        .withMessage("Customer name is required.")
        .isLength({ min: 2, max: 150 })
        .trim(),
    body("companyName").optional().isString().trim(),
    body("customerType")
        .optional()
        .isIn(CUSTOMER_TYPES)
        .withMessage(`customerType must be one of: ${CUSTOMER_TYPES.join(", ")}`),
    body("email")
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail(),
    body("phone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 20 })
        .trim(),
    body("paymentTerms").optional().isIn(PAYMENT_TERMS),
    body("creditLimit").optional().isFloat({ min: 0 }),
    body("creditDays").optional().isInt({ min: 0 }),
    body("status").optional().isIn(STATUSES),
    body("address").optional().isString().trim(),
    body("city").optional().isString().trim(),
    body("country").optional().isString().trim(),
    body("note").optional().isString().trim()
];

const updateCustomerValidator = [
    ...idValidator,
    body("name").optional().isLength({ min: 2, max: 150 }).trim(),
    body("customerType").optional().isIn(CUSTOMER_TYPES),
    body("email").optional({ checkFalsy: true }).isEmail().normalizeEmail(),
    body("phone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 20 })
        .trim(),
    body("paymentTerms").optional().isIn(PAYMENT_TERMS),
    body("status").optional().isIn(STATUSES)
];

module.exports = {
    idValidator,
    listCustomerValidator,
    createCustomerValidator,
    updateCustomerValidator
};
