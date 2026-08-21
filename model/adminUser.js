const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ADMIN_USER_ROLE_ENUM, ROLES } = require("../constants/roles");

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
        default: "",
        trim: true
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
    // Tenant (SaaS company)
    // ==================================================

    companyId: {

        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        default: null,
        index: true
    },

    // ==================================================
    // System Role
    // ==================================================

    role: {

        type: String,
        enum: ADMIN_USER_ROLE_ENUM,
        default: ROLES.VENDOR
    },

    /** Screen keys granted beyond / instead of pure role defaults (empty = role defaults). */
    menuPermissions: {
        type: [String],
        default: [],
    },

    // ==================================================
    // Account Status
    // ==================================================

    isVerified: {

        type: Boolean,
        default: false
    },

    isPhoneVerified: {

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
adminUserSchema.index({ phone: 1 }, { unique: true, sparse: true });
adminUserSchema.index({ role: 1 });
adminUserSchema.index({ companyId: 1, role: 1 });

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

/**
 * @param {{ activeCompanyId?: string|null }} [opts]
 * activeCompanyId: Global Super Admin "Enter Company" session scope.
 */
adminUserSchema.methods.generateToken = function (opts = {}) {
    const payload = {
        id: this._id,
        role: this.role,
    };

    if (this.companyId) {
        payload.companyId = this.companyId;
    }

    if (opts.activeCompanyId) {
        payload.activeCompanyId = opts.activeCompanyId;
    }

    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d",
    });
};

module.exports = mongoose.model(
    "AdminUser",
    adminUserSchema
);
