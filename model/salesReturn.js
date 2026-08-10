const mongoose = require("mongoose");


// ==========================================================
// Sales Return Item Schema
// ==========================================================


const salesReturnItemSchema = new mongoose.Schema(
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
        default:""
    },


    productName:{

        type:String,
        required:true
    },


    invoiceQuantity:{

        type:Number,
        default:0
    },


    returnQuantity:{

        type:Number,
        required:true,
        min:1
    },


    unitId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Unit",
        default:null
    },


    unitPrice:{

        type:Number,
        default:0
    },


    discount:{

        type:Number,
        default:0
    },


    tax:{

        type:Number,
        default:0
    },


    total:{

        type:Number,
        default:0
    },


    returnReason:{

        type:String,
        enum:[
            "Damaged",
            "Wrong Product",
            "Quality Issue",
            "Customer Changed Mind",
            "Other"
        ],
        default:"Other"
    },


    condition:{

        type:String,
        enum:[
            "Good",
            "Damaged",
            "Defective"
        ],
        default:"Good"
    },


    trackingType:{

        type:String,
        enum:["IMEI","Non-IMEI"],
        default:"Non-IMEI"
    },


    imeis:{

        type:[String],
        default:[]
    }


},
{

    _id:false
});


// ==========================================================
// Sales Return Schema
// ==========================================================


const salesReturnSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ==========================================================
// Return Identity
// ==========================================================


returnNumber:{

    type:String,
    required:true,
    unique:true,
    trim:true,
    uppercase:true
},


returnDate:{

    type:Date,
    default:Date.now
},


referenceNumber:{

    type:String,
    default:""
},


// ==========================================================
// Sales Reference
// ==========================================================


salesInvoiceId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesInvoice",
    default:null
},


salesOrderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesOrder",
    default:null
},


deliveryId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Delivery",
    default:null
},


// ==========================================================
// Customer Information
// ==========================================================


customerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Customer",
    required:true
},


customerName:{

    type:String,
    required:true
},


customerPhone:{

    type:String,
    default:""
},


// ==========================================================
// Warehouse
// ==========================================================


warehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    required:true
},


// ==========================================================
// Return Items
// ==========================================================


items:[
    salesReturnItemSchema
],


// ==========================================================
// Financial Information
// ==========================================================


subtotal:{

    type:Number,
    default:0
},


discount:{

    type:Number,
    default:0
},


tax:{

    type:Number,
    default:0
},


refundAmount:{

    type:Number,
    default:0
},


refundStatus:{

    type:String,
    enum:[
        "Pending",
        "Processed",
        "Completed",
        "Rejected"
    ],
    default:"Pending"
},


refundMethod:{

    type:String,
    enum:[
        "Cash",
        "Bank",
        "Card",
        "Mobile Banking",
        "Credit Adjustment"
    ],
    default:"Cash"
},


// ==========================================================
// Stock Return Information
// ==========================================================


stockMovementIds:[

{


    type:mongoose.Schema.Types.ObjectId,

    ref:"StockMovement"

}

],


stockUpdated:{

    type:Boolean,
    default:false
},


stockUpdatedAt:{

    type:Date,
    default:null
},


// ==========================================================
// Return Status
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Pending Approval",
        "Approved",
        "Received",
        "Refunded",
        "Rejected",
        "Cancelled"
    ],
    default:"Draft"
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


// ==========================================================
// Return Reason
// ==========================================================


returnReason:{

    type:String,
    default:""
},


customerNote:{

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
    default:null
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


deletedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


deletedAt:{

    type:Date,
    default:null
},


},
{

    timestamps:true,
    versionKey:false
});


// ==========================================================
// INDEXES


salesReturnSchema.index({ salesInvoiceId:1 });


salesReturnSchema.index({ customerId:1 });


salesReturnSchema.index({ warehouseId:1 });


salesReturnSchema.index({ status:1 });


salesReturnSchema.index({ returnDate:-1 });


salesReturnSchema.index({ isDeleted:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Return Total


salesReturnSchema.methods.calculateTotal =
function()
{


    this.subtotal = 0;


    this.items.forEach(item=>{


        item.total =

        (

            item.returnQuantity *

            item.unitPrice

        )

        -

        item.discount

        +

        item.tax;


        this.subtotal += item.total;


    });


    this.refundAmount =

        this.subtotal -

        this.discount;


    return this.refundAmount;

};


// Approve Return


salesReturnSchema.methods.approve =
function(userId)
{


    this.status="Approved";


    this.approvedBy=userId;


    this.approvedAt=new Date();


    return this.save();

};


// Receive Returned Product


salesReturnSchema.methods.receive =
function()
{


    this.status="Received";


    return this.save();

};


// Update Stock


salesReturnSchema.methods.updateStock =
function(movementIds)
{


    this.stockMovementIds = movementIds;


    this.stockUpdated=true;


    this.stockUpdatedAt=new Date();


    return this.save();

};


// Process Refund


salesReturnSchema.methods.processRefund =
function()
{


    this.status="Refunded";


    this.refundStatus="Completed";


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All Returns


salesReturnSchema.statics.getAllReturns =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        returnDate:-1

    });

};


// Customer Return History


salesReturnSchema.statics.getCustomerReturns =
function(customerId)
{


    return this.find({


        customerId,

        isDeleted:false

    });

};


// Pending Returns


salesReturnSchema.statics.getPendingReturns =
function()
{


    return this.find({
        status:{

            $in:[
                "Draft",
                "Pending Approval"
            ]
        },


        isDeleted:false

    });

};


// Monthly Return Report


salesReturnSchema.statics.getMonthlyReport =
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
        returnDate:{

            $gte:startDate,
            $lte:endDate
        },


        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


salesReturnSchema.query.active =
function()
{


    return this.where({


        isDeleted:false

    });

};


salesReturnSchema.query.completed =
function()
{


    return this.where({


        status:"Refunded",

        isDeleted:false

    });

};


salesReturnSchema.query.pending =
function()
{


    return this.where({


        status:{

            $in:[
                "Draft",
                "Pending Approval"
            ]
        },


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


salesReturnSchema.set(
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


module.exports = mongoose.model(
    "SalesReturn",
    salesReturnSchema
);