const mongoose = require("mongoose");

// ==========================================================
// Product Variant Attribute Schema
// ==========================================================

const attributeSchema = new mongoose.Schema(
    {
        variantTypeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "VariantType",
            required: true
        },

        variantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Variant",
            required: true
        }
    },
    {
        _id: false
    }
);

// ==========================================================
// Product Variant Schema
// ==========================================================

const productVariantSchema = new mongoose.Schema(
    {
        // ======================================================
        // Company
        // ======================================================

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
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
        // Variant Attributes
        // ======================================================

        attributes: [attributeSchema],

        // ======================================================
        // Identification
        // ======================================================

        sku: {
            type: String,
            trim: true,
            uppercase: true
        },

        barcode: {
            type: String,
            trim: true,
            default: ""
        },

        qrCode: {
            type: String,
            default: ""
        },

        // ======================================================
        // Pricing
        // ======================================================

        purchasePrice: {
            type: Number,
            default: 0,
            min: 0
        },

        costPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        sellingPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        wholesalePrice: {
            type: Number,
            default: 0,
            min: 0
        },

        // ======================================================
        // Backward Compatibility
        // ======================================================

        price: {
            type: Number,
            default: 0
        },

        offerPrice: {
            type: Number,
            default: 0
        },

        quantity: {
            type: Number,
            default: 0
        },

        tax: {
            type: Number,
            default: 0
        },

        // ======================================================
        // Unit Information
        // ======================================================

        unitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Unit",
            default: null
        },

        // ======================================================
        // Inventory Configuration
        // ======================================================

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

        reorderLevel: {
            type: Number,
            default: 0,
            min: 0
        },

        reorderQuantity: {
            type: Number,
            default: 0,
            min: 0
        },

        allowBackorder: {
            type: Boolean,
            default: false
        },

        trackInventory: {
            type: Boolean,
            default: true
        },

        // ======================================================
        // Physical Information
        // ======================================================

        weight: {
            type: Number,
            default: 0
        },

        weightUnit: {
            type: String,
            enum: ["mg", "g", "kg", "ton"],
            default: "kg"
        },

        length: {
            type: Number,
            default: 0
        },

        width: {
            type: Number,
            default: 0
        },

        height: {
            type: Number,
            default: 0
        },

        dimensionUnit: {
            type: String,
            enum: ["mm", "cm", "m", "inch", "ft"],
            default: "cm"
        },

        // ======================================================
        // Images
        // ======================================================

        images: [
            {
                url: {
                    type: String,
                    default: ""
                },

                publicId: {
                    type: String,
                    default: ""
                },

                isPrimary: {
                    type: Boolean,
                    default: false
                }
            }
        ],

        // ======================================================
        // Availability
        // ======================================================

        status: {
            type: String,
            enum: ["Active", "Inactive", "Out of Stock", "Discontinued"],
            default: "Active"
        },

        isDefaultVariant: {
            type: Boolean,
            default: false
        },

        isFeatured: {
            type: Boolean,
            default: false
        },

        // ======================================================
        // Audit
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
            default: false,
            index: true
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
// Indexes
// ==========================================================

// One SKU per company
productVariantSchema.index(
    {
        companyId: 1,
        sku: 1
    },
    {
        unique: true,
        sparse: true
    }
);

// One Barcode per company
productVariantSchema.index(
    {
        companyId: 1,
        barcode: 1
    },
    {
        unique: true,
        sparse: true
    }
);

// Prevent duplicate variant combinations
productVariantSchema.index(
    {
        companyId: 1,
        productId: 1,
        attributes: 1
    },
    {
        unique: true
    }
);

// Product Wise
productVariantSchema.index({
    companyId: 1,
    productId: 1
});

// Status
productVariantSchema.index({
    companyId: 1,
    status: 1
});

// Default Variant
productVariantSchema.index({
    companyId: 1,
    isDefaultVariant: 1
});

// Featured Variant
productVariantSchema.index({
    companyId: 1,
    isFeatured: 1
});

// Inventory Tracking
productVariantSchema.index({
    companyId: 1,
    trackInventory: 1
});

// Soft Delete
productVariantSchema.index({
    companyId: 1,
    isDeleted: 1
});

// ==========================================================
// Virtual
// ==========================================================

productVariantSchema.virtual("id").get(function () {
    return this._id.toHexString();
});

// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete
productVariantSchema.methods.softDelete = function (userId) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;
    return this.save();
};

// Activate
productVariantSchema.methods.activate = function () {
    this.status = "Active";
    return this.save();
};

// Deactivate
productVariantSchema.methods.deactivate = function () {
    this.status = "Inactive";
    return this.save();
};

// ==========================================================
// Static Methods
// ==========================================================

// Get Active Variants
productVariantSchema.statics.getActiveVariants = function (companyId, productId = null) {
    const filter = {
        companyId,
        status: "Active",
        isDeleted: false
    };

    if (productId) {
        filter.productId = productId;
    }

    return this.find(filter)
        .populate("attributes.variantTypeId", "name")
        .populate("attributes.variantId", "name")
        .sort({
            isDefaultVariant: -1,
            sellingPrice: 1
        });
};

// Get Default Variant
productVariantSchema.statics.getDefaultVariant = function (companyId, productId) {
    return this.findOne({
        companyId,
        productId,
        isDefaultVariant: true,
        isDeleted: false
    });
};

// ==========================================================
// Query Helpers
// ==========================================================

productVariantSchema.query.active = function () {
    return this.where({
        status: "Active",
        isDeleted: false
    });
};

// ==========================================================
// JSON Transform
// ==========================================================

productVariantSchema.set("toJSON", {
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

module.exports = mongoose.model("ProductVariant", productVariantSchema);