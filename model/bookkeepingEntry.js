const mongoose = require("mongoose");
const {
    BK_SOURCE_MODULES,
    BK_ACCOUNTS,
    BK_TRANSACTION_TYPES,
    BK_STATUSES,
} = require("../constants/bookkeeping");

/**
 * Central business ledger row. Written only by trusted backend posting logic.
 * Financial fields are immutable after insert — corrections are reversal rows.
 */

const effectSchema = new mongoose.Schema(
    {
        account: { type: String, enum: BK_ACCOUNTS, required: true },
        amount: { type: Number, required: true },
    },
    { _id: false }
);

const relatedDocumentSchema = new mongoose.Schema(
    {
        type: { type: String, required: true, trim: true },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        number: { type: String, default: "", trim: true },
    },
    { _id: false }
);

const IMMUTABLE_PATHS = [
    "companyId",
    "transactionType",
    "sourceId",
    "amount",
    "netAmount",
    "effects",
    "cashIn",
    "cashOut",
    "quantity",
    "transactionDate",
];

const bookkeepingEntrySchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
        },
        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
        },
        toBranchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
        },
        warehouseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null,
        },
        toWarehouseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null,
        },

        entryNumber: { type: String, required: true, trim: true },
        transactionDate: { type: Date, required: true },
        transactionType: {
            type: String,
            enum: BK_TRANSACTION_TYPES,
            required: true,
        },
        sourceModule: {
            type: String,
            enum: BK_SOURCE_MODULES,
            required: true,
        },
        sourceType: { type: String, required: true, trim: true },
        sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
        sourceNumber: { type: String, default: "", trim: true },
        relatedDocuments: { type: [relatedDocumentSchema], default: [] },
        description: { type: String, default: "", trim: true },

        partyType: {
            type: String,
            enum: ["Customer", "Supplier", "Employee", "Other", ""],
            default: "",
        },
        partyId: { type: mongoose.Schema.Types.ObjectId, default: null },
        partyName: { type: String, default: "", trim: true },

        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            default: null,
        },
        productName: { type: String, default: "", trim: true },
        sku: { type: String, default: "", trim: true },
        imeis: { type: [String], default: [] },
        quantity: { type: Number, default: 0 },
        unitAmount: { type: Number, default: 0 },

        /** Positive magnitude of this row (money, or stock value for info). */
        amount: { type: Number, required: true, min: 0 },
        /** Signed contribution toward its transactionType's running target. */
        netAmount: { type: Number, default: 0 },
        /** Primary lane shown in the Account column. */
        account: { type: String, enum: BK_ACCOUNTS, required: true },
        /** in = increases the primary lane, out = decreases it. */
        direction: {
            type: String,
            enum: ["in", "out", "none"],
            default: "none",
        },
        effects: { type: [effectSchema], default: [] },
        cashIn: { type: Number, default: 0, min: 0 },
        cashOut: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: "", uppercase: true, trim: true },

        paymentMethod: { type: String, default: "", trim: true },
        paymentProvider: { type: String, default: "", trim: true },
        paymentReference: { type: String, default: "", trim: true },

        status: { type: String, enum: BK_STATUSES, default: "completed" },
        isReversal: { type: Boolean, default: false },
        reversalOfId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BookkeepingEntry",
            default: null,
        },

        /** companyId-scoped idempotency key — one business event, one row. */
        idempotencyKey: { type: String, required: true, trim: true },
        searchText: { type: String, default: "", lowercase: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },

        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        createdByName: { type: String, default: "", trim: true },
        voidedAt: { type: Date, default: null },
        voidedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        voidReason: { type: String, default: "", trim: true },
    },
    { timestamps: true, versionKey: false }
);

bookkeepingEntrySchema.pre("save", function guardImmutable(next) {
    if (this.isNew) return next();
    const touched = IMMUTABLE_PATHS.filter((p) => this.isModified(p));
    if (touched.length) {
        return next(
            new Error(
                `Bookkeeping entry fields are immutable: ${touched.join(", ")}. Post a reversal instead.`
            )
        );
    }
    return next();
});

bookkeepingEntrySchema.index(
    { companyId: 1, idempotencyKey: 1 },
    { unique: true }
);
bookkeepingEntrySchema.index({ companyId: 1, transactionDate: -1, _id: -1 });
bookkeepingEntrySchema.index({ companyId: 1, sourceModule: 1, transactionDate: -1 });
bookkeepingEntrySchema.index({ companyId: 1, transactionType: 1, transactionDate: -1 });
bookkeepingEntrySchema.index({ companyId: 1, branchId: 1, transactionDate: -1 });
bookkeepingEntrySchema.index({ companyId: 1, paymentMethod: 1, transactionDate: -1 });
bookkeepingEntrySchema.index({ companyId: 1, sourceId: 1, transactionType: 1 });
bookkeepingEntrySchema.index({ companyId: 1, partyId: 1, transactionDate: -1 });
bookkeepingEntrySchema.index({ companyId: 1, entryNumber: 1 });
bookkeepingEntrySchema.index({ companyId: 1, imeis: 1 });

module.exports = mongoose.model("BookkeepingEntry", bookkeepingEntrySchema);
