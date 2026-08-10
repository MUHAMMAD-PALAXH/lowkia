/**
 * Phase 4 salary-structure calculator smoke (no DB).
 * Run: node scripts/smokeSalaryStructure.js
 */
const assert = require("assert");
const {
    normalizeSalaryType,
    resolveBasePayMinor,
    applyComponents,
    previewStructurePay,
} = require("../services/salaryStructureCalculator");
const { toMinor } = require("../utils/money");

assert.strictEqual(normalizeSalaryType("monthly"), "Monthly");
assert.strictEqual(normalizeSalaryType("DAILY"), "Daily");
assert.strictEqual(normalizeSalaryType("Hourly"), "Hourly");

// Monthly basic
assert.strictEqual(
    resolveBasePayMinor({
        salaryType: "Monthly",
        basicSalaryMinor: toMinor(3000),
    }),
    300000
);

// Daily × present days
assert.strictEqual(
    resolveBasePayMinor(
        { salaryType: "Daily", dailyRateMinor: toMinor(100) },
        { presentDays: 20 }
    ),
    200000
);

// Hourly × hours
assert.strictEqual(
    resolveBasePayMinor(
        { salaryType: "Hourly", hourlyRateMinor: toMinor(25) },
        { workedHours: 8 }
    ),
    20000
);

// Fixed earning + % of basic deduction
const breakdown = applyComponents(
    toMinor(1000),
    [
        {
            code: "HOUSE",
            componentName: "House",
            componentType: "Earning",
            calculationType: "Fixed",
            amountMinor: toMinor(200),
        },
        {
            code: "TAX",
            componentName: "Tax",
            componentType: "Deduction",
            calculationType: "Percentage",
            percentage: 10,
            basedOn: "Basic",
        },
    ],
    "USD"
);
assert.strictEqual(breakdown.basicMinor, 100000);
assert.strictEqual(breakdown.earningMinor, 20000);
assert.strictEqual(breakdown.deductionMinor, 10000); // 10% of 1000
assert.strictEqual(breakdown.grossMinor, 120000);
assert.strictEqual(breakdown.netMinor, 110000);

// % of Gross (2-pass): allowance fixed then % of gross as deduction
const grossPct = previewStructurePay({
    salaryType: "Monthly",
    basicSalaryMinor: toMinor(1000),
    currency: "USD",
    components: [
        {
            code: "BONUS",
            componentName: "Bonus",
            componentType: "Earning",
            calculationType: "Fixed",
            amountMinor: toMinor(200),
        },
        {
            code: "INS",
            componentName: "Insurance",
            componentType: "Deduction",
            calculationType: "Percentage",
            percentage: 5,
            basedOn: "Gross",
        },
    ],
});
// Gross base for % = basic 1000 + fixed earn 200 = 1200 → 5% = 60
assert.strictEqual(grossPct.grossMinor, 120000);
assert.strictEqual(grossPct.deductionMinor, 6000);
assert.strictEqual(grossPct.netMinor, 114000);

console.log("✅ Phase 4 salary structure calculator smoke passed.");
