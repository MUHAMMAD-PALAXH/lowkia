const { body, param, query } = require("express-validator");

const SUPPLIER_TYPES = [
    "Manufacturer",
    "Distributor",
    "Wholesaler",
    "Retailer",
    "Service Provider",
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

const BALANCE_TYPES = ["Payable", "Advance", "Settled"];
const STATUSES = ["Active", "Inactive", "Blocked"];

const mongoIdParam = param("id")
    .isMongoId()
    .withMessage("Invalid supplier id.");

const contactPersonRules = [
    body("contactPersons")
        .optional()
        .isArray()
        .withMessage("contactPersons must be an array."),
    body("contactPersons.*.name")
        .if(body("contactPersons").isArray({ min: 1 }))
        .notEmpty()
        .withMessage("Contact person name is required.")
        .trim(),
    body("contactPersons.*.email")
        .optional({ checkFalsy: true })
        .isEmail()
        .withMessage("Invalid contact person email.")
        .normalizeEmail()
];

const bankAccountRules = [
    body("bankAccounts")
        .optional()
        .isArray()
        .withMessage("bankAccounts must be an array.")
];

const createSupplierValidator = [
    body("name")
        .notEmpty()
        .withMessage("Supplier name is required.")
        .isLength({ min: 2, max: 150 })
        .withMessage("Supplier name must be between 2 and 150 characters.")
        .trim(),
    body("companyName")
        .optional()
        .isString()
        .trim(),
    body("supplierType")
        .optional()
        .isIn(SUPPLIER_TYPES)
        .withMessage(`supplierType must be one of: ${SUPPLIER_TYPES.join(", ")}`),
    body("email")
        .optional({ checkFalsy: true })
        .isEmail()
        .withMessage("Invalid email address.")
        .normalizeEmail(),
    body("phone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 20 })
        .withMessage("Phone must be between 6 and 20 characters.")
        .trim(),
    body("website")
        .optional({ checkFalsy: true })
        .isURL()
        .withMessage("Invalid website URL."),
    body("paymentTerms")
        .optional()
        .isIn(PAYMENT_TERMS)
        .withMessage(`paymentTerms must be one of: ${PAYMENT_TERMS.join(", ")}`),
    body("creditLimit")
        .optional()
        .isFloat({ min: 0 })
        .withMessage("creditLimit must be a non-negative number."),
    body("creditDays")
        .optional()
        .isInt({ min: 0 })
        .withMessage("creditDays must be a non-negative integer."),
    body("openingBalance")
        .optional()
        .isFloat()
        .withMessage("openingBalance must be a number."),
    body("balanceType")
        .optional()
        .isIn(BALANCE_TYPES)
        .withMessage(`balanceType must be one of: ${BALANCE_TYPES.join(", ")}`),
    body("status")
        .optional()
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    body("tags")
        .optional()
        .isArray()
        .withMessage("tags must be an array."),
    body("supplierCode")
        .not()
        .exists()
        .withMessage("supplierCode is auto-generated and cannot be provided."),
    ...contactPersonRules,
    ...bankAccountRules
];

const updateSupplierValidator = [
    mongoIdParam,
    body("name")
        .optional()
        .isLength({ min: 2, max: 150 })
        .withMessage("Supplier name must be between 2 and 150 characters.")
        .trim(),
    body("companyName")
        .optional()
        .isString()
        .trim(),
    body("supplierType")
        .optional()
        .isIn(SUPPLIER_TYPES)
        .withMessage(`supplierType must be one of: ${SUPPLIER_TYPES.join(", ")}`),
    body("email")
        .optional({ checkFalsy: true })
        .isEmail()
        .withMessage("Invalid email address.")
        .normalizeEmail(),
    body("phone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 20 })
        .withMessage("Phone must be between 6 and 20 characters.")
        .trim(),
    body("website")
        .optional({ checkFalsy: true })
        .isURL()
        .withMessage("Invalid website URL."),
    body("paymentTerms")
        .optional()
        .isIn(PAYMENT_TERMS)
        .withMessage(`paymentTerms must be one of: ${PAYMENT_TERMS.join(", ")}`),
    body("creditLimit")
        .optional()
        .isFloat({ min: 0 })
        .withMessage("creditLimit must be a non-negative number."),
    body("creditDays")
        .optional()
        .isInt({ min: 0 })
        .withMessage("creditDays must be a non-negative integer."),
    body("balanceType")
        .optional()
        .isIn(BALANCE_TYPES)
        .withMessage(`balanceType must be one of: ${BALANCE_TYPES.join(", ")}`),
    body("status")
        .optional()
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    body("tags")
        .optional()
        .isArray()
        .withMessage("tags must be an array."),
    body("supplierCode")
        .not()
        .exists()
        .withMessage("supplierCode cannot be changed."),
    ...contactPersonRules,
    ...bankAccountRules
];

const idValidator = [mongoIdParam];

const listSupplierValidator = [
    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("page must be a positive integer."),
    query("limit")
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage("limit must be between 1 and 100."),
    query("status")
        .optional()
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    query("supplierType")
        .optional()
        .isIn(SUPPLIER_TYPES)
        .withMessage(`supplierType must be one of: ${SUPPLIER_TYPES.join(", ")}`),
    query("isApproved")
        .optional()
        .isIn(["true", "false", true, false])
        .withMessage("isApproved must be true or false."),
    query("search")
        .optional()
        .isString()
        .trim()
];

const rateSupplierValidator = [
    mongoIdParam,
    body("score")
        .notEmpty()
        .withMessage("score is required.")
        .isFloat({ min: 0, max: 5 })
        .withMessage("score must be between 0 and 5.")
];

module.exports = {
    createSupplierValidator,
    updateSupplierValidator,
    idValidator,
    listSupplierValidator,
    rateSupplierValidator
};
