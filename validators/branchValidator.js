const { body, param, query } = require("express-validator");

const STATUSES = ["Active", "Inactive", "Closed", "Maintenance"];

const mongoIdParam = param("id")
    .isMongoId()
    .withMessage("Invalid branch id.");

const warehouseIdsRule = body("warehouseIds")
    .optional()
    .isArray()
    .withMessage("warehouseIds must be an array.")
    .custom((ids) => {
        if (!Array.isArray(ids)) return true;
        const invalid = ids.some(
            (id) => typeof id !== "string" && typeof id !== "object"
        );
        if (invalid) {
            throw new Error("Each warehouse id must be valid.");
        }
        return true;
    });

const warehouseIdsItemRule = body("warehouseIds.*")
    .optional()
    .isMongoId()
    .withMessage("Invalid warehouse id in warehouseIds.");

const createBranchValidator = [
    body("name")
        .notEmpty()
        .withMessage("Branch name is required.")
        .isLength({ min: 2, max: 150 })
        .withMessage("Branch name must be between 2 and 150 characters.")
        .trim(),
    body("city")
        .custom((value, { req }) => {
            if ((!value || !String(value).trim()) && !req.body.location) {
                throw new Error("City is required.");
            }
            return true;
        })
        .optional({ nullable: true })
        .trim(),
    body("location")
        .optional()
        .isString()
        .trim(),
    body("address")
        .optional()
        .isString()
        .trim(),
    body("postalCode")
        .optional()
        .isString()
        .trim(),
    body("country")
        .optional()
        .isString()
        .trim(),
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
    body("status")
        .optional()
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    body("isHeadOffice")
        .optional()
        .isBoolean()
        .withMessage("isHeadOffice must be boolean."),
    body("isActive")
        .optional()
        .isBoolean(),
    body("managerId")
        .optional({ checkFalsy: true })
        .isMongoId()
        .withMessage("Invalid managerId."),
    body("description")
        .optional()
        .isString(),
    body("branchCode")
        .not()
        .exists()
        .withMessage("branchCode is auto-generated and cannot be provided."),
    warehouseIdsRule,
    warehouseIdsItemRule
];

const updateBranchValidator = [
    mongoIdParam,
    body("name")
        .optional()
        .isLength({ min: 2, max: 150 })
        .withMessage("Branch name must be between 2 and 150 characters.")
        .trim(),
    body("city")
        .optional()
        .notEmpty()
        .withMessage("City cannot be empty.")
        .trim(),
    body("location")
        .optional()
        .isString()
        .trim(),
    body("address")
        .optional()
        .isString()
        .trim(),
    body("email")
        .optional({ checkFalsy: true })
        .isEmail()
        .withMessage("Invalid email address.")
        .normalizeEmail(),
    body("phone")
        .optional({ checkFalsy: true })
        .isString()
        .isLength({ min: 6, max: 20 })
        .trim(),
    body("status")
        .optional()
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    body("isHeadOffice")
        .optional()
        .isBoolean(),
    body("managerId")
        .optional({ checkFalsy: true })
        .isMongoId(),
    body("branchCode")
        .not()
        .exists()
        .withMessage("branchCode cannot be changed."),
    warehouseIdsRule,
    warehouseIdsItemRule
];

const assignWarehousesValidator = [
    mongoIdParam,
    body("warehouseIds")
        .isArray()
        .withMessage("warehouseIds must be an array."),
    body("warehouseIds.*")
        .isMongoId()
        .withMessage("Invalid warehouse id.")
];

const statusValidator = [
    mongoIdParam,
    body("status")
        .notEmpty()
        .withMessage("status is required.")
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`)
];

const idValidator = [mongoIdParam];

const listBranchValidator = [
    query("page")
        .optional()
        .isInt({ min: 1 }),
    query("limit")
        .optional()
        .isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(STATUSES),
    query("search")
        .optional()
        .isString()
        .trim(),
    query("warehouseId")
        .optional()
        .isMongoId(),
    query("isHeadOffice")
        .optional()
        .isIn(["true", "false", true, false])
];

module.exports = {
    createBranchValidator,
    updateBranchValidator,
    assignWarehousesValidator,
    statusValidator,
    idValidator,
    listBranchValidator
};
