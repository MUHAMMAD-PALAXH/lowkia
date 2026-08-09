const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
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

designationId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Designation"
},

shiftId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Shift"
},

// ===================================================
// Employee Reference
// ===================================================

employeeId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Employee",
    required:true,
    index:true
},

userId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},

// ===================================================
// Snapshot
// ===================================================

employeeCode:{

    type:String,
    required:true
},

employeeName:{

    type:String,
    required:true
},

branchName:{

    type:String,
    default:""
},

departmentName:{

    type:String,
    default:""
},

designationName:{

    type:String,
    default:""
},

shiftName:{

    type:String,
    default:""
},

// ===================================================
// Attendance Date
// ===================================================

attendanceDate:{

    type:Date,
    required:true
},

dayName:{

    type:String,
    default:""
},

month:{

    type:Number
},

year:{

    type:Number
},

// ===================================================
// Check In
// ===================================================

checkIn:{

    type:Date
},

checkOut:{

    type:Date
},

/**
 * Workday key in company timezone (YYYY-MM-DD).
 * Used with attendanceDate (UTC start-of-day) for night shifts.
 */
workDate:{

    type:String,
    default:"",
    index:true
},

policyId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AttendancePolicy",
    default:null
},

attendanceCode:{

    type:String,
    default:"",
    trim:true,
    uppercase:true
},

// ===================================================
// Breaks
// ===================================================

breaks:[
    {
        startTime:{ type:Date, required:true },
        endTime:{ type:Date, default:null },
        durationMinutes:{ type:Number, default:0 },
        type:{
            type:String,
            enum:["lunch","prayer","personal","other"],
            default:"other"
        }
    }
],

checkInSelfie:{ type:String, default:"" },
checkOutSelfie:{ type:String, default:"" },

checkInPlatform:{ type:String, default:"" },
checkOutPlatform:{ type:String, default:"" },
checkInAppVersion:{ type:String, default:"" },
checkOutAppVersion:{ type:String, default:"" },

checkOutLatitude:{ type:Number },
checkOutLongitude:{ type:Number },
checkOutIpAddress:{ type:String, default:"" },
checkOutDeviceId:{ type:String, default:"" },

grossWorkedMinutes:{ type:Number, default:0 },
actualWorkedMinutes:{ type:Number, default:0 },
approvedOvertimeMinutes:{ type:Number, default:0 },

// ===================================================
// Attendance Status
// ===================================================

attendanceStatus:{

    type:String,
    enum:[
        "Present",
        "Absent",
        "Late",
        "Half Day",
        "Leave",
        "Holiday",
        "Weekend",
        "Incomplete",
        "Remote",
        "Work From Home"
    ],
    default:"Present"
},

checkInStatus:{

    type:String,
    enum:[
        "On Time",
        "Late",
        "Manual",
        "Biometric",
        "Face Scan",
        "RFID",
        "QR Code",
        "Mobile App"
    ],
    default:"On Time"
},

checkOutStatus:{

    type:String,
    enum:[
        "Completed",
        "Early Leave",
        "Overtime",
        "Manual"
    ],
    default:"Completed"
},

// ===================================================
// Working Time
// ===================================================

scheduledIn:{

    type:Date
},

scheduledOut:{

    type:Date
},

workingMinutes:{

    type:Number,
    default:0
},

workingHours:{

    type:Number,
    default:0
},

breakMinutes:{

    type:Number,
    default:0
},

lateMinutes:{

    type:Number,
    default:0
},

earlyLeaveMinutes:{

    type:Number,
    default:0
},

overtimeMinutes:{

    type:Number,
    default:0
},

overtimeHours:{

    type:Number,
    default:0
},

// ===================================================
// Attendance Source
// ===================================================

attendanceSource:{

    type:String,
    enum:[
        "Biometric",
        "Face Recognition",
        "RFID Card",
        "QR Code",
        "Mobile App",
        "Web Panel",
        "Manual"
    ],
    default:"Manual"
},

deviceName:{

    type:String,
    default:""
},

deviceId:{

    type:String,
    default:""
},

terminalId:{

    type:String,
    default:""
},

// ===================================================
// Location
// ===================================================

latitude:{

    type:Number
},

longitude:{

    type:Number
},

locationName:{

    type:String,
    default:""
},

ipAddress:{

    type:String,
    default:""
},

// ===================================================
// Shift Validation
// ===================================================

isLate:{

    type:Boolean,
    default:false
},

leftEarly:{

    type:Boolean,
    default:false
},

isOvertime:{

    type:Boolean,
    default:false
},

isHoliday:{

    type:Boolean,
    default:false
},

isWeekend:{

    type:Boolean,
    default:false
},

isLeave:{

    type:Boolean,
    default:false
},

// ===================================================
// Approval
// ===================================================

isApproved:{

    type:Boolean,
    default:true
},

approvedBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser"
},

approvedAt:{

    type:Date
},

approvalRemarks:{

    type:String,
    default:""
},

// ===================================================
// Notes
// ===================================================

employeeRemarks:{

    type:String,
    default:""
},

managerRemarks:{

    type:String,
    default:""
},

hrRemarks:{

    type:String,
    default:""
},

// ===================================================
// Payroll Integration
// ===================================================

payrollProcessed:{

    type:Boolean,
    default:false
},

payrollId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Payroll"
},

// ===================================================
// Audit
// ===================================================

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
}

},
{

    timestamps:true,
    versionKey:false
});

// ==========================================================
// INDEXES
// ==========================================================

// One employee cannot have duplicate attendance for same workday
attendanceSchema.index({ employeeId:1,
    attendanceDate:1
 }, {

    unique:true
});

attendanceSchema.index(
    { employeeId: 1, workDate: 1 },
    {
        unique: true,
        partialFilterExpression: {
            workDate: { $exists: true, $gt: "" },
            isDeleted: { $ne: true }
        }
    }
);


attendanceSchema.index({ branchId:1,
    attendanceDate:1
 });


attendanceSchema.index({ departmentId:1,
    attendanceDate:1
 });


attendanceSchema.index({

    employeeId:1,
    attendanceStatus:1
});


attendanceSchema.index({ attendanceDate:1 });


attendanceSchema.index({

    month:1,
    year:1
});


attendanceSchema.index({ payrollProcessed:1 });


// ==========================================================
// VIRTUALS
// ==========================================================

attendanceSchema.virtual("totalWorkingTime").get(function(){


    if(!this.checkIn || !this.checkOut)
        return 0;


    const difference =
        this.checkOut - this.checkIn;


    return Math.floor(
        difference / (1000 * 60)
    );

});


// ==========================================================
// PRE SAVE HOOK
// ==========================================================

attendanceSchema.pre(
"save",
function(next){


    if(this.attendanceDate)
    {


        const date =
        new Date(this.attendanceDate);


        this.dayName =
        date.toLocaleDateString(
            "en-US",
            {

                weekday:"long"
            }
        );


        this.month =
        date.getMonth()+1;


        this.year =
        date.getFullYear();

    }


    if(
        this.lateMinutes > 0
    )
    {

        this.isLate=true;
    }


    if(
        this.overtimeMinutes > 0
    )
    {

        this.isOvertime=true;
    }


    if(
        this.earlyLeaveMinutes > 0
    )
    {

        this.leftEarly=true;
    }


    next();

});


// ==========================================================
// INSTANCE METHODS
// ==========================================================


attendanceSchema.methods.calculateWorkingHours =
function(){


    if(
        !this.checkIn ||
        !this.checkOut
    )
    {

        return 0;
    }


    const minutes =
    Math.floor(
        (
            this.checkOut -
            this.checkIn
        )
        /
        (1000*60)
    );


    this.workingMinutes =
    minutes -
    this.breakMinutes;


    this.workingHours =
    Number(
        (
            this.workingMinutes / 60
        )
        .toFixed(2)
    );


    return this.workingHours;

};


// ==========================================================
// STATIC METHODS
// ==========================================================


attendanceSchema.statics.getEmployeeMonthlyAttendance =
function(
    employeeId,
    month,
    year
){


    return this.find({


        employeeId,

        month,

        year,

        isDeleted:false

    })
    .sort({

        attendanceDate:1
    });

};


attendanceSchema.statics.getBranchAttendance =
function(
    branchId,
    date
){


    return this.find({


        branchId,

        attendanceDate:date,

        isDeleted:false

    });

};


attendanceSchema.statics.getMonthlySummary =
async function(month,
    year
){


    return this.aggregate([

        {

            $match:
            {
                month,
                year,
                isDeleted:false
            }
        },


        {

            $group:
            {


                _id:"$attendanceStatus",

                total:
                {

                    $sum:1
                }

            }

        }

    ]);

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


attendanceSchema.query.active =
function(){


    return this.where({


        isDeleted:false

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


attendanceSchema.set(
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
    "Attendance",
    attendanceSchema
);