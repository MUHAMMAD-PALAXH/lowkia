const mongoose = require("mongoose");

// ==========================================================
// Category Schema
// ==========================================================

const categorySchema = new mongoose.Schema(
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
    // Category Information
    // ======================================================

    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },

    image: {
        type: String,
        required: true,
        default: ""
    },

    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000
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

    totalProducts: {
        type: Number,
        default: 0
    },

    totalSubCategories: {
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

categorySchema.index({
    companyId: 1,
    name: 1
}, {
    unique: true
});

categorySchema.index({
    companyId: 1,
    slug: 1
});

categorySchema.index({
    companyId: 1,
    status: 1
});

categorySchema.index({
    companyId: 1,
    isFeatured: 1
});

categorySchema.index({
    companyId: 1,
    sortOrder: 1
});

categorySchema.index({
    companyId: 1,
    isDeleted: 1
});



// ==========================================================
// Virtual
// ==========================================================

categorySchema.virtual("id").get(function () {
    return this._id.toHexString();
});



// ==========================================================
// Hooks
// ==========================================================

categorySchema.pre("save", function (next) {

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

categorySchema.methods.softDelete = function (userId) {

    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    return this.save();

};



// ==========================================================
// Static Methods
// ==========================================================

categorySchema.statics.getActiveCategories = function (companyId) {

    return this.find({

        companyId,

        status: "Active",

        isDeleted: false

    }).sort({

        sortOrder: 1,

        name: 1

    });

};



// ==========================================================
// Query Helper
// ==========================================================

categorySchema.query.active = function () {

    return this.where({

        status: "Active",

        isDeleted: false

    });

};



// ==========================================================
// JSON Transform
// ==========================================================

categorySchema.set("toJSON", {

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
    "Category",
    categorySchema
);