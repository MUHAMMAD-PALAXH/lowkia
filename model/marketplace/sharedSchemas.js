const mongoose = require("mongoose");
const { MARKETPLACE_CURRENCIES } = require("../../constants/marketplace");

/** Immutable copy at checkout — never updated when user edits saved address. */
const addressSnapshotSchema = new mongoose.Schema(
    {
        recipientName: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
        addressLine: { type: String, required: true, trim: true },
        area: { type: String, default: "", trim: true },
        city: { type: String, required: true, trim: true },
        district: { type: String, default: "", trim: true },
        postalCode: { type: String, default: "", trim: true },
        country: { type: String, default: "BD", trim: true, uppercase: true },
        deliveryInstructions: { type: String, default: "", trim: true },
    },
    { _id: false }
);

/** Denormalized seller label for "Sold by: …" in cart and orders. */
const sellerSnapshotSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
        },
        companyCode: { type: String, default: "", trim: true, uppercase: true },
        legalName: { type: String, default: "", trim: true },
        tradeName: { type: String, default: "", trim: true },
        logoUrl: { type: String, default: "", trim: true },
    },
    { _id: false }
);

/** Product line snapshot at add-to-cart / checkout time. */
const productLineSnapshotSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
        },
        productVariantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            default: null,
        },
        productCode: { type: String, default: "", trim: true },
        productName: { type: String, required: true, trim: true },
        variantLabel: { type: String, default: "", trim: true },
        sku: { type: String, default: "", trim: true },
        imageUrl: { type: String, default: "", trim: true },
        unitPrice: { type: Number, required: true, min: 0 },
        currency: {
            type: String,
            default: "BDT",
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
    },
    { _id: false }
);

const moneyTotalsSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        shippingFee: { type: Number, default: 0, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        total: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

module.exports = {
    addressSnapshotSchema,
    sellerSnapshotSchema,
    productLineSnapshotSchema,
    moneyTotalsSchema,
};
