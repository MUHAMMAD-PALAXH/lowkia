const { body, param, query } = require("express-validator");

const mongoId = (field) =>
    body(field).optional({ checkFalsy: true }).isMongoId().withMessage(`Invalid ${field}.`);

const chargeTypeRule = (field) =>
    body(field)
        .optional()
        .isIn(["Fixed", "Percentage"])
        .withMessage(`${field} must be Fixed or Percentage.`);

const createPurchaseOrderValidator = [
    body("supplierId").optional({ checkFalsy: true }).isMongoId(),
    body("warehouseId").optional({ checkFalsy: true }).isMongoId(),
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
    body("items.*.trackingType")
        .optional({ checkFalsy: true })
        .isIn(["IMEI", "Non-IMEI"])
        .withMessage("Line trackingType must be IMEI or Non-IMEI."),
    body("items.*.proCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.proSubCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.proBrandId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.warrantyType")
        .optional({ checkFalsy: true })
        .isIn(["No Warranty", "Days", "Months", "Years", "Lifetime"]),
    body("items.*.warrantyPeriod").optional().isFloat({ min: 0 }),
    body("items.*.sellingPrice").optional().isFloat({ min: 0 }),
    body("items.*.wholesalePrice").optional().isFloat({ min: 0 }),
    body("items.*.quantity")
        .notEmpty()
        .withMessage("Line quantity is required.")
        .isFloat({ gt: 0 }),
    body("items.*.purchasePrice")
        .optional()
        .isFloat({ min: 0 }),
    body("discount").optional().isFloat({ min: 0 }),
    body("tax").optional().isFloat({ min: 0 }),
    body("shippingCost").optional().isFloat({ min: 0 }),
    body("otherCharges").optional().isFloat({ min: 0 }),
    body("paidAmount").optional().isFloat({ min: 0 }),
    chargeTypeRule("discountType"),
    chargeTypeRule("taxType"),
    chargeTypeRule("shippingType"),
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
    body("items.*.trackingType")
        .optional({ checkFalsy: true })
        .isIn(["IMEI", "Non-IMEI"])
        .withMessage("Line trackingType must be IMEI or Non-IMEI."),
    body("items.*.proCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.proSubCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.proBrandId").optional({ checkFalsy: true }).isMongoId(),
    body("items.*.warrantyType")
        .optional({ checkFalsy: true })
        .isIn(["No Warranty", "Days", "Months", "Years", "Lifetime"]),
    body("items.*.warrantyPeriod").optional().isFloat({ min: 0 }),
    body("items.*.sellingPrice").optional().isFloat({ min: 0 }),
    body("items.*.wholesalePrice").optional().isFloat({ min: 0 }),
    body("discount").optional().isFloat({ min: 0 }),
    body("tax").optional().isFloat({ min: 0 }),
    body("shippingCost").optional().isFloat({ min: 0 }),
    body("otherCharges").optional().isFloat({ min: 0 }),
    body("paidAmount").optional().isFloat({ min: 0 }),
    chargeTypeRule("discountType"),
    chargeTypeRule("taxType"),
    chargeTypeRule("shippingType"),
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
    query("limit").optional().isInt({ min: 1, max: 200 }),
    query("status").optional().isString(),
    query("purchaseType").optional().isIn(["Existing", "New"]),
    query("supplierId").optional().isMongoId(),
    query("warehouseId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("search").optional().isString().trim(),
    query("deleted").optional().isIn(["true", "false"]),
    query("trash").optional().isIn(["true", "false"]),
    query("sort")
        .optional()
        .isIn([
            "newest",
            "oldest",
            "alpha",
            "alphabetical",
            "name",
            "items_asc",
            "items_desc",
            "count_asc",
            "count_desc",
            "low",
            "high"
        ])
];

module.exports = {
    createPurchaseOrderValidator,
    updatePurchaseOrderValidator,
    idValidator,
    productIdValidator,
    listValidator
};
