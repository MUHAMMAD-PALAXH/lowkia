const { body, param, query } = require("express-validator");

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "Mobile Banking", "Credit"];
const STATUSES = [
    "Draft",
    "Pending Approval",
    "Approved",
    "Confirmed",
    "Processing",
    "Completed",
    "Cancelled"
];

const idValidator = [
    param("id").isMongoId().withMessage("Invalid sales order id.")
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(STATUSES),
    query("search").optional().isString().trim(),
    query("customerId").optional().isMongoId(),
    query("warehouseId").optional().isMongoId(),
    query("branchId").optional().isMongoId()
];

const lineRules = [
    body("items")
        .isArray({ min: 1 })
        .withMessage("At least one sales line is required."),
    body("items.*.productId")
        .notEmpty()
        .withMessage("productId is required on each line.")
        .isMongoId(),
    body("items.*.quantity")
        .notEmpty()
        .isFloat({ gt: 0 })
        .withMessage("quantity must be greater than 0."),
    body("items.*.unitPrice").optional().isFloat({ min: 0 }),
    body("items.*.productVariantId").optional({ checkFalsy: true }).isMongoId()
];

const createSalesOrderValidator = [
    body("customerId")
        .notEmpty()
        .withMessage("Customer is required.")
        .isMongoId(),
    body("warehouseId")
        .notEmpty()
        .withMessage("Warehouse is required.")
        .isMongoId(),
    body("branchId")
        .notEmpty()
        .withMessage("Branch is required.")
        .isMongoId(),
    body("paymentMethod").optional().isIn(PAYMENT_METHODS),
    body("discount").optional().isFloat({ min: 0 }),
    body("tax").optional().isFloat({ min: 0 }),
    body("shippingCost").optional().isFloat({ min: 0 }),
    body("otherCharges").optional().isFloat({ min: 0 }),
    body("paidAmount").optional().isFloat({ min: 0 }),
    ...lineRules
];

const updateSalesOrderValidator = [
    ...idValidator,
    body("customerId").optional().isMongoId(),
    body("warehouseId").optional().isMongoId(),
    body("branchId").optional().isMongoId(),
    body("paymentMethod").optional().isIn(PAYMENT_METHODS),
    body("items").optional().isArray({ min: 1 }),
    body("items.*.productId").optional().isMongoId(),
    body("items.*.quantity").optional().isFloat({ gt: 0 })
];

module.exports = {
    idValidator,
    listValidator,
    createSalesOrderValidator,
    updateSalesOrderValidator
};
