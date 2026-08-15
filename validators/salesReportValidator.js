const { query } = require("express-validator");

const SALES_STATUSES = [
    "Draft",
    "Pending Approval",
    "Approved",
    "Confirmed",
    "Processing",
    "Completed",
    "Cancelled",
];
const PAYMENT_STATUSES = ["Pending", "Partial", "Paid", "Refunded"];
const PAYMENT_METHODS = ["Cash", "Bank", "Card", "Mobile Banking", "Credit"];

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("branchId").optional().isMongoId().withMessage("Invalid branchId."),
    query("warehouseId").optional().isMongoId().withMessage("Invalid warehouseId."),
    query("status").optional().isIn(SALES_STATUSES),
    query("paymentStatus").optional().isIn(PAYMENT_STATUSES),
    query("paymentMethod").optional().isIn(PAYMENT_METHODS),
    query("salesType").optional().isIn(["Retail", "Wholesale"]),
    query("search")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage("search must be between 1 and 100 characters."),
    query("groupBy").optional().isIn(["day", "week", "month"]),
    query("page").optional().isInt({ min: 1, max: 100000 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query().custom((value) => {
        const to = value.to ? new Date(value.to) : new Date();
        const from = value.from
            ? new Date(value.from)
            : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
        if (from > to) {
            throw new Error("from must be before or equal to to.");
        }
        const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
        if (days > 731) {
            throw new Error("Date range cannot exceed 731 days.");
        }
        return true;
    }),
];

module.exports = { dashboardValidator };
