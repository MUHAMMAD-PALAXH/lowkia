const mongoose = require("mongoose");


// ==========================================================
// GRN Item Schema
// ==========================================================

const grnItemSchema = new mongoose.Schema(
{


    purchaseOrderItemId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },

    productId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
        default: null
    },

    productVariantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ProductVariant",
        default: null
    },

    trackingType: {
        type: String,
        enum: ["IMEI", "Non-IMEI"],
        default: "Non-IMEI"
    },


    sku:{

        type:String,
        default:""
    },

    barcode: {
        type: String,
        default: ""
    },


    productName:{

        type:String,
        required:true
    },

    variantLabel: {
        type: String,
        default: ""
    },


    orderedQuantity:{

        type:Number,
        required:true
    },


    receivedQuantity:{

        type:Number,
        required:true,
        min: 0
    },


    damagedQuantity:{

        type:Number,
        default:0
    },


    acceptedQuantity:{

        type:Number,
        default:0
    },


    rejectedQuantity:{

        type:Number,
        default:0
    },


    purchasePrice:{

        type:Number,
        required:true
    },


    total:{

        type:Number,
        default:0
    },

    // IMEI list for this receive line (scanned or bulk)
    imeis: {
        type: [String],
        default: []
    },


    remarks:{

        type:String,
        default:""
    }

},
{

    _id:true
});


// ==========================================================
// GRN Schema
// ==========================================================

const grnSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default: null,
    index: true
},


// ==========================================================
// Document
// ==========================================================

grnNumber:{

    type:String,
    required:true,
    unique:true
},


referenceNumber:{

    type:String,
    default:""
},


// ==========================================================
// Purchase Reference
// ==========================================================

purchaseOrderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"PurchaseOrder",
    required:true
},


supplierId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Supplier",
    default: null,
    index: true
},


warehouseId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Warehouse",
    required:true
},


// ==========================================================
// Dates
// ==========================================================

receivedDate:{

    type:Date,
    default:Date.now
},


invoiceDate:{

    type:Date
},


supplierInvoiceNo:{

    type:String,
    default:""
},


// ==========================================================
// Items
// ==========================================================

items:[
    grnItemSchema
],

// ==========================================================
// Summary
// ==========================================================

subtotal:{

    type:Number,
    default:0
},


totalDamagedQuantity:{

    type:Number,
    default:0
},


totalAcceptedQuantity:{

    type:Number,
    default:0
},


grandTotal:{

    type:Number,
    default:0
},


// ==========================================================
// Quality Inspection
// ==========================================================

qualityInspectionRequired:{

    type:Boolean,
    default:false
},


qualityStatus:{

    type:String,
    enum:[
        "Pending",
        "Passed",
        "Failed",
        "Partially Passed"
    ],
    default:"Pending"
},


qualityCheckedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


qualityCheckedAt:{

    type:Date
},


qualityRemarks:{

    type:String,
    default:""
},


// ==========================================================
// Inventory Update
// ==========================================================

inventoryUpdated:{

    type:Boolean,
    default:false
},


inventoryUpdatedAt:{

    type:Date
},


inventoryUpdatedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


stockMovementId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"StockMovement"
},


// ==========================================================
// Purchase Order Update
// ==========================================================

purchaseStatus:{

    type:String,
    enum:[
        "Pending",
        "Partially Received",
        "Completed"
    ],
    default:"Pending"
},


// ==========================================================
// Approval
// ==========================================================

status:{

    type:String,
    enum:[
        "Draft",
        "Pending Approval",
        "Completed",
        "Cancelled",
        // legacy values kept for old docs
        "Received",
        "Verified"
    ],
    default:"Draft",
    index: true
},

requiresApproval: {
    type: Boolean,
    default: false
},

approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AdminUser",
    default: null
},

approvedAt: {
    type: Date,
    default: null
},

submittedAt: {
    type: Date,
    default: null
},

rejectionReason: {
    type: String,
    default: ""
},


verifiedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


verifiedAt:{

    type:Date
},


// ==========================================================
// Accounting
// ==========================================================

ledgerEntryId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Ledger"
},


isLedgerPosted:{

    type:Boolean,
    default:false
},


ledgerPostedAt:{

    type:Date
},


// ==========================================================
// Attachment
// ==========================================================

attachments:[
{


    fileName:String,

    fileUrl:String,

    uploadedAt:{

        type:Date,
        default:Date.now
    }

}
],


// ==========================================================
// Notes
// ==========================================================

supplierNote:{

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
    ref:"AdminUser"
},


updatedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


cancelledBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


cancelledAt:{

    type:Date
},


isDeleted:{

    type:Boolean,
    default:false
},


deletedAt:{

    type:Date
},


remarks:{

    type:String,
    default:""
}


},
{

    timestamps:true,
    versionKey:false
});


// ==========================================================
// INDEXES
// ==========================================================

grnSchema.index({ grnNumber:1 }, {

    unique:true
});


grnSchema.index({ purchaseOrderId:1 });


grnSchema.index({ supplierId:1 });


grnSchema.index({ warehouseId:1 });


grnSchema.index({ receivedDate:-1 });


grnSchema.index({ status:1 });


grnSchema.index({ qualityStatus:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate GRN Summary

grnSchema.methods.calculateSummary =
function(){


    this.subtotal = 0;

    this.totalAcceptedQuantity = 0;

    this.totalDamagedQuantity = 0;


    this.items.forEach(item=>{


        item.acceptedQuantity =

            item.receivedQuantity -

            item.damagedQuantity -

            item.rejectedQuantity;


        if(item.acceptedQuantity < 0){


            item.acceptedQuantity = 0;

        }


        item.total =

            item.acceptedQuantity *

            item.purchasePrice;


        this.subtotal += item.total;

        this.totalAcceptedQuantity += item.acceptedQuantity;

        this.totalDamagedQuantity += item.damagedQuantity;

    });


    this.grandTotal = this.subtotal;

    return this.grandTotal;

};


// Verify GRN

grnSchema.methods.verify =
function(userId){


    this.status = "Verified";

    this.verifiedBy = userId;

    this.verifiedAt = new Date();

    return this.save();

};


// Complete Inventory Update

grnSchema.methods.completeInventoryUpdate =
function(userId){


    this.inventoryUpdated = true;

    this.inventoryUpdatedAt = new Date();

    this.inventoryUpdatedBy = userId;

    this.status = "Completed";

    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// All GRNs

grnSchema.statics.getAllGRNs =
function(){


    return this.find({
        isDeleted:false

    })
    .sort({


        receivedDate:-1

    });

};


// Pending Inventory Update

grnSchema.statics.getPendingInventory =
function(){


    return this.find({
        inventoryUpdated:false,

        isDeleted:false

    });

};


// Monthly GRN Report

grnSchema.statics.getMonthlyReport =
function(month,
    year
){


    const startDate =
    new Date(year,month-1,1);

    const endDate =
    new Date(year,month,0);


    return this.find({
        receivedDate:{

            $gte:startDate,
            $lte:endDate
        },

        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPER
// ==========================================================

grnSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================

grnSchema.set(

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
    "GRN",
    grnSchema
);