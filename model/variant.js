const mongoose = require("mongoose");

// ==========================================================
// Variant Schema
// ==========================================================

const variantSchema = new mongoose.Schema(
{

    // Variant Type
    // ======================================================

    variantTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VariantType",
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

    code: {
        type: String,
        default: "",
        trim: true,
        uppercase: true
    },

    description: {
        type: String,
        default: "",
        trim: true
    },


    // ======================================================
    // Display
    // ======================================================

    colorCode: {
        type: String,
        default: ""
    },

    image: {
        type: String,
        default: ""
    },

    displayOrder: {
        type: Number,
        default: 0
    },

    status: {
        type: String,
        enum: [
            "Active",
            "Inactive"
        ],
        default: "Active"
    },


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
        default: false},

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

variantSchema.index({ variantTypeId: 1,
        name: 1
     }, {
        unique: true
    });

variantSchema.index({ code: 1 });

variantSchema.index({ status: 1 });

variantSchema.index({ displayOrder: 1 });

variantSchema.index({ isDeleted: 1 });


// ==========================================================
// Virtual
// ==========================================================

variantSchema.virtual("id").get(function () {

    return this._id.toHexString();

});


// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete

variantSchema.methods.softDelete = function (userId) {

    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    return this.save();

};


// Activate

variantSchema.methods.activate = function () {

    this.status = "Active";

    return this.save();

};


// Deactivate

variantSchema.methods.deactivate = function () {

    this.status = "Inactive";

    return this.save();

};


// ==========================================================
// Static Methods
// ==========================================================

// Get Active Variants

variantSchema.statics.getActiveVariants = function(variantTypeId = null
) {

    const filter = {
        status: "Active",
        isDeleted: false
    };

    if (variantTypeId) {
        filter.variantTypeId = variantTypeId;
    }

    return this.find(filter).sort({
        displayOrder: 1,
        name: 1
    });

};


// ==========================================================
// Query Helpers
// ==========================================================

variantSchema.query.active = function () {

    return this.where({
        status: "Active",
        isDeleted: false
    });

};


// ==========================================================
// JSON Transform
// ==========================================================

variantSchema.set("toJSON", {

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
    "Variant",
    variantSchema
);