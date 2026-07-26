const mongoose = require("mongoose");


// ==========================================================
// Contact Person Schema
// ==========================================================

const contactPersonSchema = new mongoose.Schema(
{
    name:{
        type:String,
        required:true,
        trim:true
    },


    designation:{
        type:String,
        default:""
    },


    phone:{
        type:String,
        default:""
    },


    email:{
        type:String,
        default:""
    }

},
{
    _id:false
});





// ==========================================================
// Bank Information Schema
// ==========================================================

const bankSchema = new mongoose.Schema(
{

    bankName:{
        type:String,
        default:""
    },


    accountName:{
        type:String,
        default:""
    },


    accountNumber:{
        type:String,
        default:""
    },


    branchName:{
        type:String,
        default:""
    },


    routingNumber:{
        type:String,
        default:""
    }


},
{
    _id:false
});






// ==========================================================
// Supplier Schema
// ==========================================================

const supplierSchema = new mongoose.Schema(
{

// ==========================================================
// Company Relation
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
    default:null
},






// ==========================================================
// Supplier Identity
// ==========================================================


supplierId:{
    type:String,
    required:true,
    unique:true,
    trim:true
},



supplierCode:{
    type:String,
    required:true,
    unique:true,
    trim:true
},



supplierType:{
    type:String,
    enum:[
        "Manufacturer",
        "Distributor",
        "Wholesaler",
        "Retailer",
        "Service Provider",
        "Other"
    ],
    default:"Manufacturer"
},



name:{
    type:String,
    required:true,
    trim:true
},



companyName:{
    type:String,
    default:"",
    trim:true
},



// ==========================================================
// Legal Information
// ==========================================================


taxNumber:{
    type:String,
    default:""
},



vatNumber:{
    type:String,
    default:""
},



tradeLicense:{
    type:String,
    default:""
},




// ==========================================================
// Contact Information
// ==========================================================


phone:{
    type:String,
    default:""
},



email:{
    type:String,
    lowercase:true,
    trim:true,
    default:""
},



website:{
    type:String,
    default:""
},



address:{
    type:String,
    default:""
},



city:{
    type:String,
    default:""
},



country:{
    type:String,
    default:"Bangladesh"
},



contactPersons:[
    contactPersonSchema
],





// ==========================================================
// Payment Terms
// ==========================================================


paymentTerms:{
    type:String,
    enum:[
        "Cash",
        "7 Days",
        "15 Days",
        "30 Days",
        "60 Days",
        "90 Days",
        "Custom"
    ],
    default:"Cash"
},



creditLimit:{
    type:Number,
    default:0
},



creditDays:{
    type:Number,
    default:0
},


// ==========================================================
// Financial Information
// ==========================================================


openingBalance:{
    type:Number,
    default:0
},



currentBalance:{
    type:Number,
    default:0
},



balanceType:{
    type:String,
    enum:[
        "Payable",
        "Advance",
        "Settled"
    ],
    default:"Payable"
},





// ==========================================================
// Purchase Summary
// ==========================================================


totalPurchaseAmount:{
    type:Number,
    default:0
},



totalPaidAmount:{
    type:Number,
    default:0
},



totalDueAmount:{
    type:Number,
    default:0
},



lastPurchaseDate:{
    type:Date
},



lastPaymentDate:{
    type:Date
},






// ==========================================================
// Bank Information
// ==========================================================


bankAccounts:[
    bankSchema
],






// ==========================================================
// Ledger Integration
// ==========================================================


ledgerAccountId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Account",
    default:null
},



supplierLedgerId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Ledger",
    default:null
},




// ==========================================================
// Supplier Rating
// ==========================================================


rating:{
    type:Number,
    min:0,
    max:5,
    default:0
},



ratingCount:{
    type:Number,
    default:0
},






// ==========================================================
// Status Management
// ==========================================================


status:{
    type:String,
    enum:[
        "Active",
        "Inactive",
        "Blocked"
    ],
    default:"Active"
},



isApproved:{
    type:Boolean,
    default:false
},



approvedBy:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},



approvedAt:{
    type:Date
},






// ==========================================================
// Additional Information
// ==========================================================


note:{
    type:String,
    default:""
},



tags:[
    {
        type:String
    }
],


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
},




},
{
    timestamps:true,
    versionKey:false
});







// ==========================================================
// INDEXES
// ==========================================================



supplierSchema.index(
{
    companyId:1,
    supplierCode:1
},
{
    unique:true
});



supplierSchema.index({

    companyId:1,

    name:1

});



supplierSchema.index({

    phone:1

});



supplierSchema.index({

    email:1

});



supplierSchema.index({

    status:1

});






// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Update Supplier Balance


supplierSchema.methods.updateBalance =
function(
    purchaseAmount,
    paymentAmount
){

    this.totalPurchaseAmount += purchaseAmount;


    this.totalPaidAmount += paymentAmount;


    this.totalDueAmount =

    this.totalPurchaseAmount -

    this.totalPaidAmount;



    this.currentBalance =

    this.totalDueAmount;



    return this.save();

};






// Add Rating


supplierSchema.methods.addRating =
function(score){


    const totalScore =

    (this.rating * this.ratingCount)

    + score;



    this.ratingCount += 1;



    this.rating =

    totalScore /

    this.ratingCount;



    return this.save();

};






// Block Supplier


supplierSchema.methods.block =
function(){


    this.status="Blocked";


    return this.save();


};






// Activate Supplier


supplierSchema.methods.activate =
function(){


    this.status="Active";


    return this.save();


};







// ==========================================================
// STATIC METHODS
// ==========================================================


// Get Active Suppliers


supplierSchema.statics.getActiveSuppliers =
function(companyId)
{


    return this.find({

        companyId,

        status:"Active",

        isDeleted:false

    });


};








// Supplier Purchase Report


supplierSchema.statics.getPurchaseReport =
function(
    companyId
){


    return this.aggregate([


        {

            $match:
            {

                companyId,

                isDeleted:false

            }

        },


        {

            $project:
            {

                name:1,

                totalPurchaseAmount:1,

                totalPaidAmount:1,

                totalDueAmount:1


            }

        }


    ]);

};






// Supplier Due Report


supplierSchema.statics.getDueReport =
function(companyId)
{


    return this.find({

        companyId,


        totalDueAmount:
        {
            $gt:0
        },


        isDeleted:false


    })
    .sort({

        totalDueAmount:-1

    });


};







// ==========================================================
// QUERY HELPER
// ==========================================================


supplierSchema.query.active =
function(){


    return this.where({

        status:"Active",

        isDeleted:false

    });


};






// ==========================================================
// JSON CONFIG
// ==========================================================


supplierSchema.set(
"toJSON",
{

    virtuals:true,


    transform:function(
        doc,
        ret
    ){

        delete ret.__v;

        return ret;

    }

});






// ==========================================================
// EXPORT
// ==========================================================


module.exports =

mongoose.model(

    "Supplier",

    supplierSchema

);