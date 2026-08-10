const mongoose = require("mongoose");
const { DEFAULT_CURRENCY } = require("../config/finance");

/**
 * Hybrid supplier payable (one per Purchase Order).
 *
 * Tracks separately:
 * - PO commitment (exposure)
 * - Advance paid / unapplied
 * - GRN received value
 * - Payable due / paid against payable / outstanding
 *
 * Payment documents (Phase 3) update advance/paid counters;
 * GRN completion refreshes received value.
 */
const supplierPayableSchema = new mongoose.Schema(
    {
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

        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            required: true,
            index: true,
        },

        purchaseOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseOrder",
            required: true,
            index: true,
        },

        payableNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },

        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        // ── Hybrid money (minor units = cents) ───────────────
        /** PO grand total commitment */
        poCommitmentMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Sum of completed advance payments */
        advancePaidMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Advance automatically applied against received goods */
        advanceAppliedMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Advance still sitting as prepayment (not yet earned via GRN) */
        advanceUnappliedMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Σ received goods value (from PO.totalReceivedAmount / GRNs) */
        grnReceivedValueMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /**
         * Amount currently due for received goods after advance apply + payments:
         * max(0, grnReceived - advanceApplied - paidAgainstPayable)
         */
        payableDueMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Payments applied to payable (not advances) */
        paidAgainstPayableMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** = payableDueMinor (V1 hard-reject overpay keeps this ≥ 0) */
        outstandingMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /**
         * Remaining unreceived PO exposure net of unapplied advance:
         * max(0, (poCommitment - grnReceived) - advanceUnapplied)
         */
        remainingExposureMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** advancePaid + paidAgainstPayable */
        totalPaidMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        grnIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Grn",
            },
        ],

        status: {
            type: String,
            enum: ["open", "partial", "settled", "cancelled"],
            default: "open",
            index: true,
        },

        lastSyncedAt: {
            type: Date,
            default: null,
        },

        notes: {
            type: String,
            default: "",
            trim: true,
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
        versionKey: false,
    }
);

supplierPayableSchema.index(
    { companyId: 1, purchaseOrderId: 1 },
    { unique: true }
);
supplierPayableSchema.index({ companyId: 1, payableNumber: 1 }, { unique: true });
supplierPayableSchema.index({
    companyId: 1,
    supplierId: 1,
    status: 1,
    outstandingMinor: -1,
});
supplierPayableSchema.index({ companyId: 1, branchId: 1, status: 1 });

supplierPayableSchema.virtual("id").get(function () {
    return this._id.toHexString();
});

supplierPayableSchema.set("toJSON", { virtuals: true });
supplierPayableSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("SupplierPayable", supplierPayableSchema);
