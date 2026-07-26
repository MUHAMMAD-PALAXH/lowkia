const mongoose = require("mongoose");

// ==========================================================
// Sub Category Schema
// ==========================================================

const subCategorySchema = new mongoose.Schema(
{

    // Parent Category
    // ======================================================

    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
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

    image: {
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
    // Display
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
        trim: true,
        lowercase: true,
        default: ""
    },

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

    keywords: [{
        type: String,
        trim: true
    }],

    // ======================================================
    // Statistics
    // ======================================================

    totalBrands: {
        type: Number,
        default: 0
    },

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

subCategorySchema.index({ categoryId: 1,
        name: 1
     }, {
        unique: true
    });

subCategorySchema.index({ slug: 1 });

subCategorySchema.index({ status: 1 });

subCategorySchema.index({ categoryId: 1 });

subCategorySchema.index({ isFeatured: 1 });

subCategorySchema.index({ sortOrder: 1 });

subCategorySchema.index({ isDeleted: 1 });


// ==========================================================
// Virtual
// ==========================================================

subCategorySchema.virtual("id").get(function () {

    return this._id.toHexString();

});


// ==========================================================
// Hooks
// ==========================================================

subCategorySchema.pre("save", function (next) {

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

subCategorySchema.methods.softDelete = function (userId) {

    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    return this.save();

};


// ==========================================================
// Static Methods
// ==========================================================

subCategorySchema.statics.getActiveSubCategories = function(categoryId = null
) {

    const filter = {
        status: "Active",
        isDeleted: false
    };

    if (categoryId) {
        filter.categoryId = categoryId;
    }

    return this.find(filter)
        .sort({
            sortOrder: 1,
            name: 1
        });

};


// ==========================================================
// Query Helpers
// ==========================================================

subCategorySchema.query.active = function () {

    return this.where({

        status: "Active",

        isDeleted: false

    });

};


// ==========================================================
// JSON Transform
// ==========================================================

subCategorySchema.set("toJSON", {

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
    "SubCategory",
    subCategorySchema
);