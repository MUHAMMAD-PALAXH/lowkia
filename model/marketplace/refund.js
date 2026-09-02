const mongoose = require("mongoose");
const {
    REFUND_STATUSES,
    REFUND_SCOPES,
    MARKETPLACE_CURRENCIES,
} = require("../../constants/marketplace");

/**
 * Refund against a CheckoutPayment — may target master, company order, or line item.
 */
const refundSchema = new mongoose.Schema(
    {
        refundNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        checkoutPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CheckoutPayment",
            required: true,
            index: true,
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
            index: true,
        },
        scope: {
            type: String,
            enum: REFUND_SCOPES,
            required: true,
            index: true,
        },
        companyOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanyOrder",
            default: null,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },
        orderItemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MarketplaceOrderItem",
            default: null,
            index: true,
        },
        amount: { type: Number, required: true, min: 0 },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
        status: {
            type: String,
            enum: REFUND_STATUSES,
            default: "pending",
            index: true,
        },
        reason: { type: String, default: "", trim: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        providerRefundId: { type: String, default: "", trim: true },
        processedAt: { type: Date, default: null },
        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

refundSchema.index({ checkoutPaymentId: 1, companyOrderId: 1 });
refundSchema.index({ companyId: 1, status: 1, createdAt: -1 });
refundSchema.index({ masterOrderId: 1, createdAt: -1 });

module.exports = mongoose.model("MarketplaceRefund", refundSchema);
