const { query } = require("express-validator");

const MOVEMENT_TYPES = [
    "Purchase",
    "Sale",
    "Purchase Return",
    "Sales Return",
    "Transfer In",
    "Transfer Out",
    "Adjustment",
    "Damage",
    "Opening Stock",
];

const mongoId = (name) =>
    query(name).optional().isMongoId().withMessage(`Invalid ${name}.`);
const positiveInt = (name, max, defaultValue) =>
    query(name)
        .optional()
        .isInt({ min: 1, max })
        .withMessage(`${name} must be between 1 and ${max}.`)
        .toInt()
        .default(defaultValue);

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("groupBy").optional().isIn(["day", "week", "month"]),
    mongoId("branchId"),
    mongoId("warehouseId"),
    mongoId("categoryId"),
    mongoId("brandId"),
    mongoId("productId"),
    mongoId("productVariantId"),
    query("trackingType").optional().isIn(["IMEI", "Non-IMEI"]),
    query("stockStatus")
        .optional()
        .isIn(["In Stock", "Low Stock", "Out Of Stock", "Over Stock"]),
    query("movementType").optional().isIn(MOVEMENT_TYPES),
    query("movementDirection").optional().isIn(["IN", "OUT"]),
    query("search")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage("search must be between 1 and 100 characters."),
    positiveInt("slowMoverDays", 3650, 60),
    positiveInt("deadStockDays", 3650, 90),
    positiveInt("stockPage", 100000, 1),
    positiveInt("stockLimit", 100, 25),
    positiveInt("movementPage", 100000, 1),
    positiveInt("movementLimit", 100, 25),
    query().custom((value) => {
        const to = value.to ? new Date(value.to) : new Date();
        const from = value.from
            ? new Date(value.from)
            : new Date(to.getTime() - 29 * 86_400_000);
        if (from > to) throw new Error("from must be before or equal to to.");
        if ((to.getTime() - from.getTime()) / 86_400_000 > 731) {
            throw new Error("Date range cannot exceed 731 days.");
        }
        return true;
    }),
];

module.exports = { dashboardValidator, MOVEMENT_TYPES };
