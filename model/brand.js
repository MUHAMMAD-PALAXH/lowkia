const mongoose = require("mongoose");

// ==========================================================
// Brand Schema
// ==========================================================

const brandSchema = new mongoose.Schema(
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
    // Parent Sub Category
    // ======================================================

    subcategoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubCategory",
        required: true,
        index: true
    },

    // ======================================================
    // Basic Information
    // ======================================================

    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },

    logo: {
        type: String,
        default: ""
    },

    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000
    },

    // ======================================================
    // Manufacturer Information
    // ======================================================

    manufacturer: {
        type: String,
        default: ""
    },

    countryOfOrigin: {
        type: String,
        default: ""
    },

    website: {
        type: String,
        default: ""
    },

    supportEmail: {
        type: String,
        default: ""
    },

    supportPhone: {
        type: String,
        default: ""
    },

    // ======================================================
    // Display Settings
    // ======================================================

    sortOrder: {
        type: Number,
        default: 0
    },

    isFeatured: {
        type: Boolean,
        default: false
    },

    status: {
        type: String,
        enum: [
            "Active",
            "Inactive"
        ],
        default: "Active",
        index: true
    },

    // ======================================================
    // SEO
    // ======================================================

    slug: {
        type: String,
        default: "",
        trim: true,
        lowercase: true
    },

    metaTitle: {
        type: String,
        default: ""
    },

    metaDescription: {
        type: String,
        default: ""
    },

    keywords: [{
        type: String,
        trim: true
    }],

    // ======================================================
    // Statistics
    // ======================================================

    totalProducts: {
        type: Number,
        default: 0
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
});


// ==========================================================
// Indexes
// ==========================================================

brandSchema.index(
    {
        companyId: 1,
        subcategoryId: 1,
        name: 1
    },
    {
        unique: true
    }
);

brandSchema.index({
    companyId: 1,
    slug: 1
});

brandSchema.index({
    companyId: 1,
    status: 1
});

brandSchema.index({
    companyId: 1,
    subcategoryId: 1
});

brandSchema.index({
    companyId: 1,
    isFeatured: 1
});

brandSchema.index({
    companyId: 1,
    sortOrder: 1
});

brandSchema.index({
    companyId: 1,
    isDeleted: 1
});



// ==========================================================
// Virtual
// ==========================================================

brandSchema.virtual("id").get(function () {

    return this._id.toHexString();

});



// ==========================================================
// Hooks
// ==========================================================

// Auto Generate Slug

brandSchema.pre("save", function (next) {

    if (this.slug && this.slug.trim() !== "") {
        return next();
    }

    this.slug = this.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

    next();

});



// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete

brandSchema.methods.softDelete = function (userId) {

    this.isDeleted = true;

    this.deletedAt = new Date();

    this.deletedBy = userId;

    return this.save();

};


// Activate

brandSchema.methods.activate = function () {

    this.status = "Active";

    return this.save();

};


// Deactivate

brandSchema.methods.deactivate = function () {

    this.status = "Inactive";

    return this.save();

};



// ==========================================================
// Static Methods
// ==========================================================

// Get Active Brands

brandSchema.statics.getActiveBrands = function (
    companyId,
    subcategoryId = null
) {

    const filter = {

        companyId,

        status: "Active",

        isDeleted: false

    };

    if (subcategoryId) {

        filter.subcategoryId = subcategoryId;

    }

    return this.find(filter)
        .sort({

            sortOrder: 1,

            name: 1

        });

};


// Get Featured Brands

brandSchema.statics.getFeaturedBrands = function (
    companyId
) {

    return this.find({

        companyId,

        isFeatured: true,

        status: "Active",

        isDeleted: false

    }).sort({

        sortOrder: 1,

        name: 1

    });

};



// ==========================================================
// Query Helpers
// ==========================================================

brandSchema.query.active = function () {

    return this.where({

        status: "Active",

        isDeleted: false

    });

};



// ==========================================================
// JSON Transform
// ==========================================================

brandSchema.set("toJSON", {

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

module.exports = mongoose.model(
    "Brand",
    brandSchema
);