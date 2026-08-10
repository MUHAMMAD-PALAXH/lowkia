/**
 * Phase 8 finance report helper smoke (no DB).
 * Run: node scripts/smokeFinanceReport.js
 */
const assert = require("assert");
const { toMajor, formatMoney, toMinor } = require("../utils/money");

// Money display helpers used by report totals
assert.strictEqual(toMajor(toMinor(1234.56)), 1234.56);
assert.ok(formatMoney(toMinor(100)).includes("100"));

const sumMinor = (rows, key) =>
    rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const sample = [
    { outstandingMinor: 10000, status: "open" },
    { outstandingMinor: 5000, status: "partial" },
    { outstandingMinor: 0, status: "settled" },
];
const open = sample.filter((i) => ["open", "partial"].includes(i.status));
assert.strictEqual(sumMinor(open, "outstandingMinor"), 15000);

const periodBounds = (query = {}) => {
    const year = query.year ? parseInt(query.year, 10) : null;
    const month = query.month ? parseInt(query.month, 10) : null;
    let from = query.from ? new Date(query.from) : null;
    let to = query.to ? new Date(query.to) : null;
    if (year && month && !from && !to) {
        from = new Date(Date.UTC(year, month - 1, 1));
        to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    }
    return { from, to };
};

const { from, to } = periodBounds({ year: 2026, month: 8 });
assert.strictEqual(from.getUTCFullYear(), 2026);
assert.strictEqual(from.getUTCMonth(), 7);
assert.strictEqual(to.getUTCMonth(), 7);
assert.strictEqual(to.getUTCDate(), 31);

// Module loads
require("../services/financeReportService");
require("../routes/financeReport");

console.log("✅ Phase 8 finance report smoke passed.");
