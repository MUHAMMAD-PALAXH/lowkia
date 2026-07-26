const mongoose = require("mongoose");


// ==========================================================
// Delivery Item Schema
// ==========================================================


const deliveryItemSchema = new mongoose.Schema(
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


    orderedQuantity:{

        type:Number,
        default:0
    },


    deliveredQuantity:{

        type:Number,
        required:true,
        min:0
    },


    pendingQuantity:{

        type:Number,
        default:0
    },


    unitId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Unit",
        default:null
    },


    remarks:{

        type:String,
        default:""
    }

},
{

    _id:false
});


// ==========================================================
// Delivery Schema
// ==========================================================


const deliverySchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ==========================================================
// Delivery Identity
// ==========================================================


deliveryNumber:{

    type:String,
    required:true,
    unique:true,
    trim:true,
    uppercase:true
},


referenceNumber:{

    type:String,
    default:""
},


deliveryDate:{

    type:Date,
    default:Date.now
},


// ==========================================================
// Sales Reference
// ==========================================================


salesOrderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesOrder",
    required:true
},


customerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Customer",
    required:true
},


customerName:{

    type:String,
    required:true
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
// Items
// ==========================================================


items:[
    deliveryItemSchema
],


// ==========================================================
// Shipping Information
// ==========================================================


deliveryAddress:{

    type:String,
    default:""
},


shippingMethod:{

    type:String,
    enum:[
        "Own Delivery",
        "Courier",
        "Pickup",
        "Third Party"
    ],
    default:"Own Delivery"
},


courierName:{

    type:String,
    default:""
},


trackingNumber:{

    type:String,
    default:""
},


// ==========================================================
// Vehicle & Driver Information
// ==========================================================


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
// Delivery Status
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Ready",
        "Dispatched",
        "In Transit",
        "Delivered",
        "Failed",
        "Cancelled"
    ],
    default:"Draft",
    index:true
},


dispatchedAt:{

    type:Date,
    default:null
},


deliveredAt:{

    type:Date,
    default:null
},


failedReason:{

    type:String,
    default:""
},


// ==========================================================
// Receiver Information
// ==========================================================


receivedByName:{

    type:String,
    default:""
},


receiverPhone:{

    type:String,
    default:""
},


receiverSignature:{

    type:String,
    default:""
},


// ==========================================================
// Inventory Integration
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
// Invoice Integration
// ==========================================================


salesInvoiceId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesInvoice",
    default:null
},


isInvoiced:{

    type:Boolean,
    default:false
},


invoicedAt:{

    type:Date,
    default:null
},


// ==========================================================
// Notes
// ==========================================================


customerNote:{

    type:String,
    default:""
},


internalNote:{

    type:String,
    default:""
},


// ==========================================================
// Attachments
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


    uploadedAt:{

        type:Date,
        default:Date.now
    }

}

],


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
// INDEXES
// ==========================================================


deliverySchema.index({ deliveryNumber:1 }, {

    unique:true
});


deliverySchema.index({ salesOrderId:1 });


deliverySchema.index({ customerId:1 });


deliverySchema.index({ warehouseId:1 });


deliverySchema.index({ status:1 });


deliverySchema.index({ deliveryDate:-1 });


deliverySchema.index({ salesInvoiceId:1 });


deliverySchema.index({ isDeleted:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Pending Quantity


deliverySchema.methods.calculatePending =
function()
{


    this.items.forEach(item=>{


        item.pendingQuantity =

        item.orderedQuantity -

        item.deliveredQuantity;


    });


    return this.items;

};


// Dispatch Delivery


deliverySchema.methods.dispatch =
function()
{


    this.status="Dispatched";


    this.dispatchedAt=new Date();


    return this.save();

};


// Complete Delivery


deliverySchema.methods.complete =
function(receiverName)
{


    this.status="Delivered";


    this.receivedByName=receiverName;


    this.deliveredAt=new Date();


    return this.save();

};


// Update Stock


deliverySchema.methods.updateStock =
function(movementIds)
{


    this.stockMovementIds = movementIds;


    this.stockUpdated=true;


    this.stockUpdatedAt=new Date();


    return this.save();

};


// Cancel Delivery


deliverySchema.methods.cancel =
function(userId)
{


    this.status="Cancelled";


    this.cancelledBy=userId;


    this.cancelledAt=new Date();


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All Deliveries


deliverySchema.statics.getAllDeliveries =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        deliveryDate:-1

    });

};


// Customer Delivery History


deliverySchema.statics.getCustomerDeliveries =
function(customerId)
{


    return this.find({


        customerId,

        isDeleted:false

    })
    .sort({


        deliveryDate:-1

    });

};


// Pending Delivery


deliverySchema.statics.getPendingDelivery =
function()
{


    return this.find({
        status:{

            $in:[
                "Ready",
                "Dispatched",
                "In Transit"
            ]
        },


        isDeleted:false


    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


deliverySchema.query.active =
function()
{


    return this.where({


        isDeleted:false

    });

};


deliverySchema.query.completed =
function()
{


    return this.where({


        status:"Delivered",

        isDeleted:false

    });

};


deliverySchema.query.pending =
function()
{


    return this.where({


        status:{

            $ne:"Delivered"
        },


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


deliverySchema.set(
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
    "Delivery",
    deliverySchema
);