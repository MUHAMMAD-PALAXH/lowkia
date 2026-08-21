const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

// ==========================================================
// Unit Schema
// ==========================================================

const unitSchema = new mongoose.Schema(
{

    // Basic Information
    // ======================================================

    unitCode:{

        type:String,
        required:true,
        trim:true,
        uppercase:true
    },

    unitName:{

        type:String,
        required:true,
        trim:true,
        maxlength:100
    },

    shortName:{

        type:String,
        required:true,
        trim:true,
        uppercase:true,
        maxlength:20
    },

    description:{

        type:String,
        default:"",
        trim:true
    },


    // ======================================================
    // Unit Type
    // ======================================================

    unitType:{

        type:String,
        enum:[
            "Quantity",
            "Weight",
            "Length",
            "Area",
            "Volume",
            "Package",
            "Other"
        ],
        default:"Quantity"
    },


    // ======================================================
    // Conversion
    // ======================================================

    baseUnit:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Unit",
        default:null
    },

    conversionFactor:{

        type:Number,
        default:1,
        min:1
    },

    isBaseUnit:{

        type:Boolean,
        default:true
    },


    // ======================================================
    // Display
    // ======================================================

    sortOrder:{

        type:Number,
        default:0
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

    totalProducts:{

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
        default:false
    },

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

unitSchema.index({ unitCode: 1 }, {

        unique: true
    });

unitSchema.index({ unitName: 1 }, {

        unique: true
    });

unitSchema.index({ shortName: 1 });

unitSchema.index({ unitType: 1 });

unitSchema.index({ status: 1 });

unitSchema.index({ isBaseUnit: 1 });

unitSchema.index({ isDeleted: 1 });


// ==========================================================
// Virtual
// ==========================================================

unitSchema.virtual("id").get(function () {


    return this._id.toHexString();

});


// ==========================================================
// Instance Methods
// ==========================================================

// Soft Delete

unitSchema.methods.softDelete = function (userId) {


    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    return this.save();

};


// Activate

unitSchema.methods.activate = function () {


    this.status = "Active";

    return this.save();

};


// Deactivate

unitSchema.methods.deactivate = function () {


    this.status = "Inactive";

    return this.save();

};


// ==========================================================
// Static Methods
// ==========================================================

// Get Active Units

unitSchema.statics.getActiveUnits = function() {


    return this.find({
        status: "Active",

        isDeleted: false

    }).sort({


        unitType: 1,

        sortOrder: 1,

        unitName: 1

    });

};


// Get Base Units

unitSchema.statics.getBaseUnits = function() {


    return this.find({
        isBaseUnit: true,

        status: "Active",

        isDeleted: false

    }).sort({


        unitName: 1

    });

};


// ==========================================================
// Query Helpers
// ==========================================================

unitSchema.query.active = function () {


    return this.where({


        status: "Active",

        isDeleted: false

    });

};


// ==========================================================
// JSON Transform
// ==========================================================

unitSchema.set("toJSON", {


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

unitSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
    "Unit",
    unitSchema
);