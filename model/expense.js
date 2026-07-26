const mongoose = require("mongoose");



// ==========================================================
// Expense Item Schema
// ==========================================================


const expenseItemSchema =
new mongoose.Schema(
{

    itemName:{
        type:String,
        required:true,
        trim:true
    },


    description:{
        type:String,
        default:""
    },


    quantity:{
        type:Number,
        default:1
    },


    unitPrice:{
        type:Number,
        default:0
    },


    amount:{
        type:Number,
        default:0
    }


},
{
    _id:false
});







// ==========================================================
// Expense Schema
// ==========================================================


const expenseSchema =
new mongoose.Schema(
{

// ==========================================================
// Company Information
// ==========================================================


companyId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Company",
    required:true,
    index:true
},



branchId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch"
},



departmentId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Department"
},





// ==========================================================
// Expense Information
// ==========================================================


expenseNumber:{
    type:String,
    required:true,
    unique:true
},



expenseDate:{
    type:Date,
    default:Date.now
},



expenseCategory:{
    type:String,
    enum:[
        "Office",
        "Travel",
        "Marketing",
        "Utility",
        "Rent",
        "Salary",
        "Maintenance",
        "Purchase",
        "Tax",
        "Other"
    ],
    required:true
},



expenseTitle:{
    type:String,
    required:true,
    trim:true
},



description:{
    type:String,
    default:""
},




// ==========================================================
// Expense Items
// ==========================================================


items:[
    expenseItemSchema
],




// ==========================================================
// Amount Information
// ==========================================================


subtotal:{
    type:Number,
    default:0
},


taxAmount:{
    type:Number,
    default:0
},


discountAmount:{
    type:Number,
    default:0
},


totalAmount:{
    type:Number,
    default:0
},


// ==========================================================
// Related Information
// ==========================================================


supplierId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Supplier"
},



employeeId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Employee"
},



customerId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Customer"
},





// ==========================================================
// Payment Information
// ==========================================================


paymentStatus:{
    type:String,
    enum:[
        "Pending",
        "Approved",
        "Processing",
        "Paid",
        "Rejected",
        "Cancelled"
    ],
    default:"Pending"
},



paymentMethod:{
    type:String,
    enum:[
        "Cash",
        "Bank Transfer",
        "Mobile Banking",
        "Cheque",
        "Credit"
    ],
    default:"Cash"
},



paymentDate:{
    type:Date
},



transactionId:{
    type:String,
    default:""
},



paidBy:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},




// ==========================================================
// Approval Workflow
// ==========================================================


approvalStatus:{
    type:String,
    enum:[
        "Draft",
        "Pending",
        "Approved",
        "Rejected",
        "Cancelled"
    ],
    default:"Draft"
},




// Manager Approval

managerApproval:{

    status:{
        type:String,
        enum:[
            "Pending",
            "Approved",
            "Rejected"
        ],
        default:"Pending"
    },


    approvedBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser"
    },


    approvedAt:{
        type:Date
    },


    comment:{
        type:String,
        default:""
    }

},





// Finance Approval

financeApproval:{

    status:{
        type:String,
        enum:[
            "Pending",
            "Approved",
            "Rejected"
        ],
        default:"Pending"
    },


    approvedBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser"
    },


    approvedAt:{
        type:Date
    },


    comment:{
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
            type:String
        },


        fileUrl:{
            type:String
        },


        uploadedAt:{
            type:Date,
            default:Date.now
        }

    }

],




// ==========================================================
// Accounting Integration
// ==========================================================


ledgerEntryId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Ledger"
},



expenseAccountId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Account"
},



isLedgerPosted:{
    type:Boolean,
    default:false
},



ledgerPostedAt:{
    type:Date
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


notes:{
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



expenseSchema.index(
{
    companyId:1,
    expenseNumber:1
},
{
    unique:true
});



expenseSchema.index({

    expenseDate:-1

});



expenseSchema.index({

    expenseCategory:1

});



expenseSchema.index({

    branchId:1,

    expenseDate:-1

});



expenseSchema.index({

    approvalStatus:1

});



expenseSchema.index({

    paymentStatus:1

});






// ==========================================================
// INSTANCE METHODS
// ==========================================================



// Calculate Total Expense


expenseSchema.methods.calculateTotal =
function(){



    this.subtotal = 0;



    this.items.forEach(

        item => {


            item.amount =

            item.quantity *

            item.unitPrice;



            this.subtotal +=

            item.amount;


        }

    );



    this.totalAmount =

        this.subtotal +

        this.taxAmount -

        this.discountAmount;



    return this.totalAmount;


};







// Approve Expense


expenseSchema.methods.approve =
function(userId){



    this.approvalStatus =
    "Approved";


    this.financeApproval.status =
    "Approved";


    this.financeApproval.approvedBy =
    userId;


    this.financeApproval.approvedAt =
    new Date();



    return this.save();


};







// Reject Expense


expenseSchema.methods.reject =
function(
    userId,
    reason
){



    this.approvalStatus =
    "Rejected";


    this.financeApproval.status =
    "Rejected";


    this.financeApproval.approvedBy =
    userId;


    this.financeApproval.comment =
    reason;



    return this.save();


};







// Mark Paid


expenseSchema.methods.markPaid =
function(transactionId){



    this.paymentStatus =
    "Paid";


    this.paymentDate =
    new Date();


    this.transactionId =
    transactionId;



    return this.save();


};






// ==========================================================
// STATIC METHODS
// ==========================================================



// Company Expense History


expenseSchema.statics.getCompanyExpenses =
function(
    companyId
){


    return this.find({

        companyId,

        isDeleted:false

    })
    .sort({

        expenseDate:-1

    });


};







// Monthly Expense Report


expenseSchema.statics.getMonthlyExpense =
function(
    companyId,
    month,
    year
){


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

        companyId,


        expenseDate:
        {
            $gte:startDate,

            $lte:endDate
        },


        isDeleted:false

    });


};







// Expense Summary


expenseSchema.statics.getSummary =
async function(
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

            $group:
            {

                _id:"$expenseCategory",


                total:
                {
                    $sum:"$totalAmount"
                }


            }

        }


    ]);



};







// ==========================================================
// QUERY HELPER
// ==========================================================


expenseSchema.query.active =
function(){


    return this.where({

        isDeleted:false

    });


};







// ==========================================================
// JSON CONFIG
// ==========================================================


expenseSchema.set(

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

    "Expense",

    expenseSchema

);