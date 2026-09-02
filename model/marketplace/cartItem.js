const mongoose = require("mongoose");
const {
    sellerSnapshotSchema,
    productLineSnapshotSchema,
} = require("./sharedSchemas");

/**
 * Cart line — companyId is denormalized from Product at write time (never from client).
 */
const cartItemSchema = new mongoose.Schema(
    {
        cartId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MarketplaceCart",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        seller: { type: sellerSnapshotSchema, required: true },
        product: { type: productLineSnapshotSchema, required: true },
        quantity: { type: Number, required: true, min: 1 },
        lineSubtotal: { type: Number, required: true, min: 0 },
        /** `${productId}:${variantId||'base'}` — unique line identity within cart */
        lineKey: { type: String, required: true, trim: true },
        isAvailable: { type: Boolean, default: true },
        unavailableReason: { type: String, default: "", trim: true },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

cartItemSchema.index(
    { cartId: 1, lineKey: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
);

cartItemSchema.index({ cartId: 1, companyId: 1 });

module.exports = mongoose.model("MarketplaceCartItem", cartItemSchema);
