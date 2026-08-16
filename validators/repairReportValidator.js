const { query } = require("express-validator");

const STATUSES = [
    "Pending",
    "Diagnosing",
    "Waiting For Approval",
    "Waiting For Parts",
    "Repairing",
    "Quality Check",
    "Ready For Pickup",
    "Completed",
    "Delivered",
    "Cancelled",
];
const SERVICE_TYPES = [
    "Hardware",
    "Software",
    "Screen Replacement",
    "Battery Replacement",
    "Water Damage",
    "Unlock",
    "Board Repair",
    "General Service",
    "Other",
];

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("branchId").optional().isMongoId().withMessage("Invalid branchId."),
    query("technicianId")
        .optional()
        .isMongoId()
        .withMessage("Invalid technicianId."),
    query("status").optional().isIn(STATUSES),
    query("priority").optional().isIn(["Low", "Normal", "High", "Urgent"]),
    query("serviceType").optional().isIn(SERVICE_TYPES),
    query("paymentStatus").optional().isIn(["Unpaid", "Partial", "Paid"]),
    query("paymentMethod")
        .optional()
        .isIn(["Advance", "Partial", "CashOnDelivery", "Bank"]),
    query("ticketSource").optional().isIn(["NewRepair", "ExistingProduct"]),
    query("trackingType").optional().isIn(["IMEI", "Non-IMEI"]),
    query("warranty").optional().isIn(["all", "warranty", "nonWarranty"]),
    query("groupBy").optional().isIn(["day", "week", "month"]),
    query("search")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 100 }),
    query("page").optional().isInt({ min: 1, max: 100000 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
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

module.exports = { dashboardValidator, STATUSES, SERVICE_TYPES };
