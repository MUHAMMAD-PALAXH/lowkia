const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");


// ==========================================================
// Sales Quotation Item Schema
// ==========================================================


const salesQuotationItemSchema = new mongoose.Schema(
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


    unitPrice:{

        type:Number,
        required:true,
        min:0
    },


    discount:{

        type:Number,
        default:0,
        min:0
    },


    tax:{

        type:Number,
        default:0,
        min:0
    },


    total:{

        type:Number,
        default:0,
        min:0
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
// Sales Quotation Schema
// ==========================================================


const salesQuotationSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ==========================================================
// Quotation Identity
// ==========================================================


quotationNumber:{

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


quotationDate:{

    type:Date,
    default:Date.now
},


validUntil:{

    type:Date,
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
// Shipping Information
// ==========================================================


shippingAddress:{

    type:String,
    default:""
},


billingAddress:{

    type:String,
    default:""
},


// ==========================================================
// Items
// ==========================================================


items:[
    salesQuotationItemSchema
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
// Sales Workflow Status
// ==========================================================


status:{

    type:String,
    enum:[
        "Draft",
        "Sent",
        "Accepted",
        "Rejected",
        "Expired",
        "Converted",
        "Cancelled"
    ],
    default:"Draft"
},


convertedToSalesOrder:{

    type:Boolean,
    default:false
},


salesOrderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesOrder",
    default:null
},


// ==========================================================
// Approval
// ==========================================================


requiresApproval:{

    type:Boolean,
    default:false
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


salesQuotationSchema.index({ customerId:1 });


salesQuotationSchema.index({ status:1 });


salesQuotationSchema.index({ quotationDate:-1 });


salesQuotationSchema.index({ salesOrderId:1 });


salesQuotationSchema.index({ isDeleted:1 });


// ==========================================================
// METHODS
// ==========================================================


salesQuotationSchema.methods.calculateTotal =
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


    return this.grandTotal;

};


salesQuotationSchema.methods.convertToOrder =
function(orderId)
{


    this.status="Converted";


    this.convertedToSalesOrder=true;


    this.salesOrderId=orderId;


    return this.save();

};

// ==========================================================
// STATIC METHODS
// ==========================================================


// All Quotations


salesQuotationSchema.statics.getAllQuotations =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        quotationDate:-1

    });

};


// Customer Quotations


salesQuotationSchema.statics.getCustomerQuotations =
function(customerId)
{


    return this.find({


        customerId,

        isDeleted:false

    })
    .sort({


        quotationDate:-1

    });

};


// Pending Quotations


salesQuotationSchema.statics.getPending =
function()
{


    return this.find({
        status:{

            $in:[
                "Draft",
                "Sent"
            ]
        },

        isDeleted:false

    });

};


// Expired Quotations


salesQuotationSchema.statics.getExpired =
function()
{


    return this.find({
        validUntil:{

            $lt:new Date()
        },


        status:{

            $ne:"Converted"
        },


        isDeleted:false


    });

};


// Monthly Report


salesQuotationSchema.statics.getMonthlyReport =
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
        quotationDate:{

            $gte:startDate,
            $lte:endDate
        },


        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


salesQuotationSchema.query.active =
function()
{


    return this.where({


        isDeleted:false

    });

};


salesQuotationSchema.query.converted =
function()
{


    return this.where({


        status:"Converted",

        isDeleted:false

    });

};


salesQuotationSchema.query.pending =
function()
{


    return this.where({


        status:{

            $in:[
                "Draft",
                "Sent"
            ]
        },


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


salesQuotationSchema.set(
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


salesQuotationSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
    "SalesQuotation",
    salesQuotationSchema
);