const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema(
{
    // =====================================================
    // Company
    // =====================================================

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true,
        index: true
    },

    // =====================================================
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

// Company wise unique department code
departmentSchema.index({
    companyId: 1,
    departmentCode: 1
}, {
    unique: true
});

// Company wise unique department name
departmentSchema.index({
    companyId: 1,
    departmentName: 1
}, {
    unique: true
});

// Fast searching
departmentSchema.index({
    departmentName: "text",
    description: "text"
});

module.exports = mongoose.model(
    "Department",
    departmentSchema
);