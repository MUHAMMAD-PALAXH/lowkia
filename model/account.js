const mongoose = require("mongoose");

// ==========================================================
// Account Schema
// ==========================================================
const accountSchema = new mongoose.Schema(
{

        // ==========================================================
    // Account Identity
    // ==========================================================
    accountCode: {

      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    accountName: {

      type: String,
      required: true,
      trim: true,
    },

    // ==========================================================
    // Account Classification
    // ==========================================================
    accountType: {

      type: String,
      enum: ["Asset", "Liability", "Equity", "Income", "Expense"],
      required: true,
    },

    accountCategory: {

      type: String,
      enum: [
        "Current Asset",
        "Fixed Asset",
        "Current Liability",
        "Long Term Liability",
        "Capital",
        "Sales",
        "Purchase",
        "Operating Expense",
        "Other Income",
        "Other Expense",
      ],
      default: "Other Expense",
    },

    // ==========================================================
    // Account Hierarchy
    // ==========================================================
    parentAccountId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },

    level: {

      type: Number,
      default: 1,
    },

    isGroupAccount: {

      type: Boolean,
      default: false,
    },

    // ==========================================================
    // Account Nature
    // ==========================================================
    normalBalance: {

      type: String,
      enum: ["Debit", "Credit"],
      required: true,
    },

    // ==========================================================
    // Balance Information
    // ==========================================================
    openingBalance: {

      type: Number,
      default: 0,
    },

    currentBalance: {

      type: Number,
      default: 0,
    },

    balanceType: {

      type: String,
      enum: ["Debit", "Credit"],
      default: "Debit",
    },

    // ==========================================================
    // Currency
    // ==========================================================
    currency: {

      type: String,
      default: "BDT",
      uppercase: true,
      trim: true,
    },

    // ==========================================================
    // Status Management
    // ==========================================================
    status: {

      type: String,
      enum: ["Active", "Inactive", "Blocked"],
      default: "Active",
    },

    isSystemAccount: {

      type: Boolean,
      default: false,
    },

    // ==========================================================
    // Tax Configuration
    // ==========================================================
    taxApplicable: {

      type: Boolean,
      default: false,
    },

    taxType: {

      type: String,
      enum: ["VAT", "GST", "Income Tax", "None"],
      default: "None",
    },

    taxRate: {

      type: Number,
      default: 0,
    },

    // ==========================================================
    // Bank Account Mapping
    // ==========================================================
    bankDetails: {

      bankName: {

        type: String,
        default: "",
      },
      accountName: {

        type: String,
        default: "",
      },
      accountNumber: {

        type: String,
        default: "",
      },
      branchName: {

        type: String,
        default: "",
      },
    },

    // ==========================================================
    // Ledger Integration
    // ==========================================================
    ledgerId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },

    isLedgerCreated: {

      type: Boolean,
      default: false,
    },

    // ==========================================================
    // Financial Reporting
    // ==========================================================
    reportGroup: {

      type: String,
      enum: ["Balance Sheet", "Profit & Loss", "Cash Flow", "Other"],
      default: "Other",
    },

    financialStatementType: {

      type: String,
      enum: ["Operating", "Non Operating", "Capital"],
      default: "Operating",
    },

    // ==========================================================
    // Audit Information
    // ==========================================================
    createdBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    updatedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    // ==========================================================
    // Account Description
    // ==========================================================
    description: {

      type: String,
      default: "",
      trim: true,
    },

    note: {

      type: String,
      default: "",
      trim: true,
    },

    // ==========================================================
    // Account Usage Tracking
    // ==========================================================
    transactionCount: {

      type: Number,
      default: 0,
    },

    lastTransactionDate: {

      type: Date,
      default: null,
    },

    lastTransactionAmount: {

      type: Number,
      default: 0,
    },

    // ==========================================================
    // Account Access Control
    // ==========================================================
    isPublic: {

      type: Boolean,
      default: true,
    },

    allowedRoles: [
      {

        type: String,
      },
    ],

    // ==========================================================
    // Account Configuration
    // ==========================================================
    allowManualEntry: {

      type: Boolean,
      default: true,
    },

    allowPaymentEntry: {

      type: Boolean,
      default: false,
    },

    allowReceiptEntry: {

      type: Boolean,
      default: false,
    },

    allowJournalEntry: {

      type: Boolean,
      default: true,
    },

    // ==========================================================
    // Soft Delete
    // ==========================================================
    isDeleted: {

      type: Boolean,
      default: false,
    },

    deletedAt: {

      type: Date,
      default: null,
    },

    deletedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  {

    timestamps: true, // Adds createdAt & updatedAt
  }
);

// ==========================================================
// DATABASE INDEXES
// ==========================================================

// Account Code Unique
accountSchema.index({ accountCode: 1  }, { unique: true });

// Account Name Search
accountSchema.index({ accountName: 1  });

// Account Type Report
accountSchema.index({ accountType: 1  });

// Account Category Report
accountSchema.index({ accountCategory: 1  });

// Parent Account Tree
accountSchema.index({ parentAccountId: 1 });

// Group Account Search
accountSchema.index({ isGroupAccount: 1  });

// Active Account List
accountSchema.index({ status: 1  });

// Balance Report
accountSchema.index({ currentBalance: 1  });

// Financial Statement Report
accountSchema.index({ reportGroup: 1, financialStatementType: 1  });

// Ledger Connection
accountSchema.index({ ledgerId: 1 });

// Transaction Usage Report
accountSchema.index({ transactionCount: -1 });

// Last Transaction Sorting
accountSchema.index({ lastTransactionDate: -1 });

// Soft Delete Filtering
accountSchema.index({ isDeleted: 1  });

// Audit Search
accountSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful indexes
accountSchema.index({ accountType: 1, status: 1  });
accountSchema.index({ reportGroup: 1  });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
accountSchema.virtual("id").get(function () {

  return this._id.toHexString();
});

// Optional: Virtual for children (for tree structure)
accountSchema.virtual("children", {

  ref: "Account",
  localField: "_id",
  foreignField: "parentAccountId",
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

accountSchema.methods.debit = function (amount) {

  if (this.normalBalance === "Debit") {

    this.currentBalance += amount;
  } else {

    this.currentBalance -= amount;
  }

  this.transactionCount += 1;
  this.lastTransactionAmount = amount;
  this.lastTransactionDate = new Date();

  return this.save();
};

accountSchema.methods.credit = function (amount) {

  if (this.normalBalance === "Credit") {

    this.currentBalance += amount;
  } else {

    this.currentBalance -= amount;
  }

  this.transactionCount += 1;
  this.lastTransactionAmount = amount;
  this.lastTransactionDate = new Date();

  return this.save();
};

accountSchema.methods.updateBalance = function (amount, type) {

  if (type === "Debit") {

    return this.debit(amount);
  }
  if (type === "Credit") {

    return this.credit(amount);
  }
  return this.save();
};

accountSchema.methods.activate = function () {

  this.status = "Active";
  return this.save();
};

accountSchema.methods.deactivate = function () {

  this.status = "Inactive";
  return this.save();
};

accountSchema.methods.softDelete = function (userId) {

  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;

  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

accountSchema.statics.getAllAccounts = function() {

  return this.find({
    isDeleted: false,
  }).sort({ accountCode: 1 });
};

accountSchema.statics.getActiveAccounts = function() {

  return this.find({
    status: "Active",
    isDeleted: false,
  });
};

accountSchema.statics.getAccountTree = function() {

  return this.find({
    parentAccountId: null,
    isDeleted: false,
  }).populate({

    path: "children",
  });
};

accountSchema.statics.getBalanceSheetAccounts = function() {

  return this.find({
    reportGroup: "Balance Sheet",
    isDeleted: false,
  });
};

accountSchema.statics.getProfitLossAccounts = function() {

  return this.find({
    reportGroup: "Profit & Loss",
    isDeleted: false,
  });
};

accountSchema.statics.getExpenseAccounts = function() {

  return this.find({
    accountType: "Expense",
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

accountSchema.query.active = function () {

  return this.where({

    status: "Active",
    isDeleted: false,
  });
};

accountSchema.query.assets = function () {

  return this.where({ accountType: "Asset" });
};

accountSchema.query.liabilities = function () {

  return this.where({ accountType: "Liability" });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
accountSchema.set("toJSON", {

  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {

    delete ret._id;
    return ret;
  },
});

// ==========================================================
// EXPORT
// ==========================================================
module.exports = mongoose.model("Account", accountSchema);