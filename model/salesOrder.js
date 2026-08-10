const mongoose = require("mongoose");


// ==========================================================
// Sales Order Item Schema
// ==========================================================


const salesOrderItemSchema = new mongoose.Schema(
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


    deliveredQuantity:{

        type:Number,
        default:0
    },


    pendingQuantity:{

        type:Number,
        default:0
    },


    returnedQuantity:{

        type:Number,
        default:0,
        min:0
    },


    unitId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Unit",
        default:null
    },


    unitPrice:{

        type:Number,
        required:true,
        min:0
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


    remarks:{

        type:String,
        default:""
    },


    trackingType:{

        type:String,
        enum:["IMEI","Non-IMEI"],
        default:"Non-IMEI"
    },

    /** Warehouse actually used for stock OUT (may differ from order header). */
    stockWarehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Warehouse",
        default: null,
    },

    imeis:{

        type:[String],
        default:[]
    },


    // Snapshot from product at sale (overridable per line)
    warrantyType:{

        type:String,
        enum:["No Warranty","Days","Months","Years","Lifetime"],
        default:"No Warranty"
    },


    warrantyPeriod:{

        type:Number,
        default:0,
        min:0
    },


    warrantyStartDate:{

        type:Date,
        default:null
    },


    warrantyEndDate:{

        type:Date,
        default:null
    },


    warrantyNote:{

        type:String,
        default:""
    }

},
{

    _id:false
});


// ==========================================================
// Sales Order Schema
// ==========================================================


const salesOrderSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:false,
    index:true
},


warehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    required:false,
    index:true
},

supplierId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Supplier",
    required:false,
    index:true
},

salesType:{
    type:String,
    enum:["Retail","Wholesale"],
    default:"Retail"
},


// ==========================================================
// Order Identity
// ==========================================================


orderNumber:{

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


orderDate:{

    type:Date,
    default:Date.now
},


expectedDeliveryDate:{

    type:Date
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


customerEmail:{

    type:String,
    default:""
},


// ==========================================================
// Quotation Reference
// ==========================================================


quotationId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesQuotation",
    default:null
},


// ==========================================================
// Items
// ==========================================================


items:[
    salesOrderItemSchema
],


// ==========================================================
// Pricing Summary
// ==========================================================


subtotal:{

    type:Number,
    default:0
},


discount:{

    type:Number,
    default:0
},


discountType:{

    type:String,
    enum:["Fixed","Percentage"],
    default:"Fixed"
},


tax:{

    type:Number,
    default:0
},


taxType:{

    type:String,
    enum:["Fixed","Percentage"],
    default:"Fixed"
},


shippingCost:{

    type:Number,
    default:0
},


shippingType:{

    type:String,
    enum:["Fixed","Percentage"],
    default:"Fixed"
},


otherCharges:{

    type:Number,
    default:0
},


grandTotal:{

    type:Number,
    default:0
},


// ==========================================================
// Payment Information
// ==========================================================


paymentStatus:{

    type:String,
    enum:[
        "Pending",
        "Partial",
        "Paid",
        "Refunded"
    ],
    default:"Pending"
},


paidAmount:{

    type:Number,
    default:0
},


dueAmount:{

    type:Number,
    default:0
},


paymentMethod:{

    type:String,
    enum:[
        "Cash",
        "Bank",
        "Card",
        "Mobile Banking",
        "Credit"
    ],
    default:"Cash"
},


// ==========================================================
// Delivery Information
// ==========================================================


deliveryStatus:{

    type:String,
    enum:[
        "Pending",
        "Processing",
        "Ready To Ship",
        "Shipped",
        "Delivered",
        "Cancelled"
    ],
    default:"Pending"
},


deliveryAddress:{

    type:String,
    default:""
},


deliveryDate:{

    type:Date,
    default:null
},


deliveredBy:{

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
// Sales Workflow
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Pending Approval",
        "Approved",
        "Confirmed",
        "Processing",
        "Completed",
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
// Inventory Integration
// ==========================================================


stockUpdated:{

    type:Boolean,
    default:false
},


stockUpdatedAt:{

    type:Date,
    default:null
},


stockMovementIds:[

    {

        type:mongoose.Schema.Types.ObjectId,
        ref:"StockMovement"
    }

],

// ==========================================================
// Invoice Integration
// ==========================================================


invoiceId:{

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
// Return Information
// ==========================================================


hasReturn:{

    type:Boolean,
    default:false
},


returnId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesReturn",
    default:null
},


// ==========================================================
// Sales Person
// ==========================================================


salesPersonId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
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


    uploadedAt:{

        type:Date,
        default:Date.now
    }

}

],


// ==========================================================
// Audit Information
// ==========================================================

companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    default: null,
    index: true,
},

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


salesOrderSchema.index({ orderNumber:1 }, {

    unique:true
});


salesOrderSchema.index({ customerId:1 });


salesOrderSchema.index({ quotationId:1 });


salesOrderSchema.index({ status:1 });


salesOrderSchema.index({ deliveryStatus:1 });


salesOrderSchema.index({ orderDate:-1 });


salesOrderSchema.index({ invoiceId:1 });


salesOrderSchema.index({ isDeleted:1 });

// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Order Total


salesOrderSchema.methods.calculateTotal =
function()
{


    this.subtotal = 0;


    this.items.forEach(item=>{


        item.total =

        (

            item.quantity *

            item.unitPrice

        )

        -

        item.discount

        +

        item.tax;


        this.subtotal += item.total;


        item.pendingQuantity =

        item.quantity -

        item.deliveredQuantity;


    });


    this.grandTotal =

        this.subtotal

        -

        this.discount

        +

        this.tax

        +

        this.shippingCost

        +

        this.otherCharges;


    this.dueAmount =

        this.grandTotal -

        this.paidAmount;


    return this.grandTotal;

};


// Approve Order


salesOrderSchema.methods.approve =
function(userId)
{


    this.status="Approved";


    this.approvedBy=userId;


    this.approvedAt=new Date();


    return this.save();

};


// Complete Delivery


salesOrderSchema.methods.completeDelivery =
function(userId)
{


    this.deliveryStatus="Delivered";


    this.status="Completed";


    this.deliveredBy=userId;


    this.deliveryDate=new Date();


    return this.save();

};


// Update Stock Status


salesOrderSchema.methods.updateStock =
function(movementIds)
{


    this.stockUpdated=true;


    this.stockMovementIds = movementIds;


    this.stockUpdatedAt=new Date();


    return this.save();

};


// Cancel Order


salesOrderSchema.methods.cancel =
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


// All Orders


salesOrderSchema.statics.getAllOrders =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        orderDate:-1

    });

};


// Customer Orders


salesOrderSchema.statics.getCustomerOrders =
function(customerId)
{


    return this.find({


        customerId,

        isDeleted:false

    })
    .sort({


        orderDate:-1

    });

};


// Pending Orders


salesOrderSchema.statics.getPendingOrders =
function()
{


    return this.find({
        status:{

            $in:[
                "Draft",
                "Pending Approval",
                "Approved"
            ]
        },


        isDeleted:false


    });

};


// Monthly Sales Report


salesOrderSchema.statics.getMonthlyReport =
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
        orderDate:{

            $gte:startDate,
            $lte:endDate
        },


        isDeleted:false


    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


salesOrderSchema.query.active =
function()
{


    return this.where({


        isDeleted:false

    });

};


salesOrderSchema.query.completed =
function()
{


    return this.where({


        status:"Completed",

        isDeleted:false

    });

};


salesOrderSchema.query.pendingDelivery =
function()
{


    return this.where({


        deliveryStatus:{

            $ne:"Delivered"
        },


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


salesOrderSchema.set(
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
    "SalesOrder",
    salesOrderSchema
);