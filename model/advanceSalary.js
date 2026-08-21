const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");


// ==========================================================
// Installment Schema
// ==========================================================

const installmentSchema = new mongoose.Schema(
{


    installmentNumber:{

        type:Number,
        required:true
    },


    amount:{

        type:Number,
        default:0
    },


    dueDate:{

        type:Date
    },


    paidDate:{

        type:Date
    },


    status:{

        type:String,
        enum:[
            "Pending",
            "Paid",
            "Late"
        ],
        default:"Pending"
    }


},
{

    _id:false
});


// ==========================================================
// Advance Salary Schema
// ==========================================================


const advanceSalarySchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true
},


departmentId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Department"
},


// ==========================================================
// Employee Information
// ==========================================================


employeeId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Employee",
    required:true,
    index:true
},


employeeCode:{

    type:String,
    required:true
},


employeeName:{

    type:String,
    required:true
},


// ==========================================================
// Advance Information
// ==========================================================


requestNumber:{

    type:String,
    required:true,
    unique:true
},


requestDate:{

    type:Date,
    default:Date.now
},


advanceAmount:{

    type:Number,
    required:true
},


approvedAmount:{

    type:Number,
    default:0
},


reason:{

    type:String,
    required:true
},


// ==========================================================
// Repayment
// ==========================================================


repaymentType:{

    type:String,
    enum:[
        "Single Payment",
        "Monthly Installment"
    ],
    default:"Monthly Installment"
},


installmentCount:{

    type:Number,
    default:1
},


installmentAmount:{

    type:Number,
    default:0
},


installments:[
    installmentSchema
],


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
    default:"Pending"
},


// ==========================================================
// Manager Approval
// ==========================================================


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


// ==========================================================
// HR Approval
// ==========================================================


hrApproval:{


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
// Payment Information
// ==========================================================


paymentStatus:{

    type:String,
    enum:[
        "Pending",
        "Processing",
        "Paid",
        "Failed"
    ],
    default:"Pending"
},


paymentMethod:{

    type:String,
    enum:[
        "Cash",
        "Bank Transfer",
        "Mobile Banking",
        "Cheque"
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
// Payroll Integration
// ==========================================================


isPayrollAdjusted:{

    type:Boolean,
    default:false
},


payrollId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Payroll"
},


deductedAmount:{

    type:Number,
    default:0
},


remainingAmount:{

    type:Number,
    default:0
},


// ==========================================================
// Accounting Integration
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


advanceSalarySchema.index({


    employeeId:1,

    requestDate:-1

});


advanceSalarySchema.index({ approvalStatus:1 });


advanceSalarySchema.index({ paymentStatus:1 });


advanceSalarySchema.index({ payrollId:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Remaining Amount


advanceSalarySchema.methods.calculateRemaining =
function(){


    this.remainingAmount =

        this.approvedAmount -

        this.deductedAmount;


    if(this.remainingAmount < 0)
    {

        this.remainingAmount = 0;
    }


    return this.remainingAmount;


};


// Approve Advance Salary


advanceSalarySchema.methods.approve =
function(userId){


    this.approvalStatus = "Approved";


    this.hrApproval.status = "Approved";


    this.hrApproval.approvedBy = userId;


    this.hrApproval.approvedAt = new Date();


    return this.save();


};


// Reject Advance Salary


advanceSalarySchema.methods.reject =
function(userId, reason){


    this.approvalStatus="Rejected";


    this.hrApproval.status="Rejected";


    this.hrApproval.approvedBy=userId;


    this.hrApproval.approvedAt=new Date();


    this.hrApproval.comment=reason;


    return this.save();


};


// Mark Payment Complete


advanceSalarySchema.methods.markPaid =
function(transactionId){


    this.paymentStatus="Paid";


    this.paymentDate=new Date();


    this.transactionId=transactionId;


    return this.save();


};


// Cancel Request


advanceSalarySchema.methods.cancel =
function(userId){


    this.approvalStatus="Cancelled";


    this.cancelledBy=userId;


    this.cancelledAt=new Date();


    return this.save();


};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Employee Advance History


advanceSalarySchema.statics.getEmployeeAdvanceHistory =
function(employeeId){


    return this.find({


        employeeId,

        isDeleted:false

    })
    .sort({


        requestDate:-1

    });


};


// Pending Approval List


advanceSalarySchema.statics.getPendingApproval =
function(){


    return this.find({
        approvalStatus:"Pending",

        isDeleted:false

    })
    .sort({


        requestDate:-1

    });


};


// Advance Summary


advanceSalarySchema.statics.getSummary =
async function(){


    return this.aggregate([


        {


            $match:
            {
                isDeleted:false

            }

        },


        {


            $group:
            {


                _id:null,


                totalAdvance:
                {

                    $sum:"$approvedAmount"
                },


                totalDeducted:
                {

                    $sum:"$deductedAmount"
                },


                totalRemaining:
                {

                    $sum:"$remainingAmount"
                }

            }

        }


    ]);


};


// ==========================================================
// QUERY HELPER
// ==========================================================


advanceSalarySchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


advanceSalarySchema.set(

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


advanceSalarySchema.plugin(tenantPlugin);

module.exports =

mongoose.model(

    "AdvanceSalary",

    advanceSalarySchema

);