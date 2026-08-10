const mongoose = require("mongoose");
const {
    DEFAULT_CURRENCY,
    PAYROLL_LINE_STATUSES,
} = require("../config/finance");

/**
 * Payslip component line (snapshot from salary structure + adjustments).
 */
const componentLineSchema = new mongoose.Schema(
    {
        code: { type: String, default: "", trim: true, uppercase: true },
        name: { type: String, required: true, trim: true },
        componentType: {
            type: String,
            enum: ["Earning", "Deduction"],
            required: true,
        },
        calculationType: {
            type: String,
            enum: ["Fixed", "Percentage", "Manual"],
            default: "Fixed",
        },
        amountMinor: { type: Number, default: 0, min: 0 },
        amount: { type: Number, default: 0 },
        percentage: { type: Number, default: 0 },
        basedOn: {
            type: String,
            enum: ["Basic", "Gross", "Net", "None"],
            default: "Basic",
        },
        description: { type: String, default: "" },
    },
    { _id: false }
);

/**
 * Per-employee payroll line inside a PayrollRun (Phase 5).
 * Money source of truth = *Minor (USD cents).
 */
const payrollSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        payrollRunId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PayrollRun",
            required: true,
            index: true,
        },

        payrollNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },

        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
            index: true,
        },

        departmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Department",
            default: null,
        },

        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true,
        },

        employeeCode: { type: String, default: "", trim: true },
        employeeName: { type: String, default: "", trim: true },
        designation: { type: String, default: "", trim: true },

        payrollMonth: { type: Number, required: true, min: 1, max: 12 },
        payrollYear: { type: Number, required: true, min: 2000, max: 2100 },
        payrollPeriod: { type: String, default: "", trim: true },

        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        salaryStructureId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalaryStructure",
            default: null,
        },

        salaryType: {
            type: String,
            enum: ["Monthly", "Daily", "Hourly"],
            default: "Monthly",
        },

        /** Attendance snapshot from summarizeAttendanceRows.payroll + hours. */
        totalWorkingDays: { type: Number, default: 0 },
        presentDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        leaveDays: { type: Number, default: 0 },
        halfDays: { type: Number, default: 0 },
        lateMinutes: { type: Number, default: 0 },
        earlyLeaveMinutes: { type: Number, default: 0 },
        totalWorkingMinutes: { type: Number, default: 0 },
        totalWorkingHours: { type: Number, default: 0 },
        approvedOvertimeMinutes: { type: Number, default: 0 },
        overtimeHours: { type: Number, default: 0 },

        /** Money (minor = cents). */
        basicSalaryMinor: { type: Number, default: 0, min: 0 },
        earningMinor: { type: Number, default: 0, min: 0 },
        deductionMinor: { type: Number, default: 0, min: 0 },
        overtimeAmountMinor: { type: Number, default: 0, min: 0 },
        grossSalaryMinor: { type: Number, default: 0, min: 0 },
        netSalaryMinor: { type: Number, default: 0, min: 0 },
        adjustmentMinor: { type: Number, default: 0 }, // can be negative via signed apply

        /** Major mirrors. */
        basicSalary: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        totalDeductions: { type: Number, default: 0 },
        overtimeAmount: { type: Number, default: 0 },
        grossSalary: { type: Number, default: 0 },
        netSalary: { type: Number, default: 0 },
        adjustmentAmount: { type: Number, default: 0 },

        salaryComponents: [componentLineSchema],

        /** Skip reason when no structure / inactive. */
        skipReason: { type: String, default: "", trim: true },

        status: {
            type: String,
            enum: PAYROLL_LINE_STATUSES,
            default: "draft",
            index: true,
        },

        /** Legacy title-case mirror for old schema consumers. */
        payrollStatus: {
            type: String,
            enum: ["Draft", "Calculated", "Approved", "Paid", "Cancelled"],
            default: "Draft",
        },

        paymentStatus: {
            type: String,
            enum: ["Pending", "Processing", "Completed", "Failed"],
            default: "Pending",
        },

        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },

        paidAt: { type: Date, default: null },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        approvedAt: { type: Date, default: null },
        approvalNote: { type: String, default: "" },

        payslipNumber: { type: String, default: "" },
        payslipGenerated: { type: Boolean, default: false },
        payslipGeneratedAt: { type: Date, default: null },

        notes: { type: String, default: "" },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        isDeleted: { type: Boolean, default: false, index: true },
        deletedAt: { type: Date, default: null },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    { timestamps: true }
);

payrollSchema.index(
    { companyId: 1, employeeId: 1, payrollYear: 1, payrollMonth: 1 },
    {
        unique: true,
        partialFilterExpression: {
            isDeleted: { $ne: true },
            status: { $ne: "cancelled" },
        },
    }
);
payrollSchema.index(
    { companyId: 1, payrollNumber: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
payrollSchema.index({ payrollRunId: 1, status: 1 });

module.exports = mongoose.model("Payroll", payrollSchema);
