const mongoose = require("mongoose");

// ==========================================================
// Product Image Schema
// ==========================================================

const imageSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            required: true,
            trim: true
        },

        publicId: {
            type: String,
            default: ""
        },

        alt: {
            type: String,
            default: ""
        },

        isPrimary: {
            type: Boolean,
            default: false
        }
    },
    {
        _id: false
    }
);

// ==========================================================
// Product Schema
// ==========================================================

const productSchema = new mongoose.Schema(
{

                // ======================================================
        // Category Information
        // ======================================================

        proCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            default: null,
            index: true
        },

        proSubCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubCategory",
            default: null,
            index: true
        },

        proBrandId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            default: null,
            index: true
        },

        unitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Unit",
            default: null
        },

        // ======================================================
        // Product Identification
        // ======================================================

        productCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },

        sku: {
            type: String,
            default: "",
            trim: true,
            uppercase: true
        },

        slug: {
            type: String,
            default: "",
            trim: true,
            lowercase: true
        },

        // ======================================================
        // Basic Information
        // ======================================================

        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },

        description: {
            type: String,
            default: ""
        },

        // ======================================================
        // Product Type
        // ======================================================

        productType: {
            type: String,
            enum: ["Simple", "Variant", "Digital", "Service"],
            default: "Simple"
        },

        // ======================================================
        // ERP Tracking Type (IMEI vs Non IMEI)
        // ======================================================

        trackingType: {
            type: String,
            enum: ["IMEI", "Non-IMEI"],
            default: "Non-IMEI",
            index: true
        },

        hasVariants: {
            type: Boolean,
            default: false
        },

        // ======================================================
        // Existing Compatibility
        // ======================================================

        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        proVariantTypeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "VariantType",
            default: null
        },

        proVariantId: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Variant"
            }
        ],

        productVariants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "ProductVariant"
            }
        ],

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

        minimumSellingPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        maximumSellingPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        offerPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        discountType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Fixed"
        },

        discountValue: {
            type: Number,
            default: 0,
            min: 0
        },

        salesTaxType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Percentage"
        },

        salesTaxValue: {
            type: Number,
            default: 0,
            min: 0
        },

        otherCost: {
            type: Number,
            default: 0,
            min: 0
        },

        branchIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Branch"
            }
        ],

        warehouseIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Warehouse"
            }
        ],

        // ======================================================
        // Tax Information
        // ======================================================

        taxType: {
            type: String,
            enum: ["Inclusive", "Exclusive", "No Tax"],
            default: "No Tax"
        },

        taxPercentage: {
            type: Number,
            default: 0,
            min: 0
        },

        taxCode: {
            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Manufacturing Information
        // ======================================================

        manufacturer: {
            type: String,
            default: "",
            trim: true
        },

        countryOfOrigin: {
            type: String,
            default: "Bangladesh",
            trim: true
        },

        warrantyPeriod: {
            type: Number,
            default: 0
        },

        warrantyType: {
            type: String,
            enum: ["No Warranty", "Days", "Months", "Years", "Lifetime"],
            default: "No Warranty"
        },

        // ======================================================
        // Product Identification (Additional)
        // ======================================================

        hsnCode: {
            type: String,
            default: "",
            trim: true
        },

        barcode: {
            type: String,
            default: "",
            trim: true
        },

        // Auto generated barcodes are EAN-13 for Non IMEI products.
        // IMEI products are identified by their IMEI, not by barcode.
        barcodeType: {
            type: String,
            enum: ["EAN13", "Internal", "None"],
            default: "None"
        },

        barcodeGeneratedAt: {
            type: Date,
            default: null
        },

        qrCode: {
            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Media
        // ======================================================

        images: [imageSchema],

        thumbnail: {
            type: String,
            default: "",
            trim: true
        },

        videoUrl: {
            type: String,
            default: "",
            trim: true
        },

        brochure: {
            type: String,
            default: "",
            trim: true
        },

        // ======================================================
        // Search & Tags
        // ======================================================

        tags: [
            {
                type: String,
                trim: true,
                lowercase: true
            }
        ],

        searchKeywords: [
            {
                type: String,
                trim: true,
                lowercase: true
            }
        ],

        // ======================================================
        // Product Relationship
        // ======================================================

        relatedProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product"
            }
        ],

        crossSellProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product"
            }
        ],

        upSellProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product"
            }
        ],

        // ======================================================
        // Product Source / Ownership
        // ======================================================

        productSourceType: {
            type: String,
            enum: ["Manual", "PurchaseOrder", "ThirdParty"],
            default: "Manual",
            index: true
        },

        ownershipType: {
            type: String,
            enum: ["Owned", "ThirdParty"],
            default: "Owned",
            index: true
        },

        sourcePurchaseOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseOrder",
            default: null,
            index: true
        },

        sourcePurchaseOrderItemId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true
        },

        sourcePurchaseOrderNo: {
            type: String,
            default: "",
            trim: true
        },

        sourceSupplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null
        },

        // ======================================================
        // SEO
        // ======================================================

        metaTitle: {
            type: String,
            default: "",
            trim: true
        },

        metaDescription: {
            type: String,
            default: "",
            trim: true
        },

        metaKeywords: [
            {
                type: String,
                trim: true,
                lowercase: true
            }
        ],

        // ======================================================
        // Product Status
        // ======================================================

        status: {
            type: String,
            enum: ["Draft", "Active", "Inactive", "Archived"],
            default: "Draft",
            index: true
        },

        approvalStatus: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending",
            index: true
        },

        // ======================================================
        // Visibility
        // ======================================================

        visibility: {
            type: String,
            enum: ["Public", "Private", "Hidden"],
            default: "Public"
        },

        isPublished: {
            type: Boolean,
            default: false,
            index: true
        },

        publishedAt: {
            type: Date,
            default: null
        },

        // ======================================================
        // Product Flags
        // ======================================================

        isFeatured: {
            type: Boolean,
            default: false
        },

        isNewArrival: {
            type: Boolean,
            default: false
        },

        isBestSeller: {
            type: Boolean,
            default: false
        },

        isTrending: {
            type: Boolean,
            default: false
        },

        isRecommended: {
            type: Boolean,
            default: false
        },

        // ======================================================
        // Sales Configuration
        // ======================================================

        allowBackorder: {
            type: Boolean,
            default: false
        },

        isReturnable: {
            type: Boolean,
            default: true
        },

        returnDays: {
            type: Number,
            default: 7,
            min: 0
        },

        // ======================================================
        // Schedule
        // ======================================================

        publishStartDate: {
            type: Date,
            default: null
        },

        publishEndDate: {
            type: Date,
            default: null
        },

        // ======================================================
        // Statistics
        // ======================================================

        totalViews: {
            type: Number,
            default: 0
        },

        totalShares: {
            type: Number,
            default: 0
        },

        totalWishlist: {
            type: Number,
            default: 0
        },

        // ======================================================
        // Rating Summary
        // ======================================================

        averageRating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },

        totalReviews: {
            type: Number,
            default: 0
        },

        // ======================================================
        // Display Priority
        // ======================================================

        sortOrder: {
            type: Number,
            default: 0
        },

        // ======================================================
        // Mobile & Website
        // ======================================================

        showOnHomepage: {
            type: Boolean,
            default: false
        },

        showInMobileApp: {
            type: Boolean,
            default: true
        },

        showOnWebsite: {
            type: Boolean,
            default: true
        },

        // ======================================================
        // Extra Information
        // ======================================================

        notes: {
            type: String,
            default: ""
        },

        // ======================================================
        // Uploader Information (Owner / Employee / Vendor)
        // ======================================================

        uploadedByType: {
            type: String,
            enum: ["Owner", "Employee", "Vendor"],
            default: "Owner",
            index: true
        },

        uploadedByModel: {
            type: String,
            enum: ["AdminUser", "Employee", null],
            default: null
        },

        uploadedById: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "uploadedByModel",
            default: null
        },

        uploadedByName: {
            type: String,
            default: "",
            trim: true
        },

        uploadedAt: {
            type: Date,
            default: Date.now
        },

        // ======================================================
        // Approval Workflow
        // Owner uploads are auto approved.
        // Employee / Vendor uploads wait for Owner approval.
        // ======================================================

        approvalRequired: {
            type: Boolean,
            default: false
        },

        submittedForApprovalAt: {
            type: Date,
            default: null
        },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        approvedByName: {
            type: String,
            default: ""
        },

        approvedAt: {
            type: Date,
            default: null
        },

        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        rejectedByName: {
            type: String,
            default: ""
        },

        rejectedAt: {
            type: Date,
            default: null
        },

        rejectionReason: {
            type: String,
            default: ""
        },

        approvalHistory: [
            {
                action: {
                    type: String,
                    enum: ["Submitted", "Approved", "Rejected", "Resubmitted"]
                },
                actorType: {
                    type: String,
                    enum: ["Owner", "Employee", "Vendor", "System"],
                    default: "System"
                },
                actorId: {
                    type: mongoose.Schema.Types.ObjectId,
                    default: null
                },
                actorName: {
                    type: String,
                    default: ""
                },
                note: {
                    type: String,
                    default: ""
                },
                at: {
                    type: Date,
                    default: Date.now
                },
                _id: false
            }
        ],

        // ======================================================
        // Suppliers (a product can come from many suppliers)
        // ======================================================

        suppliers: [
            {
                supplierId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Supplier",
                    required: true
                },
                isPrimary: {
                    type: Boolean,
                    default: false
                },
                supplierSku: {
                    type: String,
                    default: "",
                    trim: true
                },
                lastPurchasePrice: {
                    type: Number,
                    default: 0,
                    min: 0
                },
                leadTimeDays: {
                    type: Number,
                    default: 0,
                    min: 0
                },
                notes: {
                    type: String,
                    default: ""
                },
                _id: false
            }
        ],

        primarySupplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null,
            index: true
        },

        // ======================================================
        // Stock Summary (READ ONLY)
        // Maintained by Inventory Service only. Never edit directly.
        // ======================================================

        totalStock: {
            type: Number,
            default: 0,
            min: 0
        },

        availableStock: {
            type: Number,
            default: 0,
            min: 0
        },

        reservedStock: {
            type: Number,
            default: 0,
            min: 0
        },

        damagedStock: {
            type: Number,
            default: 0,
            min: 0
        },

        inTransitStock: {
            type: Number,
            default: 0,
            min: 0
        },

        warehouseStock: [
            {
                warehouseId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Warehouse"
                },
                quantity: {
                    type: Number,
                    default: 0
                },
                availableQuantity: {
                    type: Number,
                    default: 0
                },
                reservedQuantity: {
                    type: Number,
                    default: 0
                },
                updatedAt: {
                    type: Date,
                    default: Date.now
                },
                _id: false
            }
        ],

        totalImeiCount: {
            type: Number,
            default: 0,
            min: 0
        },

        stockValue: {
            type: Number,
            default: 0,
            min: 0
        },

        lastStockUpdatedAt: {
            type: Date,
            default: null
        },

        // ======================================================
        // Reorder Configuration
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

        isLowStock: {
            type: Boolean,
            default: false,
            index: true
        },

        // ======================================================
        // Purchase & Profit Summary
        // ======================================================

        lastPurchasePrice: {
            type: Number,
            default: 0,
            min: 0
        },

        averagePurchasePrice: {
            type: Number,
            default: 0,
            min: 0
        },

        lastPurchaseDate: {
            type: Date,
            default: null
        },

        grossProfit: {
            type: Number,
            default: 0
        },

        profitMarginPercent: {
            type: Number,
            default: 0
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
        },

        // Snapshot taken on soft-delete so restore can put status/publish back.
        statusBeforeTrash: {
            type: String,
            enum: ["Draft", "Active", "Inactive", "Archived"],
            default: null
        },

        isPublishedBeforeTrash: {
            type: Boolean,
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

// Product Code (Unique)
productSchema.index({ productCode: 1 }, {
        unique: true
    });

// Product Name Search
productSchema.index({ name: 1 });

// Category Wise Products
productSchema.index({ proCategoryId: 1 });

// Sub Category Wise Products
productSchema.index({ proSubCategoryId: 1 });

// Brand Wise Products
productSchema.index({ proBrandId: 1 });

// Product Status
productSchema.index({ status: 1,
    isDeleted: 1
 });

// Published Products
productSchema.index({ isPublished: 1,
    isDeleted: 1
 });

// Featured Products
productSchema.index({ isFeatured: 1,
    isDeleted: 1
 });

// Best Seller
productSchema.index({ isBestSeller: 1,
    isDeleted: 1
 });

// New Arrival
productSchema.index({ isNewArrival: 1,
    isDeleted: 1
 });

// Trending
productSchema.index({ isTrending: 1,
    isDeleted: 1
 });

// Search Slug
productSchema.index({ slug: 1 });

// SKU
productSchema.index({ sku: 1 });

// Text Search
productSchema.index({
    name: "text",
    description: "text"
});

// Barcode must uniquely identify a product when present
productSchema.index(
    { barcode: 1 },
    {
        unique: true,
        partialFilterExpression: { barcode: { $type: "string", $gt: "" } }
    }
);

// Approval queue
productSchema.index({ approvalStatus: 1, isDeleted: 1 });

// Tracking type wise products (IMEI / Non-IMEI)
productSchema.index({ trackingType: 1, isDeleted: 1 });

// Supplier wise products (for restock contact)
productSchema.index({ "suppliers.supplierId": 1, isDeleted: 1 });

// One active product per completed PO line
productSchema.index(
    { sourcePurchaseOrderItemId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            isDeleted: false,
            sourcePurchaseOrderItemId: { $type: "objectId" }
        }
    }
);

// Low stock alerts
productSchema.index({ isLowStock: 1, isDeleted: 1 });

// ==========================================================
// Virtual
// ==========================================================

productSchema.virtual("id").get(function () {
    return this._id.toHexString();
});

// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete
productSchema.methods.softDelete = function (adminId) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = adminId;
    return this.save();
};

// Restore Product
productSchema.methods.restore = function () {
    this.isDeleted = false;
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
};

// Publish Product
productSchema.methods.publish = function () {
    this.isPublished = true;
    this.publishedAt = new Date();
    this.status = "Active";
    return this.save();
};

// Unpublish Product
productSchema.methods.unpublish = function () {
    this.isPublished = false;
    return this.save();
};

// Recompute gross profit / margin from current prices
productSchema.methods.recomputeProfit = function () {
    const selling = Number(this.sellingPrice) || 0;
    // Prefer explicit cost (landed); else purchase / last purchase.
    const unitCost =
        Number(this.costPrice) > 0
            ? Number(this.costPrice)
            : Number(this.purchasePrice) > 0
              ? Number(this.purchasePrice)
              : Number(this.lastPurchasePrice) || 0;
    const other = Number(this.otherCost) || 0;
    const cost = unitCost + other;

    this.grossProfit = Number((selling - cost).toFixed(2));
    this.profitMarginPercent =
        selling > 0
            ? Number((((selling - cost) / selling) * 100).toFixed(2))
            : 0;

    return this;
};

// Recompute low stock flag from stock summary
productSchema.methods.recomputeLowStock = function () {
    const available = Number(this.availableStock) || 0;
    const threshold = Number(this.reorderLevel) || Number(this.minimumStock) || 0;
    this.isLowStock = threshold > 0 && available <= threshold;
    return this;
};

// A product can only be sold / purchased after Owner approval
productSchema.methods.isUsable = function () {
    return (
        this.isDeleted !== true &&
        this.approvalStatus === "Approved" &&
        ["Active", "Draft"].includes(this.status)
    );
};

// ==========================================================
// Static Methods
// ==========================================================

// Active Products
productSchema.statics.getActiveProducts = function() {
    return this.find({
        status: "Active",
        isDeleted: false
    });
};

// Published Products
productSchema.statics.getPublishedProducts = function() {
    return this.find({
        isPublished: true,
        status: "Active",
        isDeleted: false
    });
};

// Products waiting for Owner approval
productSchema.statics.getPendingApprovals = function () {
    return this.find({
        approvalStatus: "Pending",
        isDeleted: { $ne: true }
    }).sort({ submittedForApprovalAt: 1, createdAt: 1 });
};

// Approved products usable in Purchase Order / Stock / Sale
productSchema.statics.getApprovedProducts = function () {
    return this.find({
        approvalStatus: "Approved",
        isDeleted: { $ne: true }
    }).sort({ name: 1 });
};

// Low stock products with supplier contact info
productSchema.statics.getLowStockProducts = function () {
    return this.find({
        isLowStock: true,
        approvalStatus: "Approved",
        isDeleted: { $ne: true }
    })
        .populate("primarySupplierId", "supplierCode name phone email")
        .sort({ availableStock: 1 });
};

// ==========================================================
// Query Helper
// ==========================================================

productSchema.query.active = function () {
    return this.where({
        status: "Active",
        isDeleted: false
    });
};

// ==========================================================
// JSON Transform
// ==========================================================

productSchema.set("toJSON", {
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

module.exports = mongoose.model("Product", productSchema);