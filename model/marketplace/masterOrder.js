const mongoose = require("mongoose");
const {
    MASTER_ORDER_STATUSES,
    CHECKOUT_PAYMENT_STATUSES,
    MARKETPLACE_CURRENCIES,
} = require("../../constants/marketplace");
const {
    addressSnapshotSchema,
    moneyTotalsSchema,
} = require("./sharedSchemas");

/**
 * Customer checkout root — one payment, may contain multiple CompanyOrders.
 * Platform-scoped (no companyId).
 */
const masterOrderSchema = new mongoose.Schema(
    {
        orderNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        status: {
            type: String,
            enum: MASTER_ORDER_STATUSES,
            default: "pending",
            index: true,
        },
        paymentStatus: {
            type: String,
            enum: CHECKOUT_PAYMENT_STATUSES,
            default: "pending",
            index: true,
        },
        currency: {
            type: String,
            default: "BDT",
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
        totals: { type: moneyTotalsSchema, required: true },
        companyOrderCount: { type: Number, default: 0, min: 0 },
        shippingAddress: { type: addressSnapshotSchema, required: true },
        customerNote: { type: String, default: "", trim: true },
        checkoutPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CheckoutPayment",
            default: null,
            index: true,
        },
        placedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        cancelReason: { type: String, default: "", trim: true },
        idempotencyKey: { type: String, default: "", trim: true },
        inventoryReservedAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

masterOrderSchema.index({ userId: 1, createdAt: -1 });
masterOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
masterOrderSchema.index({ status: 1, placedAt: -1 });
masterOrderSchema.index({ paymentStatus: 1, placedAt: -1 });
masterOrderSchema.index({ placedAt: -1 });

module.exports = mongoose.model("MasterOrder", masterOrderSchema);
