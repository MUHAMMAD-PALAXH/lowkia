const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");
const baseModelPlugin = require("./plugins/baseModel.plugin");

/**
 * Per-unit barcode for Non-IMEI stock.
 * Product/variant shared EAN stays for catalog lookup; these rows track
 * individual sellable/sold units (unique EAN each).
 */
const productUnitBarcodeSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
            index: true,
        },
        productVariantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            default: null,
            index: true,
        },
        warehouseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null,
        },
        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
        },
        barcode: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ["available", "sold", "void"],
            default: "available",
            index: true,
        },
        sourceType: {
            type: String,
            enum: [
                "opening",
                "grn",
                "adjustment",
                "reconcile",
                "sale_backfill",
                "other",
            ],
            default: "other",
        },
        sourceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        soldInfo: {
            salesOrderId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "SalesOrder",
                default: null,
            },
            soldAt: { type: Date, default: null },
        },
    },
    { timestamps: true }
);

productUnitBarcodeSchema.index(
    { companyId: 1, barcode: 1 },
    {
        unique: true,
        partialFilterExpression: {
            barcode: { $type: "string", $gt: "" },
            isDeleted: { $ne: true },
        },
    }
);
productUnitBarcodeSchema.index({
    productId: 1,
    productVariantId: 1,
    status: 1,
    isDeleted: 1,
});

productUnitBarcodeSchema.plugin(tenantPlugin);
productUnitBarcodeSchema.plugin(baseModelPlugin);

module.exports = mongoose.model("ProductUnitBarcode", productUnitBarcodeSchema);
