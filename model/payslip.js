const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");


// ==========================================================
// Payslip Component Schema
// ==========================================================


const payslipComponentSchema =
new mongoose.Schema(
{


    componentName:{

        type:String,
        required:true
    },


    componentType:{

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
// Payslip Schema
// ==========================================================


const payslipSchema =
new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch"
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


departmentId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Department"
},


// ==========================================================
// Payroll Reference
// ==========================================================


payrollId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Payroll",
    required:true,
    unique:true
},


payrollMonth:{

    type:Number,
    required:true
},


payrollYear:{

    type:Number,
    required:true
},


payslipNumber:{

    type:String,
    required:true,
    unique:true
},


// ==========================================================
// Salary Breakdown
// ==========================================================


basicSalary:{

    type:Number,
    default:0
},


grossSalary:{

    type:Number,
    default:0
},


components:[
    payslipComponentSchema
],


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
// Attendance Summary
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


overtimeHours:{

    type:Number,
    default:0
},


overtimeAmount:{

    type:Number,
    default:0
},


// ==========================================================
// Leave Summary
// ==========================================================


paidLeaveDays:{

    type:Number,
    default:0
},


unpaidLeaveDays:{

    type:Number,
    default:0
},


leaveDeduction:{

    type:Number,
    default:0
},


// ==========================================================
// Deduction Details
// ==========================================================


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
// Payment Information
// ==========================================================


paymentStatus:{

    type:String,
    enum:[
        "Pending",
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


// ==========================================================
// PDF Generation
// ==========================================================


pdfGenerated:{

    type:Boolean,
    default:false
},


pdfUrl:{

    type:String,
    default:""
},


pdfGeneratedAt:{

    type:Date
},


// ==========================================================
// Employee Access
// ==========================================================


employeeViewed:{

    type:Boolean,
    default:false
},


viewedAt:{

    type:Date
},


downloadCount:{

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
        "Generated",
        "Approved",
        "Rejected"
    ],
    default:"Draft"
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


isLedgerPosted:{

    type:Boolean,
    default:false
},


ledgerPostedAt:{

    type:Date
},


// ==========================================================
// Email Notification
// ==========================================================


emailSent:{

    type:Boolean,
    default:false
},


emailSentAt:{

    type:Date
},


emailAddress:{

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


payslipSchema.index({


    employeeId:1,

    payrollYear:-1,

    payrollMonth:-1

});


payslipSchema.index({ approvalStatus:1 });


payslipSchema.index({ paymentStatus:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Net Salary


payslipSchema.methods.calculateNetSalary =
function(){


    this.totalEarnings = 0;

    this.totalDeductions = 0;


    this.components.forEach(

        component => {


            if(
                component.componentType === "Earning"
            )
            {


                this.totalEarnings +=
                component.amount;

            }


            else if(
                component.componentType === "Deduction"
            )
            {


                this.totalDeductions +=
                component.amount;

            }


        }

    );


    this.netSalary =

    this.totalEarnings -

    this.totalDeductions;


    return this.netSalary;


};


// Generate PDF Status


payslipSchema.methods.markPDFGenerated =
function(url){


    this.pdfGenerated=true;


    this.pdfUrl=url;


    this.pdfGeneratedAt=new Date();


    return this.save();


};


// Mark Employee Viewed


payslipSchema.methods.markViewed =
function(){


    this.employeeViewed=true;


    this.viewedAt=new Date();


    this.downloadCount += 1;


    return this.save();


};


// Approve Payslip


payslipSchema.methods.approve =
function(userId){


    this.approvalStatus="Approved";


    this.approvedBy=userId;


    this.approvedAt=new Date();


    return this.save();


};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Employee Payslip History


payslipSchema.statics.getEmployeePayslips =
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


// Monthly Payslip Report


payslipSchema.statics.getMonthlyReport =
function(month,
    year
){


    return this.find({
        payrollMonth:month,

        payrollYear:year,

        isDeleted:false

    });


};


// Salary Summary


payslipSchema.statics.getSummary =
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


                totalPaidSalary:
                {

                    $sum:"$netSalary"
                },


                employeeCount:
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


payslipSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


payslipSchema.set(

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


payslipSchema.plugin(tenantPlugin);

module.exports =

mongoose.model(

    "Payslip",

    payslipSchema

);