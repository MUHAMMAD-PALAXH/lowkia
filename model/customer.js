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
// Customer Schema
// ==========================================================


const customerSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null
},


// ==========================================================
// Customer Identity
// ==========================================================


customerId:{

    type:String,
    required:true,
    unique:true,
    trim:true
},


customerCode:{

    type:String,
    required:true,
    unique:true,
    trim:true
},


customerType:{

    type:String,
    enum:[
        "Retail",
        "Wholesale",
        "Corporate",
        "Distributor",
        "VIP",
        "Other"
    ],
    default:"Retail"
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
        "Receivable",
        "Advance",
        "Settled"
    ],
    default:"Receivable"
},


// ==========================================================
// Sales Summary
// ==========================================================


totalSalesAmount:{

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


lastSaleDate:{

    type:Date
},


lastPaymentDate:{

    type:Date
},


// ==========================================================
// Ledger Integration
// ==========================================================


ledgerAccountId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Account",
    default:null
},


customerLedgerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Ledger",
    default:null
},


// ==========================================================
// Customer Rating
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
// Shipping Information
// ==========================================================


shippingAddress:{

    type:String,
    default:""
},


shippingCity:{

    type:String,
    default:""
},


shippingCountry:{

    type:String,
    default:"Bangladesh"
},


billingAddress:{

    type:String,
    default:""
},


billingCity:{

    type:String,
    default:""
},


billingCountry:{

    type:String,
    default:"Bangladesh"
},


// ==========================================================
// Customer Group
// ==========================================================


customerGroup:{

    type:String,
    default:"General"
},


salesPersonId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
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
    ref:"AdminUser",
    default:null
},


approvedAt:{

    type:Date,
    default:null
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

companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    default: null,
    index: true,
},

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


customerSchema.index({ name:1 });


customerSchema.index({ phone:1 });


customerSchema.index({ email:1 });


customerSchema.index({ status:1 });


customerSchema.index({ customerType:1 });


customerSchema.index({ totalDueAmount:-1 });


customerSchema.index({ createdAt:-1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Update Customer Balance


customerSchema.methods.updateBalance =
function(
    saleAmount,
    paymentAmount
){


    this.totalSalesAmount += saleAmount;


    this.totalPaidAmount += paymentAmount;


    this.totalDueAmount =

        this.totalSalesAmount -

        this.totalPaidAmount;


    this.currentBalance =

        this.totalDueAmount;


    return this.save();

};


// Add Rating


customerSchema.methods.addRating =
function(score)
{


    const totalScore =

    (this.rating * this.ratingCount)

    + score;


    this.ratingCount += 1;


    this.rating =

    totalScore /

    this.ratingCount;


    return this.save();

};


// Block Customer


customerSchema.methods.block =
function()
{


    this.status="Blocked";


    return this.save();

};


// Activate Customer


customerSchema.methods.activate =
function()
{


    this.status="Active";


    return this.save();

};

// ==========================================================
// STATIC METHODS
// ==========================================================


// Active Customers


customerSchema.statics.getActiveCustomers =
function()
{


    return this.find({
        status:"Active",

        isDeleted:false

    });

};


// Customer Due Report


customerSchema.statics.getDueReport =
function()
{


    return this.find({
        totalDueAmount:{

            $gt:0
        },


        isDeleted:false

    })
    .sort({


        totalDueAmount:-1

    });

};


// Customer Sales Report


customerSchema.statics.getSalesReport =
function()
{


    return this.aggregate([


        {


            $match:{
                isDeleted:false

            }

        },


        {


            $project:{


                name:1,

                totalSalesAmount:1,

                totalPaidAmount:1,

                totalDueAmount:1

            }

        }


    ]);

};


// Search Customer


customerSchema.statics.searchCustomer =
function(keyword
)
{


    return this.find({
        $or:[

            {

                name:{

                    $regex:keyword,
                    $options:"i"
                }
            },


            {

                phone:{

                    $regex:keyword,
                    $options:"i"
                }
            },


            {

                email:{

                    $regex:keyword,
                    $options:"i"
                }
            }


        ],


        isDeleted:false


    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


customerSchema.query.active =
function()
{


    return this.where({


        status:"Active",

        isDeleted:false

    });

};


customerSchema.query.withDue =
function()
{


    return this.where({


        totalDueAmount:{

            $gt:0
        },

        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


customerSchema.set(
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
    "Customer",
    customerSchema
);