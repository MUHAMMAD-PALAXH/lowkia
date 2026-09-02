/**
 * Phase 15 platform marketplace monitoring smoke (no DB).
 * Run: node scripts/smokePlatformMarketplace.js
 */
const assert = require("assert");

const startOfDay = (ref = new Date()) =>
    new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

const sumTotalsByCurrency = (rows = []) =>
    rows.map((row) => ({
        currency: String(row._id || "BDT").toUpperCase(),
        total: Number(row.total || 0),
        count: Number(row.count || 0),
    }));

const day = startOfDay(new Date("2026-09-02T15:30:00Z"));
assert.strictEqual(day.getHours(), 0);

const totals = sumTotalsByCurrency([{ _id: "bdt", total: 1000, count: 2 }]);
assert.strictEqual(totals[0].currency, "BDT");
assert.strictEqual(totals[0].total, 1000);

console.log("smokePlatformMarketplace: ok");
