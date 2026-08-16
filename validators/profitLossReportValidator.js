const { query } = require("express-validator");

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("branchId").optional().isMongoId().withMessage("Invalid branchId."),
    query("groupBy").optional().isIn(["day", "week", "month"]),
    query("includeRepairs").optional().isBoolean().toBoolean(),
    query("includePayroll").optional().isBoolean().toBoolean(),
    query("includeExpenses").optional().isBoolean().toBoolean(),
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

module.exports = { dashboardValidator };
