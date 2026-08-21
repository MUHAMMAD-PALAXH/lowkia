const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

/**
 * Potential overtime is calculated on attendance.overtimeMinutes.
 * Payroll must use attendance.approvedOvertimeMinutes only.
 */
const overtimeRequestSchema = new mongoose.Schema(
    {
        overtimeCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
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

        /** Calculated potential OT at request time (minutes) */
        calculatedMinutes: {
            type: Number,
            default: 0,
            min: 0
        },

        /** Minutes employee is requesting */
        requestedMinutes: {
            type: Number,
            required: true,
            min: 1
        },

        /** Minutes approved (may be less than requested) */
        approvedMinutes: {
            type: Number,
            default: 0,
            min: 0
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

        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        deletedAt: {
            type: Date,
            default: null
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

overtimeRequestSchema.index({ overtimeCode: 1 }, { unique: true });
overtimeRequestSchema.index({ employeeId: 1, status: 1, createdAt: -1 });
overtimeRequestSchema.index(
    { attendanceId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: "pending",
            isDeleted: { $ne: true }
        }
    }
);

overtimeRequestSchema.plugin(tenantPlugin);

module.exports = mongoose.model("OvertimeRequest", overtimeRequestSchema);
