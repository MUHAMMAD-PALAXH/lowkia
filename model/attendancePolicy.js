const mongoose = require("mongoose");

/**
 * Company-level attendance rules.
 * Shift still owns day start/end; policy owns global toggles & thresholds.
 */
const attendancePolicySchema = new mongoose.Schema(
    {
        policyCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
        },

        policyName: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            default: ""
        },

        isDefault: {
            type: Boolean,
            default: false,
            index: true
        },

        // Optional defaults when employee has no shift (fallback only)
        officeStartTime: {
            type: String,
            default: "09:00"
        },

        officeEndTime: {
            type: String,
            default: "18:00"
        },

        gracePeriodMinutes: {
            type: Number,
            default: 10,
            min: 0
        },

        standardBreakMinutes: {
            type: Number,
            default: 60,
            min: 0
        },

        minimumWorkingMinutes: {
            type: Number,
            default: 480,
            min: 0
        },

        halfDayThresholdMinutes: {
            type: Number,
            default: 240,
            min: 0
        },

        lateThresholdMinutes: {
            type: Number,
            default: 0,
            min: 0
        },

        earlyLeaveThresholdMinutes: {
            type: Number,
            default: 0,
            min: 0
        },

        overtimeEnabled: {
            type: Boolean,
            default: true
        },

        overtimeRequiresApproval: {
            type: Boolean,
            default: true
        },

        overtimeAfterMinutes: {
            type: Number,
            default: 30,
            min: 0
        },

        locationRequired: {
            type: Boolean,
            default: false
        },

        selfieRequired: {
            type: Boolean,
            default: false
        },

        allowCheckInOnLeave: {
            type: Boolean,
            default: false
        },

        allowCheckInOnHoliday: {
            type: Boolean,
            default: false
        },

        allowCheckInOnWeeklyOff: {
            type: Boolean,
            default: false
        },

        /** Default weekly off when shift has none configured */
        weeklyOff: [
            {
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
            }
        ],

        status: {
            type: String,
            enum: ["Active", "Inactive"],
            default: "Active",
            index: true
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        deletedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

attendancePolicySchema.index(
    { policyCode: 1 },
    { unique: true }
);

attendancePolicySchema.index(
    { policyName: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

module.exports = mongoose.model("AttendancePolicy", attendancePolicySchema);
