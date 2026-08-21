const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

const departmentSchema = new mongoose.Schema(
{

    // Department
    // =====================================================

    departmentCode: {

        type: String,
        required: true,
        trim: true,
        uppercase: true
    },

    departmentName: {

        type: String,
        required: true,
        trim: true
    },

    description: {

        type: String,
        default: ""
    },

    // =====================================================
    // Hierarchy
    // =====================================================

    parentDepartment: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: null
    },

    managerId: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        default: null
    },

    // =====================================================
    // Statistics
    // =====================================================

    employeeCount: {

        type: Number,
        default: 0
    },

    // =====================================================
    // Status
    // =====================================================

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
        ref: "AdminUser",
        default: null
    },

    deletedBy: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        default: null
    },

    deletedAt: {

        type: Date,
        default: null
    },

    isDeleted: {

        type: Boolean,
        default: false
    }

},
{

    timestamps: true,
    versionKey: false
});


// =====================================================
// Indexes
// =====================================================

// Unique department code
departmentSchema.index({ departmentCode: 1 }, {

    unique: true
});

// Unique department name
departmentSchema.index({ departmentName: 1 }, {

    unique: true
});

// Fast searching
departmentSchema.index({

    departmentName: "text",
    description: "text"
});

departmentSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
    "Department",
    departmentSchema
);