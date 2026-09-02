const mongoose = require("mongoose");
const { CART_STATUSES } = require("../../constants/marketplace");

/**
 * One active cart per marketplace User (global customer).
 * Platform-scoped — no companyId on the cart root.
 */
const cartSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        status: {
            type: String,
            enum: CART_STATUSES,
            default: "active",
            index: true,
        },
        currency: {
            type: String,
            default: "BDT",
            uppercase: true,
            trim: true,
        },
        itemCount: { type: Number, default: 0, min: 0 },
        checkedOutAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("MarketplaceCart", cartSchema);
