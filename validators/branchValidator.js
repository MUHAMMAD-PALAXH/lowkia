const { body, param, query } = require("express-validator");

const STATUSES = ["Active", "Inactive", "Closed", "Maintenance"];

const mongoIdParam = param("id")
    .isMongoId()
    .withMessage("Invalid branch id.");

// Accept real JSON booleans from Flutter/GetConnect (true/false),
// not only string "true"/"false".
const optionalBoolean = (field) =>
    body(field)
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined || value === null || value === "") {
                return true;
            }
            if (typeof value === "boolean") {
                return true;
            }
            if (value === "true" || value === "false" || value === 1 || value === 0 || value === "1" || value === "0") {
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

const warehouseIdsRule = body("warehouseIds")
    .optional({ nullable: true })
    .custom((ids) => {
        if (ids === undefined || ids === null || ids === "") {
            return true;
        }
        if (!Array.isArray(ids)) {
            throw new Error("warehouseIds must be an array.");
        }
        return true;
    });

const warehouseIdsItemRule = body("warehouseIds.*")
    .optional({ nullable: true })
    .custom((id) => {
        if (id === undefined || id === null || id === "") {
            return true;
        }
        const value = String(id);
        if (!/^[a-fA-F0-9]{24}$/.test(value)) {
            throw new Error("Invalid warehouse id in warehouseIds.");
        }
        return true;
    });

const createBranchValidator = [
    body("name")
        .notEmpty()
        .withMessage("Branch name is required.")
        .isLength({ min: 2, max: 150 })
        .withMessage("Branch name must be between 2 and 150 characters.")
        .trim(),
    body("city")
        .custom((value, { req }) => {
            const city = value != null ? String(value).trim() : "";
            const location = req.body.location != null ? String(req.body.location).trim() : "";
            const address = req.body.address != null ? String(req.body.address).trim() : "";
            if (!city && !location && !address) {
                throw new Error("City is required.");
            }
            return true;
        }),
    body("location")
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim(),
    body("address")
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim(),
    body("postalCode")
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim(),
    body("country")
        .optional({ nullable: true, checkFalsy: true })
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
        .isLength({ min: 6, max: 25 })
        .withMessage("Phone must be between 6 and 25 characters.")
        .trim(),
    body("status")
        .optional({ checkFalsy: true })
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    optionalBoolean("isHeadOffice"),
    optionalBoolean("isActive"),
    body("managerId")
        .optional({ checkFalsy: true })
        .isMongoId()
        .withMessage("Invalid managerId."),
    body("description")
        .optional({ nullable: true })
        .isString(),
    body("attendanceLatitude")
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 })
        .withMessage("attendanceLatitude must be between -90 and 90."),
    body("attendanceLongitude")
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 })
        .withMessage("attendanceLongitude must be between -180 and 180."),
    body("attendanceRadiusMeters")
        .optional({ nullable: true })
        .isFloat({ min: 0, max: 50000 })
        .withMessage("attendanceRadiusMeters must be >= 0."),
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
        .optional({ checkFalsy: true })
        .isString()
        .trim(),
    body("location")
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim(),
    body("address")
        .optional({ nullable: true, checkFalsy: true })
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
        .isLength({ min: 6, max: 25 })
        .withMessage("Phone must be between 6 and 25 characters.")
        .trim(),
    body("status")
        .optional({ checkFalsy: true })
        .isIn(STATUSES)
        .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
    optionalBoolean("isHeadOffice"),
    optionalBoolean("isActive"),
    body("managerId")
        .optional({ checkFalsy: true })
        .isMongoId(),
    body("attendanceLatitude")
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }),
    body("attendanceLongitude")
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }),
    body("attendanceRadiusMeters")
        .optional({ nullable: true })
        .isFloat({ min: 0, max: 50000 }),
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
];

module.exports = {
    createBranchValidator,
    updateBranchValidator,
    assignWarehousesValidator,
    statusValidator,
    idValidator,
    listBranchValidator
};
