const mongoose = require("mongoose");
const {
    CHECKOUT_PAYMENT_STATUSES,
    CHECKOUT_PAYMENT_METHODS,
    CHECKOUT_PAYMENT_PROVIDERS,
    MARKETPLACE_CURRENCIES,
} = require("../../constants/marketplace");

/**
 * Gateway-independent customer payment for a MasterOrder (one payment per checkout).
 * Pattern aligned with SubscriptionPayment — separate from ERP Payment model.
 */
const checkoutPaymentSchema = new mongoose.Schema(
    {
        paymentNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        masterOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MasterOrder",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
        paymentMethod: {
            type: String,
            enum: CHECKOUT_PAYMENT_METHODS,
            required: true,
            index: true,
        },
        paymentProvider: {
            type: String,
            enum: CHECKOUT_PAYMENT_PROVIDERS,
            default: "manual",
            index: true,
        },
        status: {
            type: String,
            enum: CHECKOUT_PAYMENT_STATUSES,
            default: "pending",
            index: true,
        },
        idempotencyKey: {
            type: String,
            default: "",
            trim: true,
        },
        providerPaymentIntentId: { type: String, default: "", trim: true },
        providerTransactionId: { type: String, default: "", trim: true },
        providerCustomerId: { type: String, default: "", trim: true },
        providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
        paidAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
        failureReason: { type: String, default: "", trim: true },
        refundedAmount: { type: Number, default: 0, min: 0 },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

checkoutPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
checkoutPaymentSchema.index({ providerPaymentIntentId: 1 }, { sparse: true });
checkoutPaymentSchema.index({ status: 1, paidAt: -1 });
checkoutPaymentSchema.index({ masterOrderId: 1, status: 1 });
checkoutPaymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CheckoutPayment", checkoutPaymentSchema);
