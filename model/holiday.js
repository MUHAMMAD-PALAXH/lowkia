const mongoose = require("mongoose");

/**
 * Company holiday calendar.
 * Empty applicableBranchIds = applies to all branches.
 */
const holidaySchema = new mongoose.Schema(
    {
        holidayCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
        },

        holidayName: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            default: ""
        },

        startDate: {
            type: Date,
            required: true,
            index: true
        },

        endDate: {
            type: Date,
            required: true,
            index: true
        },

        /** YYYY-MM-DD keys in company timezone for fast lookup */
        workDates: {
            type: [String],
            default: [],
            index: true
        },

        holidayType: {
            type: String,
            enum: ["National", "Company", "Religious", "Optional", "Other"],
            default: "Company"
        },

        isPaid: {
            type: Boolean,
            default: true
        },

        /** Empty = all branches */
        applicableBranchIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Branch"
            }
        ],

        /** Empty = all employees */
        applicableEmployeeIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Employee"
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

holidaySchema.index({ holidayCode: 1 }, { unique: true });
holidaySchema.index({ startDate: 1, endDate: 1 });
holidaySchema.index({ workDates: 1, status: 1 });

module.exports = mongoose.model("Holiday", holidaySchema);
