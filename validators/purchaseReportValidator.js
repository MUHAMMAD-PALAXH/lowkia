const { query } = require("express-validator");

const PURCHASE_STATUSES = [
    "Draft",
    "Pending Approval",
    "Approved",
    "Ordered",
    "Awaiting Supplier",
    "Supplier Demand Received",
    "Revision Required",
    "New Demand Sent",
    "Agreed",
    "Supplier Accepted",
    "Supplier Rejected",
    "Partially Delivered",
    "Completely Delivered",
    "Partially Received",
    "Received",
    "Completed",
    "Cancelled",
];

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("branchId").optional().isMongoId().withMessage("Invalid branchId."),
    query("warehouseId").optional().isMongoId().withMessage("Invalid warehouseId."),
    query("supplierId").optional().isMongoId().withMessage("Invalid supplierId."),
    query("status").optional().isIn(PURCHASE_STATUSES),
    query("paymentStatus").optional().isIn(["Pending", "Partial", "Paid"]),
    query("purchaseType").optional().isIn(["Existing", "New"]),
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
        if (from > to) throw new Error("from must be before or equal to to.");
        const days = (to.getTime() - from.getTime()) / 86_400_000;
        if (days > 731) throw new Error("Date range cannot exceed 731 days.");
        return true;
    }),
];

module.exports = { dashboardValidator, PURCHASE_STATUSES };
