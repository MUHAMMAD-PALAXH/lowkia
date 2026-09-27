const { query, param } = require("express-validator");

const dashboardValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("branchId").optional().isMongoId().withMessage("Invalid branchId."),
    query("accountType")
        .optional()
        .isIn(["Asset", "Liability", "Equity", "Income", "Expense"]),
    query("search").optional().isString().trim().isLength({ max: 120 }),
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

const {
    BK_TRANSACTION_TYPES,
    BK_SOURCE_MODULES,
    BK_STATUSES,
    BK_ACCOUNTS,
} = require("../constants/bookkeeping");

const csvIn = (allowed, label) =>
    query(label)
        .optional()
        .isString()
        .custom((value) => {
            const bad = String(value)
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s && !allowed.includes(s));
            if (bad.length) throw new Error(`Invalid ${label}: ${bad.join(", ")}`);
            return true;
        });

const ledgerQueryValidator = [
    query("from").optional().isISO8601().withMessage("from must be an ISO date."),
    query("to").optional().isISO8601().withMessage("to must be an ISO date."),
    query("preset").optional().isIn(["today", "yesterday", "this_week", "this_month"]),
    ...["branchId", "warehouseId", "partyId", "customerId", "supplierId", "employeeId", "createdBy"].map(
        (f) => query(f).optional().isMongoId().withMessage(`Invalid ${f}.`)
    ),
    csvIn(BK_TRANSACTION_TYPES, "transactionType"),
    csvIn(BK_SOURCE_MODULES, "sourceModule"),
    csvIn(BK_STATUSES, "status"),
    query("paymentMethod").optional().isString().trim().isLength({ max: 200 }),
    query("account").optional().isIn(BK_ACCOUNTS),
    query("direction").optional().isIn(["in", "out"]),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("page").optional().isInt({ min: 1, max: 100000 }).toInt(),
    query("limit").optional().isIn(["20", "50", "100", "200"]),
    query("sortBy").optional().isIn(["date", "amount", "entryNumber", "type", "created"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    query("groupBy").optional().isIn(["day", "month", "branch", "module", "paymentMethod", "type"]),
    query("format").optional().isIn(["csv", "xlsx"]),
    query().custom((value) => {
        if (value.preset) return true;
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

const entryIdValidator = [
    param("id").isMongoId().withMessage("Invalid bookkeeping entry id."),
];

module.exports = { dashboardValidator, ledgerQueryValidator, entryIdValidator };
