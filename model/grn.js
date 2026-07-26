const mongoose = require("mongoose");



// ==========================================================
// GRN Item Schema
// ==========================================================

const grnItemSchema = new mongoose.Schema(
{

    productId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
        required:true
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
        required:true
    },


    receivedQuantity:{
        type:Number,
        required:true
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


    remarks:{
        type:String,
        default:""
    }

},
{
    _id:false
});







// ==========================================================
// GRN Schema
// ==========================================================

const grnSchema = new mongoose.Schema(
{

// ==========================================================
// Company
// ==========================================================

companyId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Company",
    required:true,
    index:true
},


branchId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true
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
    required:true
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
        "Received",
        "Verified",
        "Completed",
        "Cancelled"
    ],
    default:"Draft"
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

grnSchema.index(
{
    companyId:1,
    grnNumber:1
},
{
    unique:true
});


grnSchema.index({
    purchaseOrderId:1
});


grnSchema.index({
    supplierId:1
});


grnSchema.index({
    warehouseId:1
});


grnSchema.index({
    receivedDate:-1
});


grnSchema.index({
    status:1
});


grnSchema.index({
    qualityStatus:1
});




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


// Company GRN List

grnSchema.statics.getCompanyGRNs =
function(companyId){

    return this.find({

        companyId,

        isDeleted:false

    })
    .sort({

        receivedDate:-1

    });

};




// Pending Inventory Update

grnSchema.statics.getPendingInventory =
function(companyId){

    return this.find({

        companyId,

        inventoryUpdated:false,

        isDeleted:false

    });

};




// Monthly GRN Report

grnSchema.statics.getMonthlyReport =
function(
    companyId,
    month,
    year
){

    const startDate =
    new Date(year,month-1,1);

    const endDate =
    new Date(year,month,0);


    return this.find({

        companyId,

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