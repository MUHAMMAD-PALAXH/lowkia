const mongoose = require("mongoose");


// ==========================================================
// Salary Component Schema
// ==========================================================

const salaryComponentSchema = new mongoose.Schema(
{


    name:{

        type:String,
        required:true
    },


    type:{

        type:String,
        enum:[
            "Earning",
            "Deduction"
        ],
        required:true
    },


    amount:{

        type:Number,
        default:0
    },


    description:{

        type:String,
        default:""
    }

},
{

    _id:false
});


// ==========================================================
// Payroll Schema
// ==========================================================


const payrollSchema = new mongoose.Schema(
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


designation:{

    type:String,
    default:""
},


// ==========================================================
// Payroll Period
// ==========================================================


payrollMonth:{

    type:Number,
    required:true
},


payrollYear:{

    type:Number,
    required:true
},


payrollPeriod:{

    type:String,
    default:""
},


// ==========================================================
// Salary Information
// ==========================================================


basicSalary:{

    type:Number,
    default:0
},


grossSalary:{

    type:Number,
    default:0
},


salaryComponents:[
    salaryComponentSchema
],


// ==========================================================
// Attendance Calculation
// ==========================================================


totalWorkingDays:{

    type:Number,
    default:0
},


presentDays:{

    type:Number,
    default:0
},


absentDays:{

    type:Number,
    default:0
},


leaveDays:{

    type:Number,
    default:0
},


halfDays:{

    type:Number,
    default:0
},


// ==========================================================
// Working Hour Calculation
// ==========================================================


totalWorkingHours:{

    type:Number,
    default:0
},


overtimeHours:{

    type:Number,
    default:0
},


overtimeAmount:{

    type:Number,
    default:0
},


// ==========================================================
// Earnings
// ==========================================================


allowanceAmount:{

    type:Number,
    default:0
},


bonusAmount:{

    type:Number,
    default:0
},


commissionAmount:{

    type:Number,
    default:0
},


otherEarnings:{

    type:Number,
    default:0
},


// ==========================================================
// Deductions
// ==========================================================


lateDeduction:{

    type:Number,
    default:0
},


absentDeduction:{

    type:Number,
    default:0
},


leaveDeduction:{

    type:Number,
    default:0
},


taxAmount:{

    type:Number,
    default:0
},


loanDeduction:{

    type:Number,
    default:0
},


advanceSalaryDeduction:{

    type:Number,
    default:0
},


otherDeduction:{

    type:Number,
    default:0
},


// ==========================================================
// Salary Calculation
// ==========================================================


totalEarnings:{

    type:Number,
    default:0
},


totalDeductions:{

    type:Number,
    default:0
},


netSalary:{

    type:Number,
    default:0
},


// ==========================================================
// Extra Payment Information
// ==========================================================


advanceSalaryId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdvanceSalary"
},


loanId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"EmployeeLoan"
},


// ==========================================================
// Salary Status
// ==========================================================


payrollStatus:{

    type:String,
    enum:[
        "Draft",
        "Calculated",
        "Approved",
        "Paid",
        "Cancelled"
    ],
    default:"Draft"
},


paymentStatus:{

    type:String,
    enum:[
        "Pending",
        "Processing",
        "Completed",
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


// ==========================================================
// Payslip Information
// ==========================================================


payslipNumber:{

    type:String,
    default:""
},


payslipGenerated:{

    type:Boolean,
    default:false
},


payslipGeneratedAt:{

    type:Date
},


// ==========================================================
// Approval Workflow
// ==========================================================


approvalStatus:{

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


approvalNote:{

    type:String,
    default:""
},


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


// One employee one payroll per month

payrollSchema.index({ employeeId:1,
    payrollMonth:1,
    payrollYear:1
 }, {

    unique:true
});


payrollSchema.index({ payrollMonth:1,
    payrollYear:1
 });


payrollSchema.index({

    branchId:1,
    payrollStatus:1
});


payrollSchema.index({ paymentStatus:1 });


payrollSchema.index({ approvalStatus:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Salary


payrollSchema.methods.calculateSalary =
function(){


    this.totalEarnings =

        this.basicSalary +

        this.allowanceAmount +

        this.bonusAmount +

        this.commissionAmount +

        this.otherEarnings +

        this.overtimeAmount;


    this.totalDeductions =

        this.lateDeduction +

        this.absentDeduction +

        this.leaveDeduction +

        this.taxAmount +

        this.loanDeduction +

        this.advanceSalaryDeduction +

        this.otherDeduction;


    this.netSalary =

        this.totalEarnings -

        this.totalDeductions;


    return this.netSalary;


};


// Approve Payroll


payrollSchema.methods.approve =
function(userId){


    this.payrollStatus="Approved";

    this.approvalStatus="Approved";

    this.approvedBy=userId;

    this.approvedAt=new Date();


    return this.save();

};


// Mark Paid


payrollSchema.methods.markPaid =
function(){


    this.payrollStatus="Paid";

    this.paymentStatus="Completed";

    this.paymentDate=new Date();


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Employee Payroll History


payrollSchema.statics.getEmployeePayroll =
function(employeeId){


    return this.find({


        employeeId,

        isDeleted:false

    })
    .sort({


        payrollYear:-1,

        payrollMonth:-1

    });


};


// Monthly Payroll Report


payrollSchema.statics.getMonthlyPayroll =
function(month,
    year
){


    return this.find({
        payrollMonth:month,

        payrollYear:year,

        isDeleted:false

    });


};


// Payroll Summary


payrollSchema.statics.getPayrollSummary =
async function(month,
    year
){


    return this.aggregate([


        {


            $match:
            {
                payrollMonth:month,

                payrollYear:year,

                isDeleted:false

            }

        },


        {


            $group:
            {


                _id:null,


                totalSalary:
                {

                    $sum:"$netSalary"
                },


                totalEmployees:
                {

                    $sum:1
                }


            }

        }


    ]);


};


// ==========================================================
// QUERY HELPER
// ==========================================================


payrollSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


payrollSchema.set(
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
    "Payroll",
    payrollSchema
);