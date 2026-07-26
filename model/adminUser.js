const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ======================================================
// Company Membership Schema
// ======================================================

const companyMembershipSchema = new mongoose.Schema(
{
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },

    companyRole: {
        type: String,
        enum: [
            "Owner",
            "Admin",
            "Manager",
            "Branch Manager",
            "Purchase Manager",
            "Warehouse Manager",
            "Sales Manager",
            "Accountant",
            "Staff"
        ],
        default: "Staff"
    },

    permissions: [
        {
            type: String,
            trim: true
        }
    ],

    joinedAt: {
        type: Date,
        default: Date.now
    },

    isActive: {
        type: Boolean,
        default: true
    }

},
{
    _id: false
});

// ======================================================
// Admin User Schema
// ======================================================

const adminUserSchema = new mongoose.Schema(
{

    // ==================================================
    // Basic Information
    // ==================================================

    firstName: {
        type: String,
        required: true,
        trim: true
    },

    lastName: {
        type: String,
        required: true,
        trim: true
    },

    username: {
        type: String,
        unique: true,
        sparse: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    phone: {
        type: String,
        default: ""
    },

    password: {
        type: String,
        required: true
    },

    profileImage: {
        type: String,
        default: ""
    },

    employeeCode: {
        type: String,
        default: "",
        trim: true
    },

    designation: {
        type: String,
        default: "",
        trim: true
    },

    // ==================================================
    // System Role
    // ==================================================

    role: {
        type: String,
        enum: [
            "admin",
            "vendor",
            "branch_manager"
        ],
        default: "vendor"
    },

    // ==================================================
    // Company Access
    // ==================================================

    companies: [
        companyMembershipSchema
    ],

    defaultCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        default: null
    },

    lastActiveCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        default: null
    },

    // ==================================================
    // Account Status
    // ==================================================

    isVerified: {
        type: Boolean,
        default: false
    },

    isApproved: {
        type: Boolean,
        default: false
    },

    status: {
        type: String,
        enum: [
            "Pending",
            "Active",
            "Suspended",
            "Blocked"
        ],
        default: "Pending"
    },

    isDeleted: {
        type: Boolean,
        default: false
    },

    // ==================================================
    // Security
    // ==================================================

    lastLogin: {
        type: Date,
        default: null
    },

    passwordChangedAt: {
        type: Date,
        default: null
    },

    // ==================================================
    // Audit
    // ==================================================

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        default: null
    },

    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        default: null
    }

},
{
    timestamps: true,
    versionKey: false
});

// ======================================================
// Indexes
// ======================================================

adminUserSchema.index({ email: 1 });
adminUserSchema.index({ username: 1 });
adminUserSchema.index({ role: 1 });
adminUserSchema.index({ defaultCompany: 1 });

// ======================================================
// Password Hash
// ======================================================

adminUserSchema.pre("save", async function(next){

    if(!this.isModified("password"))
        return next();

    this.password = await bcrypt.hash(this.password,12);

    next();

});

// ======================================================
// Compare Password
// ======================================================

adminUserSchema.methods.comparePassword = async function(password){

    return await bcrypt.compare(
        password,
        this.password
    );

};

// ======================================================
// Generate JWT
// ======================================================

adminUserSchema.methods.generateToken = function(){

    return jwt.sign(

        {
            id: this._id,
            role: this.role
        },

        process.env.JWT_SECRET,

        {
            expiresIn: "7d"
        }

    );

};

// ======================================================
// Company Membership
// ======================================================

adminUserSchema.methods.getCompanyMembership = function(companyId){

    return this.companies.find(
        item => item.companyId.toString() === companyId.toString()
    );

};

// ======================================================
// Permission Check
// ======================================================

adminUserSchema.methods.hasPermission = function(companyId, permission){

    const membership = this.getCompanyMembership(companyId);

    if(!membership)
        return false;

    if(membership.companyRole === "Owner")
        return true;

    if(membership.permissions.includes("*"))
        return true;

    return membership.permissions.includes(permission);

};

module.exports = mongoose.model(
    "AdminUser",
    adminUserSchema
);