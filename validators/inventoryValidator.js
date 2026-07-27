const { param, query } = require("express-validator");

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
    query("warehouseId").optional({ checkFalsy: true }).isMongoId(),
    query("branchId").optional({ checkFalsy: true }).isMongoId(),
    query("productId").optional({ checkFalsy: true }).isMongoId(),
    query("stockStatus").optional().isString(),
    query("movementType").optional().isString(),
    query("status").optional().isString()
];

const idValidator = [
    param("id").isMongoId().withMessage("Invalid inventory id.")
];

module.exports = { listValidator, idValidator };
