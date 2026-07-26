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
        // Company Information
        // ======================================================

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true
        },

        // ======================================================
        // Category Information
        // ======================================================

        proCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true,
            index: true
        },

        proSubCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubCategory",
            required: true,
            index: true
        },

        proBrandId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            required: true,
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

        shortName: {
            type: String,
            default: "",
            trim: true,
            maxlength: 100
        },

        shortDescription: {
            type: String,
            default: "",
            maxlength: 500
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
        // Existing Compatibility
        // ======================================================

        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true
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
            default: "Approved"
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

// Product Code (Unique Per Company)
productSchema.index(
    {
        companyId: 1,
        productCode: 1
    },
    {
        unique: true
    }
);

// Product Name Search
productSchema.index({
    companyId: 1,
    name: 1
});

// Category Wise Products
productSchema.index({
    companyId: 1,
    proCategoryId: 1
});

// Sub Category Wise Products
productSchema.index({
    companyId: 1,
    proSubCategoryId: 1
});

// Brand Wise Products
productSchema.index({
    companyId: 1,
    proBrandId: 1
});

// Product Status
productSchema.index({
    companyId: 1,
    status: 1,
    isDeleted: 1
});

// Published Products
productSchema.index({
    companyId: 1,
    isPublished: 1,
    isDeleted: 1
});

// Featured Products
productSchema.index({
    companyId: 1,
    isFeatured: 1,
    isDeleted: 1
});

// Best Seller
productSchema.index({
    companyId: 1,
    isBestSeller: 1,
    isDeleted: 1
});

// New Arrival
productSchema.index({
    companyId: 1,
    isNewArrival: 1,
    isDeleted: 1
});

// Trending
productSchema.index({
    companyId: 1,
    isTrending: 1,
    isDeleted: 1
});

// Search Slug
productSchema.index({
    companyId: 1,
    slug: 1
});

// SKU
productSchema.index({
    companyId: 1,
    sku: 1
});

// Text Search
productSchema.index({
    name: "text",
    shortDescription: "text",
    description: "text"
});

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

// ==========================================================
// Static Methods
// ==========================================================

// Active Products
productSchema.statics.getActiveProducts = function (companyId) {
    return this.find({
        companyId,
        status: "Active",
        isDeleted: false
    });
};

// Published Products
productSchema.statics.getPublishedProducts = function (companyId) {
    return this.find({
        companyId,
        isPublished: true,
        status: "Active",
        isDeleted: false
    });
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