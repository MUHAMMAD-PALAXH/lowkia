const mongoose = require("mongoose");

const repairItemSchema = new mongoose.Schema(
{

    productId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
        default:null
    },

    productVariantId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"ProductVariant",
        default:null
    },

    productName:{

        type:String,
        required:true
    },

    brand:{

        type:String,
        default:""
    },

    model:{

        type:String,
        default:""
    },

    category:{

        type:String,
        default:""
    },

    serialNumber:{

        type:String,
        default:"",
        uppercase:true
    },

    imei1:{

        type:String,
        default:"",
        uppercase:true
    },

    imei2:{

        type:String,
        default:"",
        uppercase:true
    },

    color:{

        type:String,
        default:""
    },

    accessories:[
        {

            type:String
        }
    ],

    problemDescription:{

        type:String,
        required:true
    },

    technicianRemark:{

        type:String,
        default:""
    }

},
{

    _id:false
});


const repairTicketSchema = new mongoose.Schema(
{

companyId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Company",
    default:null,
    index:true
},

branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    required:true,
    index:true
},


// ======================================================
// Ticket Information
// ======================================================

ticketNumber:{

    type:String,
    required:true,
    unique:true,
    uppercase:true,
    trim:true
},

receivedDate:{

    type:Date,
    default:Date.now
},

expectedDeliveryDate:{

    type:Date,
    default:null
},

completedDate:{

    type:Date,
    default:null
},

pickupDate:{

    type:Date,
    default:null
},


// ======================================================
// Customer Information
// ======================================================

customerId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Customer",
    default:null
},

customerName:{

    type:String,
    required:true
},

phone:{

    type:String,
    required:true
},

alternatePhone:{

    type:String,
    default:""
},

email:{

    type:String,
    default:""
},

address:{

    type:String,
    default:""
},


// ======================================================
// Device Information
// ======================================================

device:repairItemSchema,


// ======================================================
// Ticket Source & Tracking
// ======================================================

ticketSource:{

    type:String,
    enum:[
        "NewRepair",
        "ExistingProduct"
    ],
    default:"NewRepair",
    index:true
},

trackingType:{

    type:String,
    enum:[
        "IMEI",
        "Non-IMEI"
    ],
    default:"Non-IMEI"
},

repairCode:{

    type:String,
    default:"",
    trim:true,
    index:true
},

barcode:{

    type:String,
    default:"",
    trim:true,
    index:true
},

serviceDetails:{

    type:String,
    default:""
},

paymentMethod:{

    type:String,
    enum:[
        "Advance",
        "Partial",
        "CashOnDelivery",
        "Bank"
    ],
    default:"Advance"
},

warrantyChecked:{

    type:Boolean,
    default:false
},

itemTrackId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"ItemTrack",
    default:null
},

sourceSalesOrderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"SalesOrder",
    default:null
},


// ======================================================
// Warranty
// ======================================================

isWarranty:{

    type:Boolean,
    default:false
},

warrantyType:{

    type:String,
    enum:[
        "Manufacturer",
        "Shop",
        "Extended",
        "No Warranty"
    ],
    default:"No Warranty"
},

warrantyExpiry:{

    type:Date,
    default:null
},


// ======================================================
// Repair Details
// ======================================================

serviceType:{

    type:String,
    enum:[
        "Hardware",
        "Software",
        "Screen Replacement",
        "Battery Replacement",
        "Water Damage",
        "Unlock",
        "Board Repair",
        "General Service",
        "Other"
    ],
    default:"General Service"
},

priority:{

    type:String,
    enum:[
        "Low",
        "Normal",
        "High",
        "Urgent"
    ],
    default:"Normal"
},

status:{

    type:String,
    enum:[
        "Pending",
        "Diagnosing",
        "Waiting For Approval",
        "Waiting For Parts",
        "Repairing",
        "Quality Check",
        "Ready For Pickup",
        "Completed",
        "Delivered",
        "Cancelled"
    ],
    default:"Pending",
    index:true
},


// ======================================================
// Technician
// ======================================================

assignedTechnician:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},

diagnosis:{

    type:String,
    default:""
},

repairSolution:{

    type:String,
    default:""
},

internalNote:{

    type:String,
    default:""
},


// ======================================================
// Pricing
// ======================================================

diagnosisCharge:{

    type:Number,
    default:0
},

serviceCharge:{

    type:Number,
    default:0
},

partsCost:{

    type:Number,
    default:0
},

laborCost:{

    type:Number,
    default:0
},

discount:{

    type:Number,
    default:0
},

tax:{

    type:Number,
    default:0
},

otherCharges:{

    type:Number,
    default:0
},

totalAmount:{

    type:Number,
    default:0
},

paidAmount:{

    type:Number,
    default:0
},

dueAmount:{

    type:Number,
    default:0
},

paymentStatus:{

    type:String,
    enum:[
        "Unpaid",
        "Partial",
        "Paid"
    ],
    default:"Unpaid"
},


// ======================================================
// Spare Parts Used
// ======================================================

usedParts:[
{


    productId:{

        type:mongoose.Schema.Types.ObjectId,
        ref:"Product"
    },

    productName:String,

    quantity:Number,

    unitPrice:Number,

    total:Number

}
],


// ======================================================
// Approval
// ======================================================

customerApproved:{

    type:Boolean,
    default:false
},

approvalDate:{

    type:Date,
    default:null
},

approvalMethod:{

    type:String,
    enum:[
        "Phone",
        "SMS",
        "WhatsApp",
        "Email",
        "In Person"
    ],
    default:"Phone"
},


// ======================================================
// Delivery
// ======================================================

deliveredBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},

receivedByCustomer:{

    type:String,
    default:""
},

customerSignature:{

    type:String,
    default:""
},


// ======================================================
// Attachments
// ======================================================

attachments:[
{


    fileName:String,

    fileUrl:String,

    uploadedAt:{

        type:Date,
        default:Date.now
    }

}
],


// ======================================================
// Audit
// ======================================================

createdBy:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    required:true
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


// ======================================================
// INDEXES
repairTicketSchema.index({phone:1});
repairTicketSchema.index({customerId:1});
repairTicketSchema.index({assignedTechnician:1});
repairTicketSchema.index({receivedDate:-1});
repairTicketSchema.index({expectedDeliveryDate:1});
repairTicketSchema.index({pickupDate:1});
repairTicketSchema.index({companyId:1,receivedDate:-1});
repairTicketSchema.index({companyId:1,branchId:1,status:1,receivedDate:-1});


module.exports = mongoose.model("RepairTicket",repairTicketSchema);