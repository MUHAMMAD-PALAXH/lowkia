const {
    DEFAULT_CURRENCY,
    toMajor,
    assertNonNegativeMinor,
} = require("../utils/money");
const {
    previewStructurePay,
    normalizeSalaryType,
} = require("./salaryStructureCalculator");

/**
 * Pure payroll line calculator (Phase 5).
 * Combines salary structure preview + attendance + overtime.
 */

const LINE_STATUS_TO_LEGACY = Object.freeze({
    draft: "Draft",
    calculated: "Calculated",
    approved: "Approved",
    paid: "Paid",
    cancelled: "Cancelled",
    skipped: "Cancelled",
});

/**
 * Map attendance monthly summary (employee row) → calculator attendance input.
 * @param {object} attendanceRow - from getMonthlyReport employees[] or summarizeAttendanceRows
 */
const mapAttendanceForCalc = (attendanceRow = {}) => {
    const payroll = attendanceRow.payroll || {};
    const presentDays =
        payroll.presentDays != null
            ? Number(payroll.presentDays)
            : Number(attendanceRow.present) || 0;
    const workingDays =
        payroll.workingDays != null
            ? Number(payroll.workingDays)
            : Number(attendanceRow.workingDaysPresent) || presentDays;

    const workedMinutes =
        Number(attendanceRow.totalWorkingMinutes) ||
        Math.round((Number(attendanceRow.totalWorkingHours) || 0) * 60);

    const approvedOtMinutes =
        payroll.approvedOvertimeMinutes != null
            ? Number(payroll.approvedOvertimeMinutes)
            : Number(attendanceRow.approvedOvertimeMinutes) || 0;

    return {
        presentDays: workingDays > 0 ? workingDays : presentDays,
        rawPresentDays: presentDays,
        absentDays:
            payroll.absentDays != null
                ? Number(payroll.absentDays)
                : Number(attendanceRow.absent) || 0,
        leaveDays:
            payroll.leaveDays != null
                ? Number(payroll.leaveDays)
                : Number(attendanceRow.leave) || 0,
        halfDays:
            payroll.halfDays != null
                ? Number(payroll.halfDays)
                : Number(attendanceRow.halfDay) || 0,
        lateMinutes:
            payroll.lateMinutes != null
                ? Number(payroll.lateMinutes)
                : Number(attendanceRow.totalLateMinutes) || 0,
        earlyLeaveMinutes:
            payroll.earlyLeaveMinutes != null
                ? Number(payroll.earlyLeaveMinutes)
                : Number(attendanceRow.totalEarlyLeaveMinutes) || 0,
        workedMinutes,
        workedHours: workedMinutes / 60,
        approvedOvertimeMinutes: approvedOtMinutes,
        overtimeHours: approvedOtMinutes / 60,
        totalWorkingDays: workingDays,
    };
};

/**
 * Overtime pay from approved OT minutes × structure overtimeRateMinor.
 */
const computeOvertimeMinor = (structure = {}, attendance = {}) => {
    const otMinutes = Math.max(0, Number(attendance.approvedOvertimeMinutes) || 0);
    if (otMinutes <= 0) return 0;
    const rate = assertNonNegativeMinor(
        structure.overtimeRateMinor || 0,
        "Overtime rate"
    );
    if (rate <= 0) return 0;
    // rate is per hour → prorate by minutes
    return Math.round((rate * otMinutes) / 60);
};

/**
 * Calculate one employee payroll line from structure + attendance.
 * Optional adjustmentMinor is applied to net (can be negative conceptually via signed number).
 */
const calculateEmployeePayroll = ({
    structure,
    attendanceRow = {},
    adjustmentMinor = 0,
} = {}) => {
    if (!structure) {
        return {
            skipped: true,
            skipReason: "No salary structure assigned",
            status: "skipped",
        };
    }

    const currency = structure.currency || DEFAULT_CURRENCY;
    const attendance = mapAttendanceForCalc(attendanceRow);
    const preview = previewStructurePay(structure, {
        presentDays: attendance.presentDays,
        workedHours: attendance.workedHours,
        workedMinutes: attendance.workedMinutes,
    });

    const overtimeAmountMinor = computeOvertimeMinor(structure, attendance);
    const adj = Math.round(Number(adjustmentMinor) || 0);

    // Gross includes structure gross + OT; net = gross - deductions + adjustment
    const grossSalaryMinor =
        preview.grossMinor + overtimeAmountMinor;
    const netBeforeAdj = Math.max(0, grossSalaryMinor - preview.deductionMinor);
    const netSalaryMinor = Math.max(0, netBeforeAdj + adj);

    const components = (preview.lines || []).map((line) => ({
        code: line.code || "",
        name: line.componentName || line.name || "Component",
        componentType: line.componentType || "Earning",
        calculationType: line.calculationType || "Fixed",
        amountMinor: line.computedMinor || 0,
        amount: line.computed != null ? line.computed : toMajor(line.computedMinor || 0, currency),
        percentage: line.percentage || 0,
        basedOn: line.basedOn || "Basic",
        description: line.description || "",
    }));

    if (overtimeAmountMinor > 0) {
        components.push({
            code: "OT",
            name: "Approved Overtime",
            componentType: "Earning",
            calculationType: "Manual",
            amountMinor: overtimeAmountMinor,
            amount: toMajor(overtimeAmountMinor, currency),
            percentage: 0,
            basedOn: "None",
            description: `${attendance.overtimeHours.toFixed(2)}h approved OT`,
        });
    }

    if (adj !== 0) {
        components.push({
            code: "ADJ",
            name: "Manual adjustment",
            componentType: adj >= 0 ? "Earning" : "Deduction",
            calculationType: "Manual",
            amountMinor: Math.abs(adj),
            amount: toMajor(Math.abs(adj), currency),
            percentage: 0,
            basedOn: "None",
            description: "Payroll adjustment",
        });
    }

    return {
        skipped: false,
        status: "calculated",
        salaryType: normalizeSalaryType(structure.salaryType),
        currency,
        attendance,
        basicSalaryMinor: preview.basicMinor,
        earningMinor: preview.earningMinor + overtimeAmountMinor + Math.max(0, adj),
        deductionMinor: preview.deductionMinor + Math.max(0, -adj),
        overtimeAmountMinor,
        grossSalaryMinor,
        netSalaryMinor,
        adjustmentMinor: adj,
        salaryComponents: components,
        amounts: {
            basic: toMajor(preview.basicMinor, currency),
            earnings: toMajor(
                preview.earningMinor + overtimeAmountMinor + Math.max(0, adj),
                currency
            ),
            deductions: toMajor(
                preview.deductionMinor + Math.max(0, -adj),
                currency
            ),
            overtime: toMajor(overtimeAmountMinor, currency),
            gross: toMajor(grossSalaryMinor, currency),
            net: toMajor(netSalaryMinor, currency),
            adjustment: toMajor(adj, currency),
        },
    };
};

const syncMajorFromMinor = (doc, currency = DEFAULT_CURRENCY) => {
    doc.basicSalary = toMajor(doc.basicSalaryMinor || 0, currency);
    doc.totalEarnings = toMajor(doc.earningMinor || 0, currency);
    doc.totalDeductions = toMajor(doc.deductionMinor || 0, currency);
    doc.overtimeAmount = toMajor(doc.overtimeAmountMinor || 0, currency);
    doc.grossSalary = toMajor(doc.grossSalaryMinor || 0, currency);
    doc.netSalary = toMajor(doc.netSalaryMinor || 0, currency);
    doc.adjustmentAmount = toMajor(doc.adjustmentMinor || 0, currency);
    return doc;
};

const applyLineStatus = (doc, status) => {
    doc.status = status;
    doc.payrollStatus = LINE_STATUS_TO_LEGACY[status] || "Draft";
    return doc;
};

module.exports = {
    mapAttendanceForCalc,
    computeOvertimeMinor,
    calculateEmployeePayroll,
    syncMajorFromMinor,
    applyLineStatus,
    LINE_STATUS_TO_LEGACY,
};
