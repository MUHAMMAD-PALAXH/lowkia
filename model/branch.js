const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
    {
        // ==========================================================
        // Identity — BRN-000001 (auto-generated, never editable)
        // ==========================================================

        branchCode: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            default: "",
            lowercase: true,
            trim: true
        },

        phone: {
            type: String,
            default: "",
            trim: true
        },

        // ==========================================================
        // Manager (AdminUser until auth/HR phase)
        // ==========================================================

        managerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        // ==========================================================
        // Address
        // ==========================================================

        country: {
            type: String,
            default: "Bangladesh",
            trim: true
        },

        city: {
            type: String,
            required: true,
            trim: true
        },

        address: {
            type: String,
            default: "",
            trim: true
        },

        postalCode: {
            type: String,
            default: "",
            trim: true
        },

        // ==========================================================
        // Attendance geofence (optional — policy.locationRequired)
        // ==========================================================

        attendanceLatitude: {
            type: Number,
            default: null
        },

        attendanceLongitude: {
            type: Number,
            default: null
        },

        /** Allowed check-in radius in meters (e.g. 100) */
        attendanceRadiusMeters: {
            type: Number,
            default: 100,
            min: 0
        },

        // ==========================================================
        // Many-to-many Warehouses
        // One Branch → many Warehouses
        // One Warehouse → many Branches (synced on Warehouse.branchIds)
        // ==========================================================

        warehouseIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Warehouse"
            }
        ],

        // ==========================================================
        // Status
        // ==========================================================

        status: {
            type: String,
            enum: ["Active", "Inactive", "Closed", "Maintenance"],
            default: "Active",
            index: true
        },

        isHeadOffice: {
            type: Boolean,
            default: false,
            index: true
        },

        description: {
            type: String,
            default: ""
        },

        // ==========================================================
        // Audit
        // ==========================================================

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

branchSchema.index({ name: 1 });
branchSchema.index({ managerId: 1 });
branchSchema.index({ warehouseIds: 1 });
branchSchema.index({ isDeleted: 1, status: 1 });

branchSchema.methods.activate = function () {
    this.status = "Active";
    return this.save();
};

branchSchema.methods.deactivate = function () {
    this.status = "Inactive";
    return this.save();
};

branchSchema.statics.getActiveBranches = function () {
    return this.find({
        status: "Active",
        isDeleted: { $ne: true }
    }).sort({ name: 1 });
};

branchSchema.query.active = function () {
    return this.where({
        status: "Active",
        isDeleted: { $ne: true }
    });
};

branchSchema.set("toJSON", {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model("Branch", branchSchema);
