const mongoose = require("mongoose");

const attendanceCorrectionSchema = new mongoose.Schema(
    {
        correctionCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
        },

        companyHint: {
            type: String,
            default: "global"
        },

        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            required: true,
            index: true
        },

        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true
        },

        attendanceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Attendance",
            required: true,
            index: true
        },

        workDate: {
            type: String,
            default: "",
            index: true
        },

        requestType: {
            type: String,
            enum: [
                "checkInCorrection",
                "checkOutCorrection",
                "breakCorrection",
                "statusCorrection"
            ],
            required: true
        },

        requestedCheckIn: { type: Date, default: null },
        requestedCheckOut: { type: Date, default: null },
        requestedStatus: {
            type: String,
            enum: [
                "",
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
            default: ""
        },

        /** Optional replacement breaks payload for breakCorrection */
        requestedBreaks: {
            type: [
                {
                    startTime: Date,
                    endTime: Date,
                    durationMinutes: { type: Number, default: 0 },
                    type: {
                        type: String,
                        enum: ["lunch", "prayer", "personal", "other"],
                        default: "other"
                    }
                }
            ],
            default: []
        },

        reason: {
            type: String,
            required: true,
            trim: true
        },

        status: {
            type: String,
            enum: ["pending", "approved", "rejected", "cancelled"],
            default: "pending",
            index: true
        },

        /** Snapshot before change */
        oldValue: {
            type: Object,
            default: null
        },

        /** Snapshot after approval */
        newValue: {
            type: Object,
            default: null
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        reviewedAt: {
            type: Date,
            default: null
        },

        reviewNote: {
            type: String,
            default: ""
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

attendanceCorrectionSchema.index({ correctionCode: 1 }, { unique: true });
attendanceCorrectionSchema.index({ employeeId: 1, status: 1, createdAt: -1 });
attendanceCorrectionSchema.index({ attendanceId: 1, status: 1 });

module.exports = mongoose.model(
    "AttendanceCorrection",
    attendanceCorrectionSchema
);
