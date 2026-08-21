const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");


// ==========================================================
// Notification Schema
// ==========================================================


const notificationSchema = new mongoose.Schema(
{


branchId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"Branch",
    default:null,
    index:true
},


// ==========================================================
// Notification Identity
// ==========================================================


notificationNumber:{

    type:String,
    required:true,
    unique:true,
    trim:true,
    uppercase:true
},


notificationType:{

    type:String,
    enum:[

        "System",

        "Order",

        "Purchase",

        "Sales",

        "Payment",

        "Stock",

        "Employee",

        "Payroll",

        "Approval",

        "Security",

        "Promotion",

        "Reminder"

    ],
    required:true,
    index:true
},


// ==========================================================
// Notification Priority
// ==========================================================


priority:{

    type:String,
    enum:[

        "Low",

        "Medium",

        "High",

        "Critical"

    ],
    default:"Medium"
},


// ==========================================================
// Sender Information
// ==========================================================


senderId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    default:null
},


senderType:{

    type:String,
    enum:[

        "System",

        "Admin",

        "Employee",

        "Customer",

        "Vendor"

    ],
    default:"System"
},


// ==========================================================
// Receiver Information
// ==========================================================


receiverId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"AdminUser",
    required:true,
    index:true
},


receiverRole:{

    type:String,
    default:""
},


// ==========================================================
// Notification Content
// ==========================================================


title:{

    type:String,
    required:true,
    trim:true
},


message:{

    type:String,
    required:true
},


shortMessage:{

    type:String,
    default:""
},


// ==========================================================
// Related Document Reference
// ==========================================================


referenceType:{

    type:String,
    enum:[

        "Product",

        "StockMovement",

        "PurchaseOrder",

        "GRN",

        "PurchaseInvoice",

        "SalesOrder",

        "SalesInvoice",

        "Payment",

        "Employee",

        "Payroll",

        "Leave",

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
// Action Information
// ==========================================================


actionUrl:{

    type:String,
    default:""
},


actionType:{

    type:String,
    enum:[

        "View",

        "Approve",

        "Reject",

        "Pay",

        "Update",

        "None"

    ],

    default:"None"
},


// ==========================================================
// Delivery Channels
// ==========================================================


channels:[

{


    type:String,

    enum:[

        "App",

        "Web",

        "Email",

        "SMS",

        "Push"

    ]

}

],


// ==========================================================
// Read Status
// ==========================================================


isRead:{

    type:Boolean,
    default:false,
    index:true
},


readAt:{

    type:Date,
    default:null
},


// ==========================================================
// Push Notification
// ==========================================================


pushSent:{

    type:Boolean,
    default:false
},


pushSentAt:{

    type:Date,
    default:null
},


// ==========================================================
// Email Notification
// ==========================================================


emailSent:{

    type:Boolean,
    default:false
},


emailSentAt:{

    type:Date,
    default:null
},


// ==========================================================
// Expiry
// ==========================================================


expiresAt:{

    type:Date,
    default:null
},


// ==========================================================
// Status
// ==========================================================


status:{

    type:String,
    enum:[

        "Pending",

        "Sent",

        "Delivered",

        "Failed",

        "Cancelled"

    ],

    default:"Pending"

},


// ==========================================================
// Template Information
// ==========================================================


templateId:{

    type:mongoose.Schema.Types.ObjectId,
    ref:"NotificationTemplate",
    default:null
},


templateName:{

    type:String,
    default:""
},


// ==========================================================
// Scheduling
// ==========================================================


isScheduled:{

    type:Boolean,
    default:false
},


scheduledAt:{

    type:Date,
    default:null
},


sentAt:{

    type:Date,
    default:null
},


// ==========================================================
// Device Information
// ==========================================================


deviceToken:{

    type:String,
    default:""
},


platform:{

    type:String,
    enum:[

        "Android",

        "iOS",

        "Web",

        "Other"

    ],

    default:"Web"

},


// ==========================================================
// Extra Data
// ==========================================================


metadata:{

    type:Object,
    default:{}
},


attachments:[

{


    fileName:{

        type:String,
        default:""
    },


    fileUrl:{

        type:String,
        default:""
    }

}

],


// ==========================================================
// Audit Information
// ==========================================================


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


notificationSchema.index({


    receiverId:1,

    isRead:1,

    createdAt:-1

});


notificationSchema.index({ priority:1 });


notificationSchema.index({


    referenceType:1,

    referenceId:1

});


notificationSchema.index({ status:1 });


notificationSchema.index({ scheduledAt:1 });


notificationSchema.index({ expiresAt:1 });


// ==========================================================
// INSTANCE METHODS
// ==========================================================


// Mark As Read


notificationSchema.methods.markAsRead =
function()
{


    this.isRead=true;


    this.readAt=new Date();


    return this.save();

};


// Send Notification


notificationSchema.methods.markSent =
function()
{


    this.status="Sent";


    this.sentAt=new Date();


    return this.save();

};


// Mark Failed


notificationSchema.methods.markFailed =
function()
{


    this.status="Failed";


    return this.save();

};


// Cancel Notification


notificationSchema.methods.cancel =
function()
{


    this.status="Cancelled";


    return this.save();

};


// ==========================================================
// STATIC METHODS
// ==========================================================


// User Notifications


notificationSchema.statics.getUserNotifications =
function(receiverId)
{


    return this.find({


        receiverId,

        isDeleted:false

    })
    .sort({


        createdAt:-1

    });

};


// Unread Notifications


notificationSchema.statics.getUnread =
function(receiverId)
{


    return this.find({


        receiverId,


        isRead:false,


        isDeleted:false

    })
    .sort({


        createdAt:-1

    });

};


// All Notifications


notificationSchema.statics.getAllNotifications =
function()
{


    return this.find({
        isDeleted:false

    })
    .sort({


        createdAt:-1

    });

};


// Stock Alerts


notificationSchema.statics.getStockAlerts =
function()
{


    return this.find({
        notificationType:"Stock",


        isDeleted:false

    });

};


// ==========================================================
// QUERY HELPERS
// ==========================================================


notificationSchema.query.unread =
function()
{


    return this.where({


        isRead:false

    });

};


notificationSchema.query.highPriority =
function()
{


    return this.where({


        priority:{

            $in:[
                "High",
                "Critical"
            ]
        }

    });

};


// ==========================================================
// JSON CONFIG
// ==========================================================


notificationSchema.set(
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


notificationSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
    "Notification",
    notificationSchema
);


