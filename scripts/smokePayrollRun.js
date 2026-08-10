/**
 * Phase 5 payroll calculator + run state machine smoke (no DB).
 * Run: node scripts/smokePayrollRun.js
 */
const assert = require("assert");
const {
    mapAttendanceForCalc,
    computeOvertimeMinor,
    calculateEmployeePayroll,
} = require("../services/payrollCalculator");
const sm = require("../services/payrollRunStateMachine");
const { toMinor } = require("../utils/money");

// State machine
assert.strictEqual(sm.assertTransition("draft", "calculating"), "calculating");
assert.strictEqual(sm.assertTransition("calculating", "calculated"), "calculated");
assert.strictEqual(
    sm.assertTransition("calculated", "pendingApproval"),
    "pendingApproval"
);
assert.strictEqual(
    sm.assertTransition("pendingApproval", "approved"),
    "approved"
);
assert.strictEqual(sm.assertTransition("approved", "locked"), "locked");
assert.strictEqual(sm.assertTransition("locked", "paid"), "paid");
assert.throws(() => sm.assertTransition("locked", "cancelled"));
assert.throws(() => sm.assertTransition("paid", "draft"));

// Attendance mapping prefers payroll.workingDays for Daily base
const mapped = mapAttendanceForCalc({
    payroll: {
        workingDays: 20,
        presentDays: 18,
        absentDays: 2,
        leaveDays: 1,
        halfDays: 0,
        approvedOvertimeMinutes: 90,
    },
    totalWorkingMinutes: 9600,
    present: 18,
    absent: 2,
});
assert.strictEqual(mapped.presentDays, 20);
assert.strictEqual(mapped.rawPresentDays, 18);
assert.strictEqual(mapped.workedMinutes, 9600);
assert.strictEqual(mapped.overtimeHours, 1.5);

// OT: $25/hr × 1.5h = $37.50 → 3750 cents
assert.strictEqual(
    computeOvertimeMinor(
        { overtimeRateMinor: toMinor(25) },
        { approvedOvertimeMinutes: 90 }
    ),
    3750
);

// Monthly structure + fixed earning + OT
const result = calculateEmployeePayroll({
    structure: {
        salaryType: "Monthly",
        basicSalaryMinor: toMinor(3000),
        overtimeRateMinor: toMinor(20),
        currency: "USD",
        components: [
            {
                code: "HOUSE",
                componentName: "House",
                componentType: "Earning",
                calculationType: "Fixed",
                amountMinor: toMinor(200),
            },
        ],
    },
    attendanceRow: {
        payroll: {
            workingDays: 22,
            presentDays: 22,
            approvedOvertimeMinutes: 60,
        },
        totalWorkingMinutes: 10560,
    },
});
assert.strictEqual(result.skipped, false);
assert.strictEqual(result.basicSalaryMinor, 300000);
assert.strictEqual(result.overtimeAmountMinor, 2000); // 1h × $20
assert.strictEqual(result.grossSalaryMinor, 322000); // 3000 + 200 + 20
assert.strictEqual(result.netSalaryMinor, 322000);

// Daily: rate × workingDays
const daily = calculateEmployeePayroll({
    structure: {
        salaryType: "Daily",
        dailyRateMinor: toMinor(100),
        currency: "USD",
        components: [],
    },
    attendanceRow: {
        payroll: { workingDays: 15, presentDays: 15 },
        totalWorkingMinutes: 7200,
    },
});
assert.strictEqual(daily.basicSalaryMinor, 150000);

// Skip without structure
const skipped = calculateEmployeePayroll({ structure: null });
assert.strictEqual(skipped.skipped, true);
assert.strictEqual(skipped.status, "skipped");

console.log("✅ Phase 5 payroll run calculator smoke passed.");
