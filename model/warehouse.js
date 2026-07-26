const mongoose = require("mongoose");

const warehouseSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null
},

// Many-to-many: warehouse can serve multiple branches
branchIds:[
    {
        type:mongoose.Schema.Types.ObjectId,
        ref:"Branch"
    }
],


// ==========================================================
// Warehouse Identity
// ==========================================================

warehouseCode:{

    type:String,
    required:true,
    unique:true,
    trim:true
},


warehouseName:{

    type:String,
    required:true,
    trim:true
},


warehouseType:{

    type:String,
    enum:[
        "Main Warehouse",
        "Branch Warehouse",
        "Return Warehouse",
        "Damage Warehouse",
        "Transit Warehouse",
        "Production Warehouse"
    ],
    default:"Main Warehouse"
},


isDefault:{

    type:Boolean,
    default:false
},


parentWarehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    default:null
},


// ==========================================================
// Warehouse Manager
// ==========================================================

warehouseManagerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Employee"
},


// ==========================================================
// Contact Information
// ==========================================================

contactPhone:{

    type:String,
    default:""
},


contactEmail:{

    type:String,
    lowercase:true,
    default:""
},


// ==========================================================
// Address
// ==========================================================

country:{

    type:String,
    default:"Bangladesh"
},


city:{

    type:String,
    default:""
},


postalCode:{

    type:String,
    default:""
},


fullAddress:{

    type:String,
    required:true
},


latitude:{

    type:Number
},


longitude:{

    type:Number
},

// ==========================================================
// Capacity Information
// ==========================================================

capacity:{

    type:Number,
    default:0
},


capacityUnit:{

    type:String,
    enum:[
        "Piece",
        "Box",
        "Kg",
        "Ton",
        "Liter",
        "Pallet",
        "Container"
    ],
    default:"Piece"
},


currentUtilization:{

    type:Number,
    default:0
},


availableCapacity:{

    type:Number,
    default:0
},


// ==========================================================
// Warehouse Status
// ==========================================================

status:{

    type:String,
    enum:[
        "Active",
        "Inactive",
        "Maintenance",
        "Closed"
    ],
    default:"Active"
},


openingDate:{

    type:Date,
    default:Date.now
},


description:{

    type:String,
    default:""
},


// ==========================================================
// Inventory Summary
// ==========================================================

totalProducts:{

    type:Number,
    default:0
},


totalStockQuantity:{

    type:Number,
    default:0
},


totalStockValue:{

    type:Number,
    default:0
},


// ==========================================================
// Audit
// ==========================================================

createdBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


updatedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


deletedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


isDeleted:{

    type:Boolean,
    default:false
},


deletedAt:{

    type:Date
}

},
{

    timestamps:true,
    versionKey:false
});


// ==========================================================
// INDEXES
// ==========================================================

warehouseSchema.index({ warehouseCode:1 }, {

    unique:true
});


warehouseSchema.index({ branchId:1 });


warehouseSchema.index({ warehouseName:1 });


warehouseSchema.index({ status:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Update Capacity

warehouseSchema.methods.updateCapacity =
function(stockQuantity){


    this.currentUtilization = stockQuantity;

    this.availableCapacity =

        Math.max(
            this.capacity - stockQuantity,
            0
        );

    return this.save();

};


// Activate Warehouse

warehouseSchema.methods.activate =
function(){


    this.status = "Active";

    return this.save();

};


// Deactivate Warehouse

warehouseSchema.methods.deactivate =
function(){


    this.status = "Inactive";

    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All Warehouses

warehouseSchema.statics.getAllWarehouses =
function(){


    return this.find({
        isDeleted:false

    }).sort({


        warehouseName:1

    });

};


// Active Warehouses

warehouseSchema.statics.getActiveWarehouses =
function(){


    return this.find({
        status:"Active",

        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPER
// ==========================================================

warehouseSchema.query.active =
function(){


    return this.where({


        status:"Active",

        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================

warehouseSchema.set(
"toJSON",
{


    virtuals:true,

    transform:function(doc,ret){


        delete ret.__v;

        return ret;

    }

});


// ==========================================================
// EXPORT
// ==========================================================

module.exports = mongoose.model(
    "Warehouse",
    warehouseSchema
);

