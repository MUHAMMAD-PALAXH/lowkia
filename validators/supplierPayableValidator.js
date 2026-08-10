const { param, query, body } = require("express-validator");

const mongoId = (field = "id") =>
    param(field).isMongoId().withMessage(`Invalid ${field}.`);

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("supplierId").optional().isMongoId(),
    query("purchaseOrderId").optional().isMongoId(),
    query("branchId").optional().isMongoId(),
    query("status")
        .optional()
        .isIn(["open", "partial", "settled", "cancelled"]),
    query("outstandingOnly").optional().isIn(["true", "false", "1", "0"]),
];

const idValidator = [mongoId("id")];

const purchaseOrderIdValidator = [mongoId("purchaseOrderId")];

const supplierIdValidator = [mongoId("supplierId")];

const syncBodyValidator = [
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

module.exports = {
    listValidator,
    idValidator,
    purchaseOrderIdValidator,
    supplierIdValidator,
    syncBodyValidator,
};
