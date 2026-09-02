const mongoose = require("mongoose");

/**
 * Saved shipping addresses for global marketplace User (not ERP Customer).
 */
const customerAddressSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        label: { type: String, default: "Home", trim: true },
        recipientName: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
        addressLine: { type: String, required: true, trim: true },
        area: { type: String, default: "", trim: true },
        city: { type: String, required: true, trim: true },
        district: { type: String, default: "", trim: true },
        postalCode: { type: String, default: "", trim: true },
        country: { type: String, default: "BD", trim: true, uppercase: true },
        deliveryInstructions: { type: String, default: "", trim: true },
        isDefault: { type: Boolean, default: false, index: true },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

customerAddressSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model("CustomerAddress", customerAddressSchema);
