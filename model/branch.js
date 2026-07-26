const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
{

        // Branch Code

    branchCode:{

        type:String,
        required:true,
        unique:true,
        trim:true,
        uppercase:true
    },

    // Basic

    name:{

        type:String,
        required:true,
        trim:true
    },

    email:{

        type:String,
        default:"",
        lowercase:true,
        trim:true
    },

    phone:{

        type:String,
        default:"",
        trim:true
    },

    // Manager

    managerId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },

    // Address

    country:{

        type:String,
        default:"Bangladesh"
    },

    city:{

        type:String,
        required:true
    },

    address:{

        type:String,
        default:""
    },

    postalCode:{

        type:String,
        default:""
    },

    // Status

    status:{

        type:String,
        enum:[
            "Active",
            "Inactive"
        ],
        default:"Active"
    },

    // Head Office

    isHeadOffice:{

        type:Boolean,
        default:false
    },

    // Description

    description:{

        type:String,
        default:""
    },

    // Audit

    createdBy:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },

    updatedBy:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"AdminUser",
        default:null
    },

    isDeleted:{

        type:Boolean,
        default:false
    }

},
{

    timestamps:true,
    versionKey:false
});

branchSchema.index({ name:1 });

branchSchema.index({ managerId:1 });

module.exports=mongoose.model(
    "Branch",
    branchSchema
);