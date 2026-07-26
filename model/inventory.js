const mongoose = require("mongoose");

// ==========================================================
// Inventory Schema
// ==========================================================

const inventorySchema = new mongoose.Schema(
{

        // Branch
        // ======================================================

        branchId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            required: true,
            index: true
        },

        // ======================================================
        // Warehouse
        // ======================================================

        warehouseId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            required: true,
            index: true
        },

        // ======================================================
        // Product
        // ======================================================

        productId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
            index: true
        },

        // ======================================================
        // Product Variant
        // ======================================================

        productVariantId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            default: null,
            index: true
        },

        // ======================================================
        // Stock Information
        // ======================================================

        currentStock: {

            type: Number,
            default: 0,
            min: 0
        },

        reservedStock: {

            type: Number,
            default: 0,
            min: 0
        },

        availableStock: {

            type: Number,
            default: 0,
            min: 0
        },

        // ======================================================
        // Inventory Costing
        // ======================================================

        averageCost: {

            type: Number,
            default: 0,
            min: 0
        },

        lastPurchasePrice: {

            type: Number,
            default: 0,
            min: 0
        },

        inventoryValue: {

            type: Number,
            default: 0,
            min: 0
        },

        // ======================================================
        // Stock Control
        // ======================================================

        reorderLevel: {

            type: Number,
            default: 0,
            min: 0
        },

        minimumStock: {

            type: Number,
            default: 0,
            min: 0
        },

        maximumStock: {

            type: Number,
            default: 0,
            min: 0
        },

        reorderQuantity: {

            type: Number,
            default: 0,
            min: 0
        },

        // ======================================================
        // Stock Status
        // ======================================================

        stockStatus: {

            type: String,
            enum: ["In Stock", "Low Stock", "Out Of Stock", "Over Stock"],
            default: "In Stock"
        },

        // ======================================================
        // Batch Information
        // ======================================================

        batchNumber: {

            type: String,
            default: "",
            trim: true
        },

        lotNumber: {

            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Manufacturing / Expiry
        // ======================================================

        manufacturingDate: {

            type: Date,
            default: null
        },

        expiryDate: {

            type: Date,
            default: null
        },

        // ======================================================
        // Warehouse Location
        // ======================================================

        rack: {

            type: String,
            default: "",
            trim: true
        },

        shelf: {

            type: String,
            default: "",
            trim: true
        },

        bin: {

            type: String,
            default: "",
            trim: true
        },

        locationCode: {

            type: String,
            default: "",
            trim: true,
            uppercase: true
        },

        // ======================================================
        // Last Stock Activity
        // ======================================================

        lastPurchaseDate: {

            type: Date,
            default: null
        },

        lastSaleDate: {

            type: Date,
            default: null
        },

        lastStockInDate: {

            type: Date,
            default: null
        },

        lastStockOutDate: {

            type: Date,
            default: null
        },

        lastMovementDate: {

            type: Date,
            default: null
        },

        // ======================================================
        // Last Transaction Reference
        // ======================================================

        lastGRN: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "GRN",
            default: null
        },

        lastPurchaseOrder: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseOrder",
            default: null
        },

        lastSalesInvoice: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "SalesInvoice",
            default: null
        },

        // ======================================================
        // Notes
        // ======================================================

        notes: {

            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Inventory Status
        // ======================================================

        status: {

            type: String,
            enum: ["Active", "Inactive", "Locked"],
            default: "Active"
        },

        isFrozen: {

            type: Boolean,
            default: false
        },

        freezeReason: {

            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Physical Stock Verification
        // ======================================================

        lastPhysicalCount: {

            type: Number,
            default: 0,
            min: 0
        },

        lastPhysicalCountDate: {

            type: Date,
            default: null
        },

        stockDifference: {

            type: Number,
            default: 0
        },

        cycleCountDueDate: {

            type: Date,
            default: null
        },

        // ======================================================
        // Audit Information
        // ======================================================

        createdBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        updatedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        // ======================================================
        // Soft Delete
        // ======================================================

        isDeleted: {

            type: Boolean,
            default: false
        },

        deletedAt: {

            type: Date,
            default: null
        },

        deletedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        }
    },
    {

        timestamps: true,
        versionKey: false
    }
);

// ==========================================================
// Database Indexes
// ==========================================================

// One Inventory Record Per Product Variant Per Warehouse
inventorySchema.index({ warehouseId: 1,
        productId: 1,
        productVariantId: 1
     }, {

        unique: true
    });

// Product Lookup
inventorySchema.index({ productId: 1,
    isDeleted: 1
 });

// Variant Lookup
inventorySchema.index({ productVariantId: 1,
    isDeleted: 1
 });

// Warehouse Lookup
inventorySchema.index({ warehouseId: 1,
    isDeleted: 1
 });

// Branch Lookup
inventorySchema.index({ branchId: 1,
    isDeleted: 1
 });

// Stock Status
inventorySchema.index({ stockStatus: 1,
    isDeleted: 1
 });

// Active Inventory
inventorySchema.index({ status: 1,
    isDeleted: 1
 });

// Expiry Tracking
inventorySchema.index({ expiryDate: 1 });

// Batch Tracking
inventorySchema.index({ batchNumber: 1 });

// Reorder Report
inventorySchema.index({ reorderLevel: 1 });

// Warehouse Location
inventorySchema.index({

    warehouseId: 1,
    rack: 1,
    shelf: 1,
    bin: 1
});

// Frozen Inventory
inventorySchema.index({ isFrozen: 1 });

// ==========================================================
// Virtual
// ==========================================================

inventorySchema.virtual("id").get(function () {

    return this._id.toHexString();
});

// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete
inventorySchema.methods.softDelete = function (adminId) {

    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = adminId;
    return this.save();
};

// Restore
inventorySchema.methods.restore = function () {

    this.isDeleted = false;
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
};

// Freeze Inventory
inventorySchema.methods.freeze = function (reason = "") {

    this.isFrozen = true;
    this.freezeReason = reason;
    this.status = "Locked";
    return this.save();
};

// Unfreeze Inventory
inventorySchema.methods.unfreeze = function () {

    this.isFrozen = false;
    this.freezeReason = "";
    this.status = "Active";
    return this.save();
};

// ==========================================================
// Static Methods
// ==========================================================

// Get Active Inventory
inventorySchema.statics.getActiveInventory = function() {

    return this.find({
        status: "Active",
        isDeleted: false
    });
};

// Get Low Stock
inventorySchema.statics.getLowStock = function() {

    return this.find({
        stockStatus: "Low Stock",
        isDeleted: false
    });
};

// Get Out Of Stock
inventorySchema.statics.getOutOfStock = function() {

    return this.find({
        stockStatus: "Out Of Stock",
        isDeleted: false
    });
};

// ==========================================================
// Query Helper
// ==========================================================

inventorySchema.query.active = function () {

    return this.where({

        status: "Active",
        isDeleted: false
    });
};

// ==========================================================
// JSON Transform
// ==========================================================

inventorySchema.set("toJSON", {

    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {

        delete ret._id;
        return ret;
    }
});

// ==========================================================
// Export
// ==========================================================

module.exports = mongoose.model("Inventory", inventorySchema);