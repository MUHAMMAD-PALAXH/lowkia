const mongoose = require("mongoose");



// ==========================================================
// Activity Log Schema
// ==========================================================


const activityLogSchema = new mongoose.Schema(
{


// ==========================================================
// Company & Branch
// ==========================================================


companyId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Company",
    required:true,
    index:true
},



branchId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null,
    index:true
},






// ==========================================================
// User Information
// ==========================================================


userId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    required:true,
    index:true
},



userRole:{
    type:String,
    default:""
},



userName:{
    type:String,
    default:""
},



userEmail:{
    type:String,
    default:""
},






// ==========================================================
// Activity Identity
// ==========================================================


activityNumber:{
    type:String,
    required:true,
    unique:true,
    trim:true,
    uppercase:true
},



activityType:{
    type:String,
    enum:[


        "Create",

        "Update",

        "Delete",

        "View",

        "Login",

        "Logout",

        "Approve",

        "Reject",

        "Cancel",

        "Export",

        "Import",

        "Payment",

        "Adjustment",

        "Transfer"


    ],

    required:true,

    index:true
},






// ==========================================================
// Module Information
// ==========================================================


module:{
    type:String,
    enum:[


        "Product",

        "Category",

        "Brand",

        "Customer",

        "Supplier",

        "Purchase",

        "Sales",

        "Inventory",

        "Warehouse",

        "Stock",

        "Payment",

        "Expense",

        "Payroll",

        "Employee",

        "Account",

        "Settings",

        "User",

        "System"


    ],

    required:true,

    index:true
},



subModule:{
    type:String,
    default:""
},






// ==========================================================
// Description
// ==========================================================


description:{
    type:String,
    required:true
},



shortDescription:{
    type:String,
    default:""
},






// ==========================================================
// Reference Document
// ==========================================================


referenceType:{
    type:String,
    enum:[


        "Product",

        "Customer",

        "Supplier",

        "PurchaseOrder",

        "PurchaseInvoice",

        "SalesOrder",

        "SalesInvoice",

        "StockMovement",

        "Payment",

        "Employee",

        "User",

        "System"


    ],

    default:"System"

},



referenceId:{
    type:mongoose.Schema.Types.ObjectId,
    default:null,
    index:true
},






// ==========================================================
// Change Tracking
// ==========================================================


oldData:{
    type:Object,
    default:null
},



newData:{
    type:Object,
    default:null
},



changedFields:[

{

    type:String

}

],






// ==========================================================
// Request Information
// ==========================================================


ipAddress:{
    type:String,
    default:""
},



userAgent:{
    type:String,
    default:""
},



deviceInfo:{
    type:String,
    default:""
},



location:{
    latitude:{
        type:String,
        default:""
    },


    longitude:{
        type:String,
        default:""
    }

},






// ==========================================================
// Security Information
// ==========================================================


loginSessionId:{
    type:String,
    default:""
},



securityLevel:{
    type:String,
    enum:[

        "Normal",

        "Sensitive",

        "Critical"

    ],

    default:"Normal"

},






// ==========================================================
// Status
// ==========================================================


status:{
    type:String,
    enum:[

        "Success",

        "Failed",

        "Warning"

    ],

    default:"Success"

},



errorMessage:{
    type:String,
    default:""
},






// ==========================================================
// Audit Information
// ==========================================================


createdBy:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},






// ==========================================================
// Extra Data
// ==========================================================


metadata:{
    type:Object,
    default:{}
},






// ==========================================================
// Soft Delete
// ==========================================================


isDeleted:{
    type:Boolean,
    default:false
},



deletedAt:{
    type:Date,
    default:null
},



deletedBy:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},



},
{
    timestamps:true,
    versionKey:false
});








// ==========================================================
// DATABASE INDEXES
// ==========================================================



activityLogSchema.index(
{
    companyId:1,
    activityNumber:1
},
{
    unique:true
});



activityLogSchema.index({

    userId:1,

    createdAt:-1

});



activityLogSchema.index({

    module:1,

    activityType:1

});



activityLogSchema.index({

    referenceType:1,

    referenceId:1

});



activityLogSchema.index({

    companyId:1,

    module:1,

    createdAt:-1

});



activityLogSchema.index({

    status:1

});








// ==========================================================
// INSTANCE METHODS
// ==========================================================



// Mark Failed Activity


activityLogSchema.methods.markFailed =
function(error)
{

    this.status="Failed";


    this.errorMessage=error;


    return this.save();

};







// Add Changed Field


activityLogSchema.methods.addChangedField =
function(field)
{

    this.changedFields.push(field);


    return this;

};








// ==========================================================
// STATIC METHODS
// ==========================================================



// User Activity History


activityLogSchema.statics.getUserActivity =
function(userId)
{

    return this.find({

        userId,

        isDeleted:false

    })
    .sort({

        createdAt:-1

    });

};







// Module Activity History


activityLogSchema.statics.getModuleActivity =
function(module)
{

    return this.find({

        module,

        isDeleted:false

    })
    .sort({

        createdAt:-1

    });

};







// Reference History


activityLogSchema.statics.getReferenceHistory =
function(
    referenceType,
    referenceId
)
{

    return this.find({

        referenceType,

        referenceId,

        isDeleted:false

    })
    .sort({

        createdAt:-1

    });

};







// Login History


activityLogSchema.statics.getLoginHistory =
function(userId)
{

    return this.find({

        userId,

        activityType:{
            $in:[
                "Login",
                "Logout"
            ]
        }

    })
    .sort({

        createdAt:-1

    });

};








// ==========================================================
// QUERY HELPERS
// ==========================================================


activityLogSchema.query.success =
function()
{

    return this.where({

        status:"Success"

    });

};






activityLogSchema.query.failed =
function()
{

    return this.where({

        status:"Failed"

    });

};






activityLogSchema.query.recent =
function()
{

    return this.sort({

        createdAt:-1

    });

};








// ==========================================================
// JSON CONFIG
// ==========================================================


activityLogSchema.set(
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
    "ActivityLog",
    activityLogSchema
);