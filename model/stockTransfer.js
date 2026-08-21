const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");


// ==========================================================
// Stock Transfer Item Schema
// ==========================================================


const stockTransferItemSchema = new mongoose.Schema(
{


    productId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
        required:true
    },


    productVariantId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"ProductVariant",
        default:null
    },


    sku:{

        type:String,
        default:"",
        trim:true
    },


    productName:{

        type:String,
        required:true,
        trim:true
    },


    quantity:{

        type:Number,
        required:true,
        min:1
    },


    unitId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Unit",
        default:null
    },


    unitCost:{

        type:Number,
        default:0
    },


    totalCost:{

        type:Number,
        default:0
    },


    batchNumber:{

        type:String,
        default:""
    },


    serialNumbers:[

        {

            type:String,
            trim:true
        }

    ],


    remarks:{

        type:String,
        default:""
    }


},
{

    _id:false
});


// ==========================================================
// Stock Transfer Schema
// ==========================================================


const stockTransferSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ==========================================================
// Transfer Identity
// ==========================================================


transferNumber:{

    type:String,
    required:true,
    unique:true,
    trim:true,
    uppercase:true
},


transferDate:{

    type:Date,
    default:Date.now
},


referenceNumber:{

    type:String,
    default:""
},


// ==========================================================
// Warehouse Information
// ==========================================================


fromWarehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    required:true,
    index:true
},


toWarehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    required:true,
    index:true
},


fromBranchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null
},


toBranchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null
},


// ==========================================================
// Transfer Items
// ==========================================================


items:[

    stockTransferItemSchema

],

// ==========================================================
// Transfer Information
// ==========================================================


transferType:{

    type:String,
    enum:[
        "Warehouse To Warehouse",
        "Branch To Branch",
        "Warehouse To Branch",
        "Branch To Warehouse"
    ],
    default:"Warehouse To Warehouse"
},


transferReason:{

    type:String,
    enum:[
        "Stock Rebalancing",
        "Branch Demand",
        "Warehouse Reallocation",
        "Damaged Relocation",
        "Production",
        "Return",
        "Other"
    ],
    default:"Stock Rebalancing"
},


description:{

    type:String,
    default:""
},


// ==========================================================
// Transfer Status
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Pending Approval",
        "Approved",
        "In Transit",
        "Completed",
        "Cancelled",
        "Rejected"
    ],
    default:"Draft"
},


requiresApproval:{

    type:Boolean,
    default:true
},


approvedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


approvedAt:{

    type:Date,
    default:null
},


rejectedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


rejectedAt:{

    type:Date,
    default:null
},


rejectionReason:{

    type:String,
    default:""
},


// ==========================================================
// Stock Movement Integration
// ==========================================================


outMovementId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"StockMovement",
    default:null
},


inMovementId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"StockMovement",
    default:null
},


isStockTransferred:{

    type:Boolean,
    default:false
},


transferredBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


transferredAt:{

    type:Date,
    default:null
},

// ==========================================================
// Delivery Information
// ==========================================================


dispatchDate:{

    type:Date,
    default:null
},


receivedDate:{

    type:Date,
    default:null
},


dispatchedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


receivedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


deliveryNote:{

    type:String,
    default:""
},


vehicleNumber:{

    type:String,
    default:""
},


driverName:{

    type:String,
    default:""
},


driverPhone:{

    type:String,
    default:""
},


// ==========================================================
// Location Tracking
// ==========================================================


fromLocation:{


    rack:{

        type:String,
        default:""
    },

    shelf:{

        type:String,
        default:""
    },

    bin:{

        type:String,
        default:""
    }

},


toLocation:{


    rack:{

        type:String,
        default:""
    },

    shelf:{

        type:String,
        default:""
    },

    bin:{

        type:String,
        default:""
    }

},


// ==========================================================
// Attachment
// ==========================================================


attachments:[

{


    fileName:{

        type:String,
        default:""
    },


    fileUrl:{

        type:String,
        default:""
    },


    fileType:{

        type:String,
        default:""
    },


    uploadedBy:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },


    uploadedAt:{

        type:Date,
        default:Date.now
    }

}

],


// ==========================================================
// Notes
// ==========================================================


note:{

    type:String,
    default:""
},


internalNote:{

    type:String,
    default:""
},

// ==========================================================
// Audit Information
// ==========================================================


createdBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    required:true
},


updatedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


cancelledBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


cancelledAt:{

    type:Date,
    default:null
},


// ==========================================================
// Soft Delete
// ==========================================================


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
},


},
{

    timestamps:true,
    versionKey:false
});


// ==========================================================
// DATABASE INDEXES


stockTransferSchema.index({


    fromWarehouseId:1,

    transferDate:-1

});


stockTransferSchema.index({


    toWarehouseId:1,

    transferDate:-1

});


stockTransferSchema.index({ status:1 });


stockTransferSchema.index({ transferType:1 });


stockTransferSchema.index({ outMovementId:1 });


stockTransferSchema.index({ inMovementId:1 });


stockTransferSchema.index({


    createdBy:1,

    createdAt:-1

});


stockTransferSchema.index({ isDeleted:1 });

// ==========================================================
// VIRTUAL FIELDS
// ==========================================================


stockTransferSchema.virtual("id")
.get(function(){


    return this._id.toHexString();

});


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Total Cost


stockTransferSchema.methods.calculateCost =
function(){


    this.items.forEach(item=>{


        item.totalCost =

        item.quantity *

        item.unitCost;


    });


    return this.items;

};


// Approve Transfer


stockTransferSchema.methods.approve =
function(userId){


    this.status="Approved";


    this.approvedBy=userId;


    this.approvedAt=new Date();


    return this.save();

};


// Reject Transfer


stockTransferSchema.methods.reject =
function(
    userId,
    reason
){


    this.status="Rejected";


    this.rejectedBy=userId;


    this.rejectedAt=new Date();


    this.rejectionReason=reason;


    return this.save();

};


// Complete Transfer


stockTransferSchema.methods.completeTransfer =
function(
    outMovementId,
    inMovementId,
    userId
){


    this.status="Completed";


    this.outMovementId=outMovementId;


    this.inMovementId=inMovementId;


    this.isStockTransferred=true;


    this.transferredBy=userId;


    this.transferredAt=new Date();


    return this.save();

};


// Cancel Transfer


stockTransferSchema.methods.cancel =
function(userId){


    this.status="Cancelled";


    this.cancelledBy=userId;


    this.cancelledAt=new Date();


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All Transfers


stockTransferSchema.statics.getAllTransfers =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        transferDate:-1

    });

};


// Warehouse Transfer History


stockTransferSchema.statics.getWarehouseTransfers =
function(warehouseId)
{


    return this.find({


        $or:[

            {

                fromWarehouseId:warehouseId
            },

            {

                toWarehouseId:warehouseId
            }

        ],


        isDeleted:false


    })
    .sort({


        transferDate:-1

    });

};


// ==========================================================
// STATIC METHODS (CONTINUED)
// ==========================================================


// Pending Approval Transfers


stockTransferSchema.statics.getPendingApproval =
function()
{


    return this.find({
        status:"Pending Approval",

        isDeleted:false

    })
    .sort({


        createdAt:-1

    });

};


// In Transit Transfers


stockTransferSchema.statics.getInTransit =
function()
{


    return this.find({
        status:"In Transit",

        isDeleted:false

    })
    .sort({


        transferDate:-1

    });

};


// Monthly Transfer Report


stockTransferSchema.statics.getMonthlyReport =
function(month,
    year
)
{


    const startDate =
    new Date(
        year,
        month-1,
        1
    );


    const endDate =
    new Date(
        year,
        month,
        0
    );


    return this.find({
        transferDate:{

            $gte:startDate,
            $lte:endDate
        },


        isDeleted:false


    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


stockTransferSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });

};


stockTransferSchema.query.pending =
function(){


    return this.where({


        status:"Pending Approval",

        isDeleted:false

    });

};


stockTransferSchema.query.completed =
function(){


    return this.where({


        status:"Completed",

        isDeleted:false

    });

};


stockTransferSchema.query.inTransit =
function(){


    return this.where({


        status:"In Transit",

        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


stockTransferSchema.set(
"toJSON",
{


    virtuals:true,

    versionKey:false,


    transform:function(
        doc,
        ret
    ){


        delete ret._id;

        return ret;

    }

});


// ==========================================================
// EXPORT
// ==========================================================


stockTransferSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
    "StockTransfer",
    stockTransferSchema
);