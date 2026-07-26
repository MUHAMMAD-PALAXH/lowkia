const mongoose = require("mongoose");


// ==========================================================
// Leave Attachment Schema
// ==========================================================

const attachmentSchema = new mongoose.Schema(
{

    fileName:{

        type:String,
        default:""
    },

    fileUrl:{

        type:String,
        default:""
    }

},
{

    _id:false
});


// ==========================================================
// Leave Schema
// ==========================================================

const leaveSchema = new mongoose.Schema(
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
// Employee
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
// Leave Information
// ==========================================================

leaveType:{

    type:String,
    enum:[
        "Casual Leave",
        "Sick Leave",
        "Annual Leave",
        "Emergency Leave",
        "Maternity Leave",
        "Paternity Leave",
        "Unpaid Leave",
        "Other"
    ],
    required:true
},


leaveCategory:{

    type:String,
    enum:[
        "Paid",
        "Unpaid"
    ],
    default:"Paid"
},


// ==========================================================
// Duration
// ==========================================================


startDate:{

    type:Date,
    required:true
},


endDate:{

    type:Date,
    required:true
},


totalDays:{

    type:Number,
    default:1
},


leaveDuration:{

    type:String,
    enum:[
        "Full Day",
        "Half Day"
    ],
    default:"Full Day"
},


halfDayType:{

    type:String,
    enum:[
        "First Half",
        "Second Half"
    ]
},


// ==========================================================
// Reason
// ==========================================================


reason:{

    type:String,
    required:true,
    trim:true
},


employeeNote:{

    type:String,
    default:""
},


// ==========================================================
// Attachment
// ==========================================================


attachments:[
    attachmentSchema
],


// ==========================================================
// Approval Workflow
// ==========================================================


approvalStatus:{

    type:String,
    enum:[
        "Pending",
        "Approved",
        "Rejected",
        "Cancelled"
    ],
    default:"Pending"
},


// Employee request time

requestedAt:{

    type:Date,
    default:Date.now
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
// Final Approval
// ==========================================================


finalApprovedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


finalApprovedAt:{

    type:Date
},


// ==========================================================
// Leave Balance
// ==========================================================


previousBalance:{

    type:Number,
    default:0
},


usedBalance:{

    type:Number,
    default:0
},


remainingBalance:{

    type:Number,
    default:0
},


// ==========================================================
// Attendance Integration
// ==========================================================


attendanceUpdated:{

    type:Boolean,
    default:false
},


attendanceRecordIds:[

    {

        type:mongoose.Schema.Types.ObjectId,
        ref:"Attendance"
    }

],


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


deductionAmount:{

    type:Number,
    default:0
},


// ==========================================================
// Cancellation
// ==========================================================


isCancelled:{

    type:Boolean,
    default:false
},


cancelledBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},


cancelledAt:{

    type:Date
},


cancellationReason:{

    type:String,
    default:""
},


// ==========================================================
// Audit
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


// Same employee cannot create duplicate active leave
// for same date range

leaveSchema.index({ employeeId:1,
    startDate:1,
    endDate:1
 }, {

    unique:true
});


leaveSchema.index({ branchId:1,
    approvalStatus:1

 });


leaveSchema.index({


    employeeId:1,
    leaveType:1

});


leaveSchema.index({


    startDate:1,
    endDate:1

});


leaveSchema.index({ approvalStatus:1 });


leaveSchema.index({ isPayrollAdjusted:1 });


// ==========================================================
// VIRTUALS
// ==========================================================


leaveSchema.virtual("duration").get(function(){


    if(
        !this.startDate ||
        !this.endDate
    )
    {

        return 0;
    }


    const diff =
    this.endDate -
    this.startDate;


    return Math.floor(

        diff /
        (1000*60*60*24)

    ) + 1;


});


// ==========================================================
// PRE SAVE
// ==========================================================


leaveSchema.pre(
"save",
function(next){


    if(
        this.startDate &&
        this.endDate
    )
    {


        const difference =

        this.endDate -
        this.startDate;


        this.totalDays =

        Math.floor(

            difference /
            (1000*60*60*24)

        ) + 1;


    }


    if(
        this.leaveCategory === "Unpaid"
    )
    {


        this.deductionAmount =
        this.totalDays;

    }


    next();

});


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Approve Leave

leaveSchema.methods.approve =
function(userId){


    this.approvalStatus =
    "Approved";


    this.finalApprovedBy =
    userId;


    this.finalApprovedAt =
    new Date();


    return this.save();

};


// Reject Leave

leaveSchema.methods.reject =
function(userId, reason=""){


    this.approvalStatus =
    "Rejected";


    this.finalApprovedBy =
    userId;


    this.notes =
    reason;


    return this.save();

};


// Cancel Leave

leaveSchema.methods.cancel =
function(userId, reason=""){


    this.isCancelled =
    true;


    this.approvalStatus =
    "Cancelled";


    this.cancelledBy =
    userId;


    this.cancelledAt =
    new Date();


    this.cancellationReason =
    reason;


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Employee Leave History


leaveSchema.statics.getEmployeeLeaves =
function(
    employeeId
){


    return this.find({


        employeeId,

        isDeleted:false

    })
    .sort({


        createdAt:-1

    });


};


// Monthly Leave Report


leaveSchema.statics.getMonthlyReport =
function(month,

    year

){


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


                _id:"$leaveType",

                totalDays:
                {

                    $sum:"$totalDays"
                }

            }

        }


    ]);


};


// Pending Approval List


leaveSchema.statics.getPendingLeaves =
function(){


    return this.find({
        approvalStatus:"Pending",

        isDeleted:false

    })
    .sort({


        createdAt:-1

    });


};


// ==========================================================
// QUERY HELPERS
// ==========================================================


leaveSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


leaveSchema.set(

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
    "Leave",
    leaveSchema
);