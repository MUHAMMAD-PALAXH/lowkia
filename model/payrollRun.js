const mongoose = require("mongoose");
const {
    DEFAULT_CURRENCY,
    PAYROLL_RUN_STATUSES,
} = require("../config/finance");

/**
 * Batch payroll for a calendar month (Phase 5).
 * Individual employee lines live on Payroll with payrollRunId.
 */
const payrollRunSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        runNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },

        payrollMonth: {
            type: Number,
            required: true,
            min: 1,
            max: 12,
        },

        payrollYear: {
            type: Number,
            required: true,
            min: 2000,
            max: 2100,
        },

        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
            index: true,
        },

        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        status: {
            type: String,
            enum: PAYROLL_RUN_STATUSES,
            default: "draft",
            index: true,
        },

        employeeCount: { type: Number, default: 0, min: 0 },
        calculatedCount: { type: Number, default: 0, min: 0 },
        skippedCount: { type: Number, default: 0, min: 0 },

        totalBasicMinor: { type: Number, default: 0, min: 0 },
        totalGrossMinor: { type: Number, default: 0, min: 0 },
        totalDeductionMinor: { type: Number, default: 0, min: 0 },
        totalNetMinor: { type: Number, default: 0, min: 0 },
        totalOvertimeMinor: { type: Number, default: 0, min: 0 },

        /** Major mirrors for UI convenience. */
        totalBasic: { type: Number, default: 0 },
        totalGross: { type: Number, default: 0 },
        totalDeduction: { type: Number, default: 0 },
        totalNet: { type: Number, default: 0 },
        totalOvertime: { type: Number, default: 0 },

        notes: { type: String, default: "", trim: true },
        calculationError: { type: String, default: "", trim: true },

        calculatedAt: { type: Date, default: null },
        submittedAt: { type: Date, default: null },
        approvedAt: { type: Date, default: null },
        lockedAt: { type: Date, default: null },
        paidAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        lockedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        cancelledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        cancelReason: { type: String, default: "", trim: true },

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

payrollRunSchema.index(
    { companyId: 1, payrollYear: 1, payrollMonth: 1, branchId: 1 },
    {
        unique: true,
        partialFilterExpression: { isDeleted: { $ne: true } },
    }
);
payrollRunSchema.index(
    { companyId: 1, runNumber: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
payrollRunSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PayrollRun", payrollRunSchema);
