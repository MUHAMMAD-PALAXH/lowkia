const mongoose = require("mongoose");
const {
    DEFAULT_CURRENCY,
    EMPLOYEE_ADVANCE_STATUSES,
} = require("../config/finance");

/**
 * Employee salary advance (Phase 6).
 * Money source of truth = *Minor (USD cents).
 * Disbursement Payment link is optional until Phase 7.
 */
const recoveryLineSchema = new mongoose.Schema(
    {
        recoveredAt: { type: Date, default: Date.now },
        amountMinor: { type: Number, required: true, min: 1 },
        amount: { type: Number, default: 0 },
        source: {
            type: String,
            enum: ["payroll", "manual", "payment", "reversal"],
            default: "manual",
        },
        payrollId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payroll",
            default: null,
        },
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },
        note: { type: String, default: "", trim: true },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    { _id: true }
);

const employeeAdvanceSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        advanceNumber: {
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

        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true,
        },

        employeeCode: { type: String, default: "", trim: true },
        employeeName: { type: String, default: "", trim: true },

        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        requestedAmountMinor: { type: Number, required: true, min: 1 },
        approvedAmountMinor: { type: Number, default: 0, min: 0 },
        disbursedAmountMinor: { type: Number, default: 0, min: 0 },
        recoveredAmountMinor: { type: Number, default: 0, min: 0 },
        /** Remaining employee debt after disbursement. */
        outstandingMinor: { type: Number, default: 0, min: 0 },

        requestedAmount: { type: Number, default: 0 },
        approvedAmount: { type: Number, default: 0 },
        disbursedAmount: { type: Number, default: 0 },
        recoveredAmount: { type: Number, default: 0 },
        outstanding: { type: Number, default: 0 },

        reason: { type: String, default: "", trim: true },
        notes: { type: String, default: "", trim: true },

        repaymentType: {
            type: String,
            enum: ["Single", "Installment", "Payroll"],
            default: "Payroll",
        },
        installmentCount: { type: Number, default: 1, min: 1, max: 60 },

        status: {
            type: String,
            enum: EMPLOYEE_ADVANCE_STATUSES,
            default: "draft",
            index: true,
        },

        requestDate: { type: Date, default: Date.now },
        submittedAt: { type: Date, default: null },
        approvedAt: { type: Date, default: null },
        rejectedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        disbursedAt: { type: Date, default: null },
        settledAt: { type: Date, default: null },
        reversedAt: { type: Date, default: null },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        cancelledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        disbursedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        reversedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        approvalNote: { type: String, default: "", trim: true },
        rejectionReason: { type: String, default: "", trim: true },
        cancelReason: { type: String, default: "", trim: true },
        reverseReason: { type: String, default: "", trim: true },

        /** Phase 7 EmployeePayment disbursement link. */
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
            index: true,
        },

        recoveries: [recoveryLineSchema],

        /** Document-level ledger extension point (V1). */
        isLedgerPosted: { type: Boolean, default: false },
        ledgerPostedAt: { type: Date, default: null },
        ledgerEntryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ledger",
            default: null,
        },

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

employeeAdvanceSchema.index(
    { companyId: 1, advanceNumber: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
employeeAdvanceSchema.index({ companyId: 1, employeeId: 1, status: 1 });
employeeAdvanceSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("EmployeeAdvance", employeeAdvanceSchema);
