const mongoose = require("mongoose");


// ==========================================================
// Salary Component Schema
// ==========================================================

const componentSchema = new mongoose.Schema(
{


    componentName:{

        type:String,
        required:true,
        trim:true
    },


    componentType:{

        type:String,
        enum:[
            "Earning",
            "Deduction"
        ],
        required:true
    },


    calculationType:{

        type:String,
        enum:[
            "Fixed Amount",
            "Percentage"
        ],
        default:"Fixed Amount"
    },


    amount:{

        type:Number,
        default:0
    },


    percentage:{

        type:Number,
        default:0
    },


    basedOn:{

        type:String,
        enum:[
            "Basic Salary",
            "Gross Salary",
            "Net Salary"
        ],
        default:"Basic Salary"
    },


    isTaxable:{

        type:Boolean,
        default:false
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
// Salary Structure Schema
// ==========================================================


const salaryStructureSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch"
},


// ==========================================================
// Structure Information
// ==========================================================


structureName:{

    type:String,
    required:true,
    trim:true
},


structureCode:{

    type:String,
    required:true,
    uppercase:true,
    trim:true
},


description:{

    type:String,
    default:""
},


// ==========================================================
// Applicable For
// ==========================================================


departmentId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Department"
},


designationId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Designation"
},


// ==========================================================
// Salary Amount
// ==========================================================


basicSalary:{

    type:Number,
    required:true,
    default:0
},


grossSalary:{

    type:Number,
    default:0
},


// ==========================================================
// Components
// ==========================================================


components:[
    componentSchema
],


// ==========================================================
// Employee Assignment
// ==========================================================


assignedEmployees:[

    {

        type:mongoose.Schema.Types.ObjectId,
        ref:"Employee"
    }

],


// ==========================================================
// Overtime Configuration
// ==========================================================


overtimeEnabled:{

    type:Boolean,
    default:true
},


overtimeCalculationType:{

    type:String,
    enum:[
        "Hourly Rate",
        "Fixed Amount",
        "Percentage"
    ],
    default:"Hourly Rate"
},


overtimeRate:{

    type:Number,
    default:0
},


// ==========================================================
// Bonus Configuration
// ==========================================================


bonusEnabled:{

    type:Boolean,
    default:false
},


bonusType:{

    type:String,
    enum:[
        "Fixed Amount",
        "Percentage",
        "Performance Based"
    ]
},


bonusAmount:{

    type:Number,
    default:0
},


bonusPercentage:{

    type:Number,
    default:0
},


// ==========================================================
// Tax Configuration
// ==========================================================


taxApplicable:{

    type:Boolean,
    default:false
},


taxType:{

    type:String,
    enum:[
        "Fixed Amount",
        "Percentage",
        "Government Rule"
    ]
},


taxAmount:{

    type:Number,
    default:0
},


taxPercentage:{

    type:Number,
    default:0
},


// ==========================================================
// Working Rule
// ==========================================================


workingDaysPerMonth:{

    type:Number,
    default:26
},


workingHoursPerDay:{

    type:Number,
    default:8
},


weeklyHoliday:{

    type:Number,
    default:1
},


// ==========================================================
// Effective Date
// ==========================================================


effectiveFrom:{

    type:Date,
    required:true
},


effectiveTo:{

    type:Date
},


isCurrent:{

    type:Boolean,
    default:true
},


// ==========================================================
// Revision History
// ==========================================================


previousStructureId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalaryStructure"
},


revisionReason:{

    type:String,
    default:""
},


revisionDate:{

    type:Date
},


// ==========================================================
// Approval
// ==========================================================


approvalStatus:{

    type:String,
    enum:[
        "Draft",
        "Pending",
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


// Unique structure per company

salaryStructureSchema.index({ structureCode:1 }, {

    unique:true
});


salaryStructureSchema.index({ isCurrent:1 });


salaryStructureSchema.index({


    departmentId:1,

    designationId:1

});


salaryStructureSchema.index({


    effectiveFrom:1,

    effectiveTo:1

});


salaryStructureSchema.index({ approvalStatus:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Calculate Gross Salary


salaryStructureSchema.methods.calculateGrossSalary =
function(){


    let total = this.basicSalary;


    this.components.forEach(
    component=>{


        if(
            component.componentType === "Earning"
        )
        {


            if(
                component.calculationType ===
                "Fixed Amount"
            )
            {


                total += component.amount;

            }


            else if(
                component.calculationType ===
                "Percentage"
            )
            {


                total +=

                (
                    this.basicSalary *
                    component.percentage
                )
                /
                100;

            }


        }


    });


    this.grossSalary = total;


    return total;


};


// Calculate Component Amount


salaryStructureSchema.methods.getComponentAmount =
function(componentName){


    const component =

    this.components.find(

        item =>
        item.componentName === componentName

    );


    if(!component)
        return 0;


    if(
        component.calculationType ===
        "Fixed Amount"
    )
    {


        return component.amount;

    }


    return (

        this.basicSalary *
        component.percentage

    )
    /
    100;


};


// ==========================================================
// STATIC METHODS
// ==========================================================


// Get Current Salary Structure


salaryStructureSchema.statics.getCurrentStructure =
function(employeeId
){


    return this.findOne({
        assignedEmployees:
        {

            $in:[
                employeeId
            ]
        },

        isCurrent:true,

        isDeleted:false

    });


};


// Department Based Salary Structure


salaryStructureSchema.statics.getDepartmentStructure =
function(departmentId
){


    return this.find({
        departmentId,

        isCurrent:true,

        isDeleted:false

    });


};


// ==========================================================
// QUERY HELPERS
// ==========================================================


salaryStructureSchema.query.active =
function(){


    return this.where({


        isDeleted:false,

        isCurrent:true

    });


};


// ==========================================================
// JSON CONFIG
// ==========================================================


salaryStructureSchema.set(

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

    "SalaryStructure",

    salaryStructureSchema

);