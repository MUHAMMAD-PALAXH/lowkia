const mongoose = require("mongoose");
const {
    DEFAULT_CURRENCY,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
    PAYMENT_STATUSES,
    PAYMENT_TYPES,
    PARTY_TYPES,
    PAYMENT_PURPOSES,
} = require("../config/finance");

/**
 * Shared ERP Payment document (Phase 1 foundation).
 * Supplier / employee flows use this model with paymentType + purpose.
 * Never store raw card / Apple Pay credentials — provider refs only.
 */

const allocationSchema = new mongoose.Schema(
    {
        targetType: {
            type: String,
            enum: [
                "SupplierPayable",
                "PurchaseOrder",
                "Grn",
                "Payroll",
                "PayrollPayable",
                "EmployeeAdvance",
                "SalesOrder",
                "SalesInvoice",
                "Other",
            ],
            required: true,
        },
        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        amountMinor: {
            type: Number,
            required: true,
            min: 1,
        },
        note: {
            type: String,
            default: "",
            trim: true,
        },
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        // ── Tenant ──────────────────────────────────────────
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
            index: true,
        },

        // ── Identity ────────────────────────────────────────
        paymentNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },

        paymentDate: {
            type: Date,
            default: Date.now,
            index: true,
        },

        // ── Classification ──────────────────────────────────
        paymentType: {
            type: String,
            enum: PAYMENT_TYPES,
            required: true,
            index: true,
        },

        purpose: {
            type: String,
            enum: PAYMENT_PURPOSES,
            default: "other",
            index: true,
        },

        partyType: {
            type: String,
            enum: PARTY_TYPES,
            required: true,
        },

        partyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },

        // ── Business document links (optional) ──────────────
        purchaseOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseOrder",
            default: null,
            index: true,
        },

        grnId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Grn",
            default: null,
        },

        supplierPayableId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SupplierPayable",
            default: null,
            index: true,
        },

        payrollId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payroll",
            default: null,
            index: true,
        },

        payrollRunId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PayrollRun",
            default: null,
            index: true,
        },

        payrollPayableId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PayrollPayable",
            default: null,
        },

        employeeAdvanceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmployeeAdvance",
            default: null,
        },

        salesOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalesOrder",
            default: null,
            index: true,
        },

        salesInvoiceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalesInvoice",
            default: null,
        },

        /** Legacy / generic reference */
        referenceType: {
            type: String,
            default: "",
            trim: true,
        },

        referenceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },

        allocations: {
            type: [allocationSchema],
            default: [],
        },

        // ── Money (canonical = amountMinor) ─────────────────
        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        exchangeRate: {
            type: Number,
            default: 1,
            min: 0,
        },

        /** Integer cents (USD V1). Source of truth. */
        amountMinor: {
            type: Number,
            required: true,
            min: 1,
        },

        paidAmountMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        dueAmountMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        discountAmountMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /**
         * Legacy major-unit mirrors for gradual migration / display.
         * Always derived from *Minor fields in services.
         */
        amount: {
            type: Number,
            required: true,
            min: 0,
        },

        paidAmount: {
            type: Number,
            default: 0,
            min: 0,
        },

        dueAmount: {
            type: Number,
            default: 0,
            min: 0,
        },

        discountAmount: {
            type: Number,
            default: 0,
            min: 0,
        },

        // ── Method vs Provider (separate concepts) ──────────
        paymentMethod: {
            type: String,
            enum: PAYMENT_METHODS,
            required: true,
            index: true,
        },

        paymentProvider: {
            type: String,
            enum: PAYMENT_PROVIDERS,
            default: "NONE",
            index: true,
        },

        /** External safe refs only — never PAN/CVV. */
        providerCustomerId: {
            type: String,
            default: "",
            trim: true,
        },

        providerPaymentIntentId: {
            type: String,
            default: "",
            trim: true,
        },

        providerTransactionId: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },

        paymentMethodReference: {
            type: String,
            default: "",
            trim: true,
        },

        transactionReference: {
            type: String,
            default: "",
            trim: true,
        },

        bankName: {
            type: String,
            default: "",
            trim: true,
        },

        accountReference: {
            type: String,
            default: "",
            trim: true,
        },

        checkNumber: {
            type: String,
            default: "",
            trim: true,
        },

        checkDate: {
            type: Date,
            default: null,
        },

        transactionDate: {
            type: Date,
            default: null,
        },

        // Optional chart-of-accounts hooks (not required in V1 ERP payouts)
        paymentAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            default: null,
        },

        cashBankAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            default: null,
        },

        // Future GL extension points
        journalId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Journal",
            default: null,
        },

        isJournalCreated: {
            type: Boolean,
            default: false,
        },

        ledgerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ledger",
            default: null,
        },

        isLedgerPosted: {
            type: Boolean,
            default: false,
        },

        // ── Workflow ────────────────────────────────────────
        status: {
            type: String,
            enum: PAYMENT_STATUSES,
            default: "draft",
            index: true,
        },

        requiresApproval: {
            type: Boolean,
            default: false,
            index: true,
        },

        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        approvedAt: {
            type: Date,
            default: null,
        },

        approvalNote: {
            type: String,
            default: "",
        },

        postedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        postedAt: {
            type: Date,
            default: null,
        },

        cancelledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        cancelledAt: {
            type: Date,
            default: null,
        },

        cancellationReason: {
            type: String,
            default: "",
        },

        failureReason: {
            type: String,
            default: "",
        },

        // Reversal (paid → reversed); original stays auditable
        originalPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
            index: true,
        },

        reversalPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },

        reversedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        reversedAt: {
            type: Date,
            default: null,
        },

        reversalReason: {
            type: String,
            default: "",
        },

        isReconciled: {
            type: Boolean,
            default: false,
        },

        reconciledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        reconciledAt: {
            type: Date,
            default: null,
        },

        note: {
            type: String,
            default: "",
            trim: true,
        },

        internalNote: {
            type: String,
            default: "",
            trim: true,
        },

        attachments: [
            {
                fileName: { type: String, default: "" },
                fileUrl: { type: String, default: "" },
                fileType: { type: String, default: "" },
                uploadedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "AdminUser",
                    default: null,
                },
                uploadedAt: { type: Date, default: Date.now },
            },
        ],

        sourceModule: {
            type: String,
            enum: ["Purchase", "Sales", "Expense", "HR", "Finance", "Manual"],
            default: "Finance",
        },

        isSystemGenerated: {
            type: Boolean,
            default: false,
        },

        isManualEntry: {
            type: Boolean,
            default: true,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        deletedAt: {
            type: Date,
            default: null,
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// ── Indexes ─────────────────────────────────────────────────
paymentSchema.index({ companyId: 1, paymentNumber: 1 }, { unique: true });
paymentSchema.index({ companyId: 1, paymentDate: -1 });
paymentSchema.index({ companyId: 1, status: 1 });
paymentSchema.index({ companyId: 1, partyType: 1, partyId: 1, paymentDate: -1 });
paymentSchema.index({ companyId: 1, purchaseOrderId: 1 });
paymentSchema.index({ companyId: 1, supplierPayableId: 1 });
paymentSchema.index({ companyId: 1, payrollId: 1 });
paymentSchema.index({ companyId: 1, paymentMethod: 1, paymentDate: -1 });
paymentSchema.index({ companyId: 1, requiresApproval: 1, status: 1 });
paymentSchema.index({ companyId: 1, createdBy: 1, createdAt: -1 });
// One Stripe PI maps to at most one payment document
paymentSchema.index(
    { providerPaymentIntentId: 1 },
    {
        unique: true,
        sparse: true,
        partialFilterExpression: {
            providerPaymentIntentId: { $type: "string", $gt: "" },
        },
    }
);
// One open salary payment per payroll line
paymentSchema.index(
    { companyId: 1, payrollId: 1, paymentType: 1 },
    {
        unique: true,
        partialFilterExpression: {
            paymentType: "EmployeeSalary",
            payrollId: { $type: "objectId" },
            originalPaymentId: null,
            isDeleted: { $ne: true },
            status: {
                $in: [
                    "draft",
                    "pendingApproval",
                    "approved",
                    "processing",
                    "paid",
                ],
            },
        },
    }
);
// One open advance disbursement per employee advance
paymentSchema.index(
    { companyId: 1, employeeAdvanceId: 1, paymentType: 1 },
    {
        unique: true,
        partialFilterExpression: {
            paymentType: "EmployeeAdvance",
            employeeAdvanceId: { $type: "objectId" },
            originalPaymentId: null,
            isDeleted: { $ne: true },
            status: {
                $in: [
                    "draft",
                    "pendingApproval",
                    "approved",
                    "processing",
                    "paid",
                ],
            },
        },
    }
);
// At most one open customer checkout per sales order
paymentSchema.index(
    { companyId: 1, salesOrderId: 1, paymentType: 1 },
    {
        unique: true,
        partialFilterExpression: {
            paymentType: "CustomerPayment",
            originalPaymentId: null,
            isDeleted: { $ne: true },
            status: {
                $in: ["draft", "pendingApproval", "approved", "processing"],
            },
        },
    }
);

paymentSchema.virtual("id").get(function () {
    return this._id.toHexString();
});

paymentSchema.set("toJSON", {
    virtuals: true,
});

paymentSchema.set("toObject", {
    virtuals: true,
});

module.exports = mongoose.model("Payment", paymentSchema);
