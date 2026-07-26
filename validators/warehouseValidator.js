const { body, param, query } = require("express-validator");

const WAREHOUSE_TYPES = [
    "Main Warehouse",
    "Branch Warehouse",
    "Return Warehouse",
    "Damage Warehouse",
    "Transit Warehouse",
    "Production Warehouse"
];

const CAPACITY_UNITS = [
    "Piece",
    "Box",
    "Kg",
    "Ton",
    "Liter",
    "Pallet",
    "Container"
];

const STATUSES = ["Active", "Inactive", "Closed", "Maintenance"];

const mongoIdParam = param("id")
    .isMongoId()
    .withMessage("Invalid warehouse id.");

const optionalBoolean = (field) =>
    body(field)
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined || value === null || value === "") return true;
            if (typeof value === "boolean") return true;
            if (
                value === "true" ||
                value === "false" ||
                value === 1 ||
                value === 0 ||
                value === "1" ||
                value === "0"
            ) {
                return true;
            }
            throw new Error(`${field} must be boolean.`);
        })
        .customSanitizer((value) => {
            if (value === true || value === "true" || value === 1 || value === "1") {
                return true;
            }
            if (value === false || value === "false" || value === 0 || value === "0") {
                return false;
            }
            return value;
        });

const branchIdsRule = body("branchIds")
    .optional({ nullable: true })
    .custom((ids) => {
        if (ids === undefined || ids === null || ids === "") return true;
        if (!Array.isArray(ids)) {
            throw new Error("branchIds must be an array.");
        }
        return true;
    });

const branchIdsItemRule = body("branchIds.*")
    .optional({ nullable: true })
    .custom((id) => {
        if (id === undefined || id === null || id === "") return true;
        if (!/^[a-fA-F0-9]{24}$/.test(String(id))) {
            throw new Error("Invalid branch id in branchIds.");
        }
        return true;
    });

const createWarehouseValidator = [
    body("warehouseName")
        .notEmpty()
        .withMessage("Warehouse name is required.")
        .isLength({ min: 2, max: 150 })
        .trim(),
    body("city")
        .notEmpty()
        .withMessage("City is required.")
        .trim(),
    body("fullAddress")
        .notEmpty()
        .withMessage("Full address is required.")
        .trim(),
    body("warehouseType")
        .optional({ checkFalsy: true })
        .isIn(WAREHOUSE_TYPES),
    body("capacityUnit")
        .optional({ checkFalsy: true })
        .isIn(CAPACITY_UNITS),
    body("status")
        .optional({ checkFalsy: true })
        .isIn(STATUSES),
    body("capacity")
        .optional({ checkFalsy: true })
        .isFloat({ min: 0 }),
    body("currentUtilization")
        .optional({ checkFalsy: true })
        .isFloat({ min: 0 }),
    body("managerName")
        .optional({ nullable: true })
        .isString()
        .trim(),
    body("managerPhone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 25 })
        .trim(),
    body("managerEmail")
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail(),
    body("contactEmail")
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail(),
    body("parentWarehouseId")
        .optional({ checkFalsy: true })
        .isMongoId(),
    body("warehouseManagerId")
        .optional({ checkFalsy: true })
        .isMongoId(),
    body("warehouseCode")
        .not()
        .exists()
        .withMessage("warehouseCode is auto-generated and cannot be provided."),
    optionalBoolean("isDefault"),
    branchIdsRule,
    branchIdsItemRule
];

const updateWarehouseValidator = [
    mongoIdParam,
    body("warehouseName")
        .optional()
        .isLength({ min: 2, max: 150 })
        .trim(),
    body("city")
        .optional({ checkFalsy: true })
        .isString()
        .trim(),
    body("fullAddress")
        .optional({ checkFalsy: true })
        .isString()
        .trim(),
    body("warehouseType")
        .optional({ checkFalsy: true })
        .isIn(WAREHOUSE_TYPES),
    body("capacityUnit")
        .optional({ checkFalsy: true })
        .isIn(CAPACITY_UNITS),
    body("status")
        .optional({ checkFalsy: true })
        .isIn(STATUSES),
    body("managerPhone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 25 }),
    body("managerEmail")
        .optional({ checkFalsy: true })
        .isEmail()
        .normalizeEmail(),
    body("parentWarehouseId")
        .optional({ checkFalsy: true })
        .isMongoId(),
    body("warehouseCode")
        .not()
        .exists()
        .withMessage("warehouseCode cannot be changed."),
    optionalBoolean("isDefault"),
    branchIdsRule,
    branchIdsItemRule
];

const assignBranchesValidator = [
    mongoIdParam,
    body("branchIds")
        .isArray()
        .withMessage("branchIds must be an array."),
    body("branchIds.*")
        .isMongoId()
        .withMessage("Invalid branch id.")
];

const statusValidator = [
    mongoIdParam,
    body("status")
        .notEmpty()
        .isIn(STATUSES)
];

const idValidator = [mongoIdParam];

const listWarehouseValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(STATUSES),
    query("warehouseType").optional().isIn(WAREHOUSE_TYPES),
    query("search").optional().isString().trim(),
    query("branchId").optional().isMongoId()
];

module.exports = {
    createWarehouseValidator,
    updateWarehouseValidator,
    assignBranchesValidator,
    statusValidator,
    idValidator,
    listWarehouseValidator
};
