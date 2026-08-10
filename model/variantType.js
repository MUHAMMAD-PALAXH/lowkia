const mongoose = require("mongoose");

// ==========================================================
// Variant Type Schema
// ==========================================================

const variantTypeSchema = new mongoose.Schema(
{

    // Basic Information
    // ======================================================

    name:{
        type:String,
        required:true,
        trim:true,
        maxlength:100
    },

    // Existing field (Backward Compatible)
    type:{
        type:String,
        required:true,
        trim:true,
        maxlength:50
    },

    description:{
        type:String,
        default:"",
        trim:true
    },


    // ======================================================
    // Display
    // ======================================================

    displayOrder:{
        type:Number,
        default:0
    },

    isRequired:{
        type:Boolean,
        default:false
    },

    isFilterable:{
        type:Boolean,
        default:true
    },

    isVariation:{
        type:Boolean,
        default:true
    },

    status:{
        type:String,
        enum:[
            "Active",
            "Inactive"
        ],
        default:"Active"
    },


    // ======================================================
    // Statistics
    // ======================================================

    totalVariants:{
        type:Number,
        default:0
    },


    // ======================================================
    // Audit
    // ======================================================

    createdBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },

    updatedBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },


    // ======================================================
    // Soft Delete
    // ======================================================

    isDeleted:{
        type:Boolean,
        default:false},

    deletedAt:{
        type:Date,
        default:null
    },

    deletedBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    }

},
{
    timestamps:true,
    versionKey:false
});

// ==========================================================
// Indexes
// ==========================================================

variantTypeSchema.index({ name: 1 }, {
        unique: true
    });

variantTypeSchema.index({ type: 1 });

variantTypeSchema.index({ status: 1 });

variantTypeSchema.index({ isVariation: 1 });

variantTypeSchema.index({ isFilterable: 1 });

variantTypeSchema.index({ isDeleted: 1 });


// ==========================================================
// Virtual
// ==========================================================

variantTypeSchema.virtual("id").get(function () {

    return this._id.toHexString();

});


// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete

variantTypeSchema.methods.softDelete = function (userId) {

    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    return this.save();

};


// Activate

variantTypeSchema.methods.activate = function () {

    this.status = "Active";

    return this.save();

};


// Deactivate

variantTypeSchema.methods.deactivate = function () {

    this.status = "Inactive";

    return this.save();

};


// ==========================================================
// Static Methods
// ==========================================================

// Active Variant Types

variantTypeSchema.statics.getActiveVariantTypes = function() {

    return this.find({
        status: "Active",

        isDeleted: false

    }).sort({

        displayOrder: 1,

        name: 1

    });

};


// ==========================================================
// Query Helpers
// ==========================================================

variantTypeSchema.query.active = function () {

    return this.where({

        status: "Active",

        isDeleted: false

    });

};


// ==========================================================
// JSON Transform
// ==========================================================

variantTypeSchema.set("toJSON", {

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
    "VariantType",
    variantTypeSchema
);