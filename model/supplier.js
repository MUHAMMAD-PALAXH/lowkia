const mongoose = require("mongoose");

// ==========================================================
// Contact Person Schema
// ==========================================================

const contactPersonSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        designation: {
            type: String,
            default: ""
        },
        phone: {
            type: String,
            default: ""
        },
        email: {
            type: String,
            default: ""
        }
    },
    {
        _id: false
    }
);

// ==========================================================
// Bank Information Schema
// ==========================================================

const bankSchema = new mongoose.Schema(
    {
        bankName: {
            type: String,
            default: ""
        },
        accountName: {
            type: String,
            default: ""
        },
        accountNumber: {
            type: String,
            default: ""
        },
        branchName: {
            type: String,
            default: ""
        },
        routingNumber: {
            type: String,
            default: ""
        }
    },
    {
        _id: false
    }
);

// ==========================================================
// Supplier Schema
// ==========================================================

const supplierSchema = new mongoose.Schema(
    {
        // ==========================================================
        // Supplier Identity
        // Business ID: SUP-000001 (auto-generated, never editable)
        // ==========================================================

        supplierCode: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },

        supplierType: {
            type: String,
            enum: [
                "Manufacturer",
                "Distributor",
                "Wholesaler",
                "Retailer",
                "Service Provider",
                "Other"
            ],
            default: "Manufacturer"
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        // Supplier's own business/trade name (not system Company entity)
        companyName: {
            type: String,
            default: "",
            trim: true
        },

        // ==========================================================
        // Legal Information
        // ==========================================================

        taxNumber: {
            type: String,
            default: ""
        },

        vatNumber: {
            type: String,
            default: ""
        },

        tradeLicense: {
            type: String,
            default: ""
        },

        // ==========================================================
        // Contact Information
        // ==========================================================

        phone: {
            type: String,
            default: ""
        },

        email: {
            type: String,
            lowercase: true,
            trim: true,
            default: ""
        },

        website: {
            type: String,
            default: ""
        },

        address: {
            type: String,
            default: ""
        },

        city: {
            type: String,
            default: ""
        },

        country: {
            type: String,
            default: "Bangladesh"
        },

        contactPersons: [contactPersonSchema],

        // ==========================================================
        // Payment Terms
        // ==========================================================

        paymentTerms: {
            type: String,
            enum: [
                "Cash",
                "7 Days",
                "15 Days",
                "30 Days",
                "60 Days",
                "90 Days",
                "Custom"
            ],
            default: "Cash"
        },

        // ==========================================================
        // Financial Information
        // ==========================================================

        openingBalance: {
            type: Number,
            default: 0
        },

        currentBalance: {
            type: Number,
            default: 0
        },

        balanceType: {
            type: String,
            enum: ["Payable", "Advance", "Settled"],
            default: "Payable"
        },

        // ==========================================================
        // Purchase Summary (updated by Purchase / Payment flows)
        // ==========================================================

        totalPurchaseAmount: {
            type: Number,
            default: 0
        },

        totalPaidAmount: {
            type: Number,
            default: 0
        },

        totalDueAmount: {
            type: Number,
            default: 0
        },

        lastPurchaseDate: {
            type: Date
        },

        lastPaymentDate: {
            type: Date
        },

        // ==========================================================
        // Bank Information
        // ==========================================================

        bankAccounts: [bankSchema],

        // ==========================================================
        // Ledger Integration (wired in Accounts phase)
        // ==========================================================

        ledgerAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            default: null
        },

        supplierLedgerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ledger",
            default: null
        },

        // ==========================================================
        // Supplier Rating
        // ==========================================================

        rating: {
            type: Number,
            min: 0,
            max: 5,
            default: 0
        },

        ratingCount: {
            type: Number,
            default: 0
        },

        // ==========================================================
        // Status Management
        // ==========================================================

        status: {
            type: String,
            enum: ["Active", "Inactive", "Blocked"],
            default: "Active"
        },

        isApproved: {
            type: Boolean,
            default: false
        },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        approvedAt: {
            type: Date,
            default: null
        },

        // ==========================================================
        // Additional Information
        // ==========================================================

        note: {
            type: String,
            default: ""
        },

        tags: [
            {
                type: String,
                trim: true
            }
        ],

        // ==========================================================
        // Audit Information
        // ==========================================================

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
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

// ==========================================================
// INDEXES
// ==========================================================

supplierSchema.index({ name: 1 });
supplierSchema.index({ phone: 1 });
supplierSchema.index({ email: 1 });
supplierSchema.index({ status: 1 });
supplierSchema.index({ isApproved: 1 });
supplierSchema.index({ isDeleted: 1, status: 1 });

// ==========================================================
// INSTANCE METHODS
// ==========================================================

// Increase purchase / payment totals after purchase or payment events
supplierSchema.methods.updateBalance = function (purchaseAmount, paymentAmount) {
    this.totalPurchaseAmount += purchaseAmount || 0;
    this.totalPaidAmount += paymentAmount || 0;
    this.totalDueAmount = this.totalPurchaseAmount - this.totalPaidAmount;
    this.currentBalance = this.totalDueAmount;
    return this.save();
};

supplierSchema.methods.addRating = function (score) {
    const totalScore = this.rating * this.ratingCount + score;
    this.ratingCount += 1;
    this.rating = totalScore / this.ratingCount;
    return this.save();
};

supplierSchema.methods.block = function () {
    this.status = "Blocked";
    return this.save();
};

supplierSchema.methods.activate = function () {
    this.status = "Active";
    return this.save();
};

supplierSchema.methods.deactivate = function () {
    this.status = "Inactive";
    return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

supplierSchema.statics.getActiveSuppliers = function () {
    return this.find({
        status: "Active",
        isDeleted: false
    }).sort({ name: 1 });
};

supplierSchema.statics.getPurchaseReport = function () {
    return this.aggregate([
        {
            $match: { isDeleted: false }
        },
        {
            $project: {
                supplierCode: 1,
                name: 1,
                totalPurchaseAmount: 1,
                totalPaidAmount: 1,
                totalDueAmount: 1
            }
        }
    ]);
};

supplierSchema.statics.getDueReport = function () {
    return this.find({
        totalDueAmount: { $gt: 0 },
        isDeleted: false
    }).sort({
        totalDueAmount: -1
    });
};

// ==========================================================
// QUERY HELPER
// ==========================================================

supplierSchema.query.active = function () {
    return this.where({
        status: "Active",
        isDeleted: false
    });
};

// ==========================================================
// JSON CONFIG
// ==========================================================

supplierSchema.set("toJSON", {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model("Supplier", supplierSchema);
