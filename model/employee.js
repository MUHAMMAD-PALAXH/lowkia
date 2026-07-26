const mongoose = require("mongoose");

const emergencyContactSchema = new mongoose.Schema(
{
    name:{
        type:String,
        trim:true
    },

    relationship:{
        type:String,
        trim:true
    },

    phone:{
        type:String,
        trim:true
    }

},
{
    _id:false
});



const bankInformationSchema=new mongoose.Schema(
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

    routingNumber:{
        type:String,
        default:""
    },

    mobileBankName:{
        type:String,
        default:""
    },

    mobileAccount:{
        type:String,
        default:""
    }

},
{
    _id:false
});



const leaveBalanceSchema=new mongoose.Schema(
{
    casual:{
        type:Number,
        default:10
    },

    sick:{
        type:Number,
        default:14
    },

    annual:{
        type:Number,
        default:20
    },

    unpaid:{
        type:Number,
        default:9999
    }

},
{
    _id:false
});



const employeeSchema=new mongoose.Schema(
{

// ===================================================
// Company
// ===================================================

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
// Login User
// ===================================================

userId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    required:true,
    unique:true
},

// ===================================================
// Employee
// ===================================================

employeeCode:{
    type:String,
    required:true,
    uppercase:true,
    trim:true
},

firstName:{
    type:String,
    required:true,
    trim:true
},

lastName:{
    type:String,
    required:true,
    trim:true
},

fullName:{
    type:String,
    default:""
},

email:{
    type:String,
    lowercase:true,
    trim:true
},

phone:{
    type:String,
    required:true
},

alternatePhone:{
    type:String,
    default:""
},

photo:{
    type:String,
    default:""
},

gender:{
    type:String,
    enum:[
        "Male",
        "Female",
        "Other"
    ]
},

dateOfBirth:{
    type:Date
},

bloodGroup:{
    type:String,
    enum:[
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-"
    ]
},

maritalStatus:{
    type:String,
    enum:[
        "Single",
        "Married",
        "Divorced",
        "Widowed"
    ],
    default:"Single"
},

nationality:{
    type:String,
    default:"Bangladesh"
},

religion:{
    type:String,
    default:""
},

nidNumber:{
    type:String,
    default:""
},

passportNumber:{
    type:String,
    default:""
},

tinNumber:{
    type:String,
    default:""
},

drivingLicense:{
    type:String,
    default:""
},

presentAddress:{
    type:String,
    default:""
},

permanentAddress:{
    type:String,
    default:""
},

// ===================================================
// Employment Information
// ===================================================

joiningDate:{
    type:Date,
    required:true
},

confirmationDate:{
    type:Date
},

probationEndDate:{
    type:Date
},

employmentType:{
    type:String,
    enum:[
        "Permanent",
        "Contract",
        "Part Time",
        "Intern",
        "Temporary"
    ],
    default:"Permanent"
},

employmentStatus:{
    type:String,
    enum:[
        "Active",
        "On Leave",
        "Suspended",
        "Resigned",
        "Terminated"
    ],
    default:"Active"
},

reportingManager:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Employee"
},

// ===================================================
// Salary
// ===================================================

salaryType:{
    type:String,
    enum:[
        "Monthly",
        "Daily",
        "Hourly"
    ],
    default:"Monthly"
},

basicSalary:{
    type:Number,
    default:0
},

houseRent:{
    type:Number,
    default:0
},

medicalAllowance:{
    type:Number,
    default:0
},

transportAllowance:{
    type:Number,
    default:0
},

foodAllowance:{
    type:Number,
    default:0
},

otherAllowance:{
    type:Number,
    default:0
},

hourlyRate:{
    type:Number,
    default:0
},

overtimeRate:{
    type:Number,
    default:0
},

// ===================================================
// Attendance Device
// ===================================================

biometricId:{
    type:String,
    default:""
},

rfidCard:{
    type:String,
    default:""
},

faceId:{
    type:String,
    default:""
},

deviceEmployeeId:{
    type:String,
    default:""
},

// ===================================================
// Leave
// ===================================================

leaveBalance:{
    type:leaveBalanceSchema,
    default:()=>({})
},

// ===================================================
// Bank
// ===================================================

bankInformation:{
    type:bankInformationSchema,
    default:()=>({})
},

// ===================================================
// Emergency Contact
// ===================================================

emergencyContact:{
    type:emergencyContactSchema,
    default:()=>({})
},

// ===================================================
// Documents
// ===================================================

resume:{
    type:String,
    default:""
},

offerLetter:{
    type:String,
    default:""
},

joiningLetter:{
    type:String,
    default:""
},

contractFile:{
    type:String,
    default:""
},

nidFront:{
    type:String,
    default:""
},

nidBack:{
    type:String,
    default:""
},

passportFile:{
    type:String,
    default:""
},

profileDocuments:[
    {
        title:String,
        file:String
    }
],

// ===================================================
// System
// ===================================================

remarks:{
    type:String,
    default:""
},

isActive:{
    type:Boolean,
    default:true
},

isDeleted:{
    type:Boolean,
    default:false
},

deletedAt:{
    type:Date
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

lastAttendance:{
    type:Date
},

lastPayrollDate:{
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

employeeSchema.index({
    companyId: 1,
    employeeCode: 1
}, {
    unique: true
});

employeeSchema.index({
    companyId: 1,
    branchId: 1
});

employeeSchema.index({
    companyId: 1,
    departmentId: 1
});

employeeSchema.index({
    companyId: 1,
    designationId: 1
});

employeeSchema.index({
    companyId: 1,
    employmentStatus: 1
});

employeeSchema.index({
    companyId: 1,
    phone: 1
});

employeeSchema.index({
    companyId: 1,
    email: 1
});

employeeSchema.index({
    reportingManager: 1
});



// ==========================================================
// VIRTUAL
// ==========================================================

employeeSchema.virtual("name").get(function () {

    return `${this.firstName} ${this.lastName}`;

});



// ==========================================================
// PRE SAVE
// ==========================================================

employeeSchema.pre("save", function (next) {

    this.fullName = `${this.firstName} ${this.lastName}`;

    next();

});



// ==========================================================
// INSTANCE METHODS
// ==========================================================

employeeSchema.methods.getGrossSalary = function () {

    return (

        this.basicSalary +

        this.houseRent +

        this.medicalAllowance +

        this.transportAllowance +

        this.foodAllowance +

        this.otherAllowance

    );

};



employeeSchema.methods.isCurrentlyActive = function () {

    return (

        this.isActive &&

        !this.isDeleted &&

        this.employmentStatus === "Active"

    );

};



// ==========================================================
// STATIC METHODS
// ==========================================================

employeeSchema.statics.findActiveEmployees = function (companyId) {

    return this.find({

        companyId,

        isDeleted: false,

        isActive: true,

        employmentStatus: "Active"

    });

};



employeeSchema.statics.findByBranch = function (

    companyId,

    branchId

) {

    return this.find({

        companyId,

        branchId,

        isDeleted: false

    });

};



employeeSchema.statics.findByDepartment = function (

    companyId,

    departmentId

) {

    return this.find({

        companyId,

        departmentId,

        isDeleted: false

    });

};



// ==========================================================
// QUERY HELPER
// ==========================================================

employeeSchema.query.active = function () {

    return this.where({

        isDeleted: false,

        isActive: true

    });

};



// ==========================================================
// TO JSON
// ==========================================================

employeeSchema.set("toJSON", {

    virtuals: true,

    transform: function (doc, ret) {

        delete ret.__v;

        return ret;

    }

});



// ==========================================================
// EXPORT
// ==========================================================

module.exports = mongoose.model(
    "Employee",
    employeeSchema
);