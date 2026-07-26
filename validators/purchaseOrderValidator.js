const { body, param, query } = require("express-validator");

const mongoId = (field) =>
    body(field).optional({ checkFalsy: true }).isMongoId().withMessage(`Invalid ${field}.`);

const createPurchaseOrderValidator = [
    body("supplierId").notEmpty().withMessage("Supplier is required.").isMongoId(),
    body("warehouseId").notEmpty().withMessage("Warehouse is required.").isMongoId(),
    body("branchId").optional({ checkFalsy: true }).isMongoId(),
    body("purchaseType")
        .optional()
        .isIn(["Existing", "New"])
        .withMessage("purchaseType must be Existing or New."),
    body("items")
        .isArray({ min: 1 })
        .withMessage("At least one purchase line is required."),
    body("items.*.productName")
        .optional({ checkFalsy: true })
        .isString()
        .trim(),
    body("items.*.quantity")
        .notEmpty()
        .withMessage("Line quantity is required.")
        .isFloat({ gt: 0 }),
    body("items.*.purchasePrice")
        .optional()
        .isFloat({ min: 0 }),
    body("paymentTerms")
        .optional()
        .isIn(["Cash", "7 Days", "15 Days", "30 Days", "60 Days", "90 Days", "Custom"]),
    mongoId("createdBy"),
    mongoId("actorId")
];

const updatePurchaseOrderValidator = [
    param("id").isMongoId().withMessage("Invalid purchase order id."),
    body("supplierId").optional({ checkFalsy: true }).isMongoId(),
    body("warehouseId").optional({ checkFalsy: true }).isMongoId(),
    body("branchId").optional({ checkFalsy: true }).isMongoId(),
    body("purchaseType").optional().isIn(["Existing", "New"]),
    body("items").optional().isArray({ min: 1 }),
    body("paymentTerms")
        .optional()
        .isIn(["Cash", "7 Days", "15 Days", "30 Days", "60 Days", "90 Days", "Custom"])
];

const idValidator = [
    param("id").isMongoId().withMessage("Invalid purchase order id.")
];

const productIdValidator = [
    param("productId").isMongoId().withMessage("Invalid product id.")
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isString(),
    query("purchaseType").optional().isIn(["Existing", "New"]),
    query("supplierId").optional().isMongoId(),
    query("warehouseId").optional().isMongoId(),
    query("branchId").optional().isMongoId()
];

module.exports = {
    createPurchaseOrderValidator,
    updatePurchaseOrderValidator,
    idValidator,
    productIdValidator,
    listValidator
};
