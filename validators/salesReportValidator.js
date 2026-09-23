const { body, param, query } = require("express-validator");

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
const PAYMENT_METHODS = ["Cash", "Bank", "Card", "Clover Flex", "Mobile Banking", "Credit"];
const PERIOD_TYPES = ["daily", "weekly", "monthly", "yearly"];

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("dateFrom").optional().isISO8601().withMessage("dateFrom must be an ISO date."),
    query("dateTo").optional().isISO8601().withMessage("dateTo must be an ISO date."),
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
        const toRaw = value.to || value.dateTo;
        const fromRaw = value.from || value.dateFrom;
        const to = toRaw ? new Date(toRaw) : new Date();
        const from = fromRaw
            ? new Date(fromRaw)
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

const listTargetsValidator = [
    query("periodType").optional().isIn(PERIOD_TYPES),
    query("periodKey").optional().isString().trim().isLength({ min: 4, max: 32 }),
    query("month").optional().matches(/^\d{4}-\d{2}$/),
];

const upsertTargetValidator = [
    body("periodType").isIn(PERIOD_TYPES).withMessage("Invalid periodType."),
    body("periodKey")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 4, max: 32 }),
    body("date").optional().isISO8601().withMessage("date must be an ISO date."),
    body("amount").isFloat({ min: 0 }).withMessage("amount must be 0 or greater."),
    body("note").optional().isString().trim().isLength({ max: 200 }),
    body().custom((value) => {
        if (!value.periodKey && !value.date) {
            throw new Error("periodKey or date is required.");
        }
        return true;
    }),
];

const deleteTargetValidator = [
    param("id").isMongoId().withMessage("Invalid sales target id."),
];

module.exports = {
    dashboardValidator,
    listTargetsValidator,
    upsertTargetValidator,
    deleteTargetValidator,
};
