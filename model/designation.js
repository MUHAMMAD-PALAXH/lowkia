const mongoose = require("mongoose");

const designationSchema = new mongoose.Schema(
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

    departmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        required: true,
        index: true
    },

    // =====================================================
    // Designation
    // =====================================================

    designationCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },

    designationName: {
        type: String,
        required: true,
        trim: true
    },

    level: {
        type: Number,
        default: 1
    },

    description: {
        type: String,
        default: ""
    },

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

designationSchema.index({
    companyId:1,
    designationCode:1
},{
    unique:true
});

designationSchema.index({
    companyId:1,
    departmentId:1,
    designationName:1
},{
    unique:true
});

designationSchema.index({
    designationName:"text",
    description:"text"
});

module.exports = mongoose.model(
    "Designation",
    designationSchema
);