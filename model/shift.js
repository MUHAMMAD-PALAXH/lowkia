const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
{

    // Shift Information
    // =====================================================

    shiftCode: {

        type: String,
        required: true,
        uppercase: true,
        trim: true
    },

    shiftName: {

        type: String,
        required: true,
        trim: true
    },

    description: {

        type: String,
        default: ""
    },

    // =====================================================
    // Working Time
    // =====================================================

    startTime: {

        type: String,       // Example: "09:00"
        required: true
    },

    endTime: {

        type: String,       // Example: "18:00"
        required: true
    },

    breakStartTime: {

        type: String,
        default: null
    },

    breakEndTime: {

        type: String,
        default: null
    },

    workingHours: {

        type: Number,
        default: 8
    },

    // =====================================================
    // Attendance Rules
    // =====================================================

    lateGraceMinutes: {

        type: Number,
        default: 10
    },

    earlyLeaveGraceMinutes: {

        type: Number,
        default: 10
    },

    overtimeAfterMinutes: {

        type: Number,
        default: 30
    },

    minimumWorkingMinutes: {

        type: Number,
        default: 480
    },

    // =====================================================
    // Shift Type
    // =====================================================

    shiftType: {

        type: String,
        enum: [
            "Regular",
            "Night",
            "Rotational",
            "Flexible"
        ],
        default: "Regular"
    },

    weeklyOff: [{

        type: String,
        enum: [
            "Saturday",
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday"
        ]
    }],

    employeeCount: {

        type: Number,
        default: 0
    },

    status: {

        type: String,
        enum: [
            "Active",
            "Inactive"
        ],
        default: "Active"
    },

    // =====================================================
    // Audit
    // =====================================================

    createdBy: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        required: true
    },

    updatedBy: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser"
    },

    deletedBy: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser"
    },

    isDeleted: {

        type: Boolean,
        default: false
    },

    deletedAt: {

        type: Date,
        default: null
    }

},
{

    timestamps: true,
    versionKey: false
});

shiftSchema.index({ shiftCode:1 }, {

    unique:true
});

shiftSchema.index({ shiftName:1 }, {

    unique:true
});

shiftSchema.index({

    shiftName:"text",
    description:"text"
});

module.exports = mongoose.model(
    "Shift",
    shiftSchema
);