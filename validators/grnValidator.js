const { body, param, query } = require("express-validator");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid GRN id.")
];

const createFromPoValidator = [
    body("purchaseOrderId")
        .notEmpty()
        .withMessage("purchaseOrderId is required.")
        .isMongoId(),
    body("warehouseId").optional({ checkFalsy: true }).isMongoId(),
    body("branchId").optional({ checkFalsy: true }).isMongoId()
];

const updateGrnValidator = [
    param("id").isMongoId().withMessage("Invalid GRN id."),
    body("items").optional().isArray(),
    body("items.*.receivedQuantity").optional().isFloat({ min: 0 }),
    body("items.*.damagedQuantity").optional().isFloat({ min: 0 })
];

const scanImeiValidator = [
    param("id").isMongoId().withMessage("Invalid GRN id."),
    body("imei").notEmpty().withMessage("IMEI is required.").isString(),
    body("itemId").optional({ checkFalsy: true }).isMongoId(),
    body("purchaseOrderItemId").optional({ checkFalsy: true }).isMongoId()
];

const bulkImeiValidator = [
    param("id").isMongoId().withMessage("Invalid GRN id."),
    body("itemId").optional({ checkFalsy: true }).isMongoId(),
    body("purchaseOrderItemId").optional({ checkFalsy: true }).isMongoId()
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isString(),
    query("purchaseOrderId").optional().isMongoId()
];

module.exports = {
    idValidator,
    createFromPoValidator,
    updateGrnValidator,
    scanImeiValidator,
    bulkImeiValidator,
    listValidator
};
