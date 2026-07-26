const mongoose = require("mongoose");


// ==========================================================
// Sales Invoice Item Schema
// ==========================================================


const salesInvoiceItemSchema = new mongoose.Schema(
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


    costPrice:{

        type:Number,
        default:0
    },


    profit:{

        type:Number,
        default:0
    }


},
{

    _id:false
});


// ==========================================================
// Sales Invoice Schema
// ==========================================================


const salesInvoiceSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ==========================================================
// Invoice Identity
// ==========================================================


invoiceNumber:{

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


invoiceDate:{

    type:Date,
    default:Date.now
},


dueDate:{

    type:Date,
    default:null
},


// ==========================================================
// Sales Reference
// ==========================================================


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


customerEmail:{

    type:String,
    default:""
},


// ==========================================================
// Billing Information
// ==========================================================


billingAddress:{

    type:String,
    default:""
},


shippingAddress:{

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
// Invoice Items
// ==========================================================


items:[
    salesInvoiceItemSchema
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


tax:{

    type:Number,
    default:0
},


shippingCost:{

    type:Number,
    default:0
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
        "Unpaid",
        "Partial",
        "Paid",
        "Refunded"
    ],
    default:"Unpaid"
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
// Accounting Integration
// ==========================================================


accountTransactionId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AccountTransaction",
    default:null
},


customerLedgerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"CustomerLedger",
    default:null
},


// ==========================================================
// Stock Integration
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
// Invoice Status
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Confirmed",
        "Paid",
        "Partial Paid",
        "Cancelled"
    ],
    default:"Draft"
},


isPrinted:{

    type:Boolean,
    default:false
},


printedAt:{

    type:Date,
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
// Attachments
// ==========================================================


attachments:[

{


    fileName:String,

    fileUrl:String,

    fileType:String,

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
// DATABASE INDEXES
// ==========================================================


salesInvoiceSchema.index({ invoiceNumber:1 }, {

    unique:true
});


salesInvoiceSchema.index({ customerId:1 });


salesInvoiceSchema.index({ salesOrderId:1 });


salesInvoiceSchema.index({ deliveryId:1 });


salesInvoiceSchema.index({ warehouseId:1 });


salesInvoiceSchema.index({ paymentStatus:1 });


salesInvoiceSchema.index({ status:1 });


salesInvoiceSchema.index({ invoiceDate:-1 });


salesInvoiceSchema.index({ isDeleted:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Invoice


salesInvoiceSchema.methods.calculateTotal =
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


        item.profit =

        item.total -

        (

            item.costPrice *

            item.quantity

        );


        this.subtotal += item.total;

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


// Add Payment


salesInvoiceSchema.methods.addPayment =
function(amount)
{


    this.paidAmount += amount;


    this.dueAmount =

        this.grandTotal -

        this.paidAmount;


    if(this.dueAmount <= 0){


        this.paymentStatus = "Paid";

        this.status = "Paid";

    }

    else{


        this.paymentStatus = "Partial";

        this.status = "Partial Paid";

    }


    return this.save();

};


// Confirm Invoice


salesInvoiceSchema.methods.confirm =
function()
{


    this.status = "Confirmed";

    return this.save();

};


// Print Invoice


salesInvoiceSchema.methods.markPrinted =
function()
{


    this.isPrinted = true;

    this.printedAt = new Date();

    return this.save();

};


// Cancel Invoice


salesInvoiceSchema.methods.cancel =
function(userId)
{


    this.status = "Cancelled";

    this.cancelledBy = userId;

    this.cancelledAt = new Date();

    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All Invoices


salesInvoiceSchema.statics.getAllInvoices =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        invoiceDate:-1

    });

};


// Customer Invoices


salesInvoiceSchema.statics.getCustomerInvoices =
function(customerId)
{


    return this.find({


        customerId,

        isDeleted:false

    });

};


// Due Invoices


salesInvoiceSchema.statics.getDueInvoices =
function()
{


    return this.find({
        dueAmount:{

            $gt:0
        },


        isDeleted:false

    });

};


// Monthly Sales Report


salesInvoiceSchema.statics.getMonthlySales =
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
        invoiceDate:{

            $gte:startDate,
            $lte:endDate
        },


        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


salesInvoiceSchema.query.active =
function()
{


    return this.where({


        isDeleted:false

    });

};


salesInvoiceSchema.query.paid =
function()
{


    return this.where({


        paymentStatus:"Paid",

        isDeleted:false

    });

};


salesInvoiceSchema.query.unpaid =
function()
{


    return this.where({


        paymentStatus:{

            $ne:"Paid"
        },

        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


salesInvoiceSchema.set(
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
    "SalesInvoice",
    salesInvoiceSchema
);