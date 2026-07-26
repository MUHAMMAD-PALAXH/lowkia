const mongoose = require("mongoose");


// ==========================================================
// EMI Schedule Schema
// ==========================================================

const emiSchema = new mongoose.Schema(
{


    installmentNumber:{

        type:Number,
        required:true
    },


    dueDate:{

        type:Date,
        required:true
    },


    amount:{

        type:Number,
        default:0
    },


    paidAmount:{

        type:Number,
        default:0
    },


    paidDate:{

        type:Date
    },


    status:{

        type:String,
        enum:[
            "Pending",
            "Paid",
            "Partial",
            "Late"
        ],
        default:"Pending"
    },


    transactionId:{

        type:String,
        default:""
    }

},
{

    _id:false
});


// ==========================================================
// Employee Loan Schema
// ==========================================================


const employeeLoanSchema = new mongoose.Schema(
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
// Loan Information
// ==========================================================


loanNumber:{

    type:String,
    required:true,
    unique:true
},


loanType:{

    type:String,
    enum:[
        "Personal Loan",
        "Emergency Loan",
        "Medical Loan",
        "Education Loan",
        "Vehicle Loan",
        "Other"
    ],
    required:true
},


loanDate:{

    type:Date,
    default:Date.now
},


loanAmount:{

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
// Repayment Information
// ==========================================================


repaymentType:{

    type:String,
    enum:[
        "Monthly EMI",
        "Single Payment"
    ],
    default:"Monthly EMI"
},


totalInstallments:{

    type:Number,
    default:12
},


emiAmount:{

    type:Number,
    default:0
},


paidInstallments:{

    type:Number,
    default:0
},


remainingAmount:{

    type:Number,
    default:0
},


emiSchedule:[
    emiSchema
],


// ==========================================================
// Interest Configuration
// ==========================================================


interestApplicable:{

    type:Boolean,
    default:false
},


interestType:{

    type:String,
    enum:[
        "Fixed",
        "Percentage"
    ]
},


interestRate:{

    type:Number,
    default:0
},


interestAmount:{

    type:Number,
    default:0
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
    default:"Pending"
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


// HR Approval

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
// Loan Disbursement
// ==========================================================


disbursementStatus:{

    type:String,
    enum:[
        "Pending",
        "Processing",
        "Disbursed",
        "Cancelled"
    ],
    default:"Pending"
},


disbursementDate:{

    type:Date
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


transactionId:{

    type:String,
    default:""
},


disbursedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


// ==========================================================
// Payroll Integration
// ==========================================================


payrollDeductionEnabled:{

    type:Boolean,
    default:true
},


lastDeductedMonth:{

    type:String,
    default:""
},


deductedAmount:{

    type:Number,
    default:0
},


payrollIds:[

    {


        type:mongoose.Schema.Types.ObjectId,

        ref:"Payroll"

    }

],


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
// ==========================================================


employeeLoanSchema.index({ loanNumber:1 }, {

    unique:true
});


employeeLoanSchema.index({


    employeeId:1,

    loanDate:-1

});


employeeLoanSchema.index({ approvalStatus:1 });


employeeLoanSchema.index({ disbursementStatus:1 });


employeeLoanSchema.index({ payrollDeductionEnabled:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate EMI


employeeLoanSchema.methods.calculateEMI =
function(){


    let total =

    this.approvedAmount;


    if(
        this.interestApplicable
    )
    {


        if(
            this.interestType === "Percentage"
        )
        {


            this.interestAmount =

            (
                total *
                this.interestRate
            )
            /
            100;


        }

        else
        {


            this.interestAmount =
            this.interestRate;

        }


        total += this.interestAmount;

    }


    this.remainingAmount =
    total;


    this.emiAmount =

    Number(

        (
            total /
            this.totalInstallments

        )
        .toFixed(2)

    );


    return this.emiAmount;


};


// Pay EMI


employeeLoanSchema.methods.payEMI =
function(
    installmentNumber,
    amount
){


    const installment =

    this.emiSchedule.find(

        item =>

        item.installmentNumber ===
        installmentNumber

    );


    if(!installment)
        return null;


    installment.paidAmount =
    amount;


    installment.paidDate =
    new Date();


    installment.status =
    "Paid";


    this.paidInstallments += 1;


    this.deductedAmount += amount;


    this.remainingAmount -= amount;


    if(this.remainingAmount <= 0)
    {


        this.remainingAmount=0;

    }


    return this.save();


};


// Approve Loan


employeeLoanSchema.methods.approve =
function(userId){


    this.approvalStatus =
    "Approved";


    this.hrApproval.status =
    "Approved";


    this.hrApproval.approvedBy =
    userId;


    this.hrApproval.approvedAt =
    new Date();


    return this.save();


};


// Reject Loan


employeeLoanSchema.methods.reject =
function(
    userId,
    reason
){


    this.approvalStatus =
    "Rejected";


    this.hrApproval.status =
    "Rejected";


    this.hrApproval.approvedBy =
    userId;


    this.hrApproval.comment =
    reason;


    return this.save();


};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Employee Loan History


employeeLoanSchema.statics.getEmployeeLoans =
function(
    employeeId
){


    return this.find({


        employeeId,

        isDeleted:false

    })
    .sort({


        loanDate:-1

    });


};


// Pending Loans


employeeLoanSchema.statics.getPendingLoans =
function(){


    return this.find({
        approvalStatus:"Pending",

        isDeleted:false

    })
    .sort({


        loanDate:-1

    });


};


// Loan Summary


employeeLoanSchema.statics.getSummary =
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


                totalLoan:
                {

                    $sum:"$approvedAmount"
                },


                totalPaid:
                {

                    $sum:"$deductedAmount"
                },


                remainingLoan:
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


employeeLoanSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


employeeLoanSchema.set(

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

    "EmployeeLoan",

    employeeLoanSchema

);