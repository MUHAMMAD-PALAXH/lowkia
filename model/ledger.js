const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

// ==========================================================
// Ledger Schema
// ==========================================================
const ledgerSchema = new mongoose.Schema(
{

// ==========================================================
    // Branch
    // ==========================================================
    branchId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },

    // ==========================================================
    // Account Relation
    // ==========================================================
    accountId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    // ==========================================================
    // Transaction Identity
    // ==========================================================
    transactionId: {

      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    transactionDate: {

      type: Date,
      default: Date.now,
    },

    // ==========================================================
    // Transaction Type
    // ==========================================================
    transactionType: {

      type: String,
      enum: [
        "Purchase",
        "Purchase Return",
        "Sales",
        "Sales Return",
        "Payment",
        "Receipt",
        "Expense",
        "Journal",
        "Adjustment",
      ],
      required: true,
    },

    // ==========================================================
    // Reference Document
    // ==========================================================
    referenceType: {

      type: String,
      enum: [
        "PurchaseInvoice",
        "PurchaseReturn",
        "SalesInvoice",
        "SalesReturn",
        "Payment",
        "Receipt",
        "Expense",
        "Journal",
      ],
      default: null,
    },

    referenceId: {

      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ==========================================================
    // Accounting Amount
    // ==========================================================
    debitAmount: {

      type: Number,
      default: 0,
      min: 0,
    },

    creditAmount: {

      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Running Balance
    // ==========================================================
    balance: {

      type: Number,
      default: 0,
    },

    balanceType: {

      type: String,
      enum: ["Debit", "Credit"],
      default: "Debit",
    },

    // ==========================================================
    // Description
    // ==========================================================
    description: {

      type: String,
      default: "",
      trim: true,
    },

    remarks: {

      type: String,
      default: "",
      trim: true,
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
    // Party Relation
    // ==========================================================
    partyType: {

      type: String,
      enum: ["Supplier", "Customer", "Employee", "Other"],
      default: null,
    },

    partyId: {

      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ==========================================================
    // Journal Integration
    // ==========================================================
    journalEntryId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      default: null,
    },

    isJournalPosted: {

      type: Boolean,
      default: false,
    },

    journalPostedAt: {

      type: Date,
      default: null,
    },

    // ==========================================================
    // Payment / Receipt Integration
    // ==========================================================
    paymentId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },

    receiptId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Receipt",
      default: null,
    },

    // ==========================================================
    // Posting Status
    // ==========================================================
    postingStatus: {

      type: String,
      enum: ["Draft", "Posted", "Reversed", "Cancelled"],
      default: "Draft",
    },

    postedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    postedAt: {

      type: Date,
      default: null,
    },

    // ==========================================================
    // Reversal Transaction
    // ==========================================================
    isReversal: {

      type: Boolean,
      default: false,
    },

    reversalOf: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },

    reversalReason: {

      type: String,
      default: "",
    },

    // ==========================================================
    // Attachment Management
    // ==========================================================
    attachments: [
      {

        fileName: {

          type: String,
          default: "",
        },
        fileUrl: {

          type: String,
          default: "",
        },
        fileType: {

          type: String,
          default: "",
        },
        uploadedAt: {

          type: Date,
          default: Date.now,
        },
        uploadedBy: {

          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
      },
    ],

    // ==========================================================
    // Notes & Remarks
    // ==========================================================
    internalNote: {

      type: String,
      default: "",
      trim: true,
    },

    description2: {

      type: String,
      default: "",
      trim: true,
    },

    // ==========================================================
    // Audit Information
    // ==========================================================
    createdBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    updatedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    approvedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    approvedAt: {

      type: Date,
      default: null,
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

// Transaction ID Unique
ledgerSchema.index({ transactionId: 1  }, { unique: true });

// Account Ledger Report
ledgerSchema.index({ accountId: 1, transactionDate: -1 });

// Ledger Report
ledgerSchema.index({ transactionDate: -1  });

// Branch Wise Ledger
ledgerSchema.index({ branchId: 1, transactionDate: -1 });

// Transaction Type Report
ledgerSchema.index({ transactionType: 1  });

// Reference Document Search
ledgerSchema.index({ referenceType: 1, referenceId: 1 });

// Supplier / Customer Ledger
ledgerSchema.index({ partyType: 1, partyId: 1, transactionDate: -1 });

// Debit Credit Report
ledgerSchema.index({ debitAmount: 1, creditAmount: 1 });

// Posting Status
ledgerSchema.index({ postingStatus: 1 });

// Pending Journal Posting
ledgerSchema.index({ isJournalPosted: 1 });

// Payment Ledger Search
ledgerSchema.index({ paymentId: 1 });

// Receipt Ledger Search
ledgerSchema.index({ receiptId: 1 });

// Date Based Financial Report
ledgerSchema.index({ transactionDate: -1 });

// Soft Delete Filter
ledgerSchema.index({ isDeleted: 1  });

// Created User Audit
ledgerSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful indexes
ledgerSchema.index({ accountId: 1, transactionDate: -1  });
ledgerSchema.index({ postingStatus: 1, transactionDate: -1  });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
ledgerSchema.virtual("id").get(function () {

  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

ledgerSchema.methods.validateEntry = function () {

  if (this.debitAmount !== 0 && this.creditAmount !== 0) {

    throw new Error("Ledger entry cannot have both debit and credit amount");
  }

  if (this.debitAmount === 0 && this.creditAmount === 0) {

    throw new Error("Ledger entry must have debit or credit amount");
  }

  return true;
};

ledgerSchema.methods.calculateBalance = function (previousBalance) {

  if (this.debitAmount > 0) {

    this.balance = previousBalance + this.debitAmount;
    this.balanceType = "Debit";
  } else if (this.creditAmount > 0) {

    this.balance = previousBalance - this.creditAmount;
    this.balanceType = "Credit";
  }

  return this.balance;
};

ledgerSchema.methods.post = function (userId) {

  this.validateEntry();

  this.postingStatus = "Posted";
  this.postedBy = userId;
  this.postedAt = new Date();

  return this.save();
};

ledgerSchema.methods.reverse = function (userId, reason) {

  this.postingStatus = "Reversed";
  this.isReversal = true;
  this.reversalReason = reason;
  this.postedBy = userId;
  this.postedAt = new Date();

  return this.save();
};

ledgerSchema.methods.cancel = function () {

  this.postingStatus = "Cancelled";
  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

ledgerSchema.statics.getAccountLedger = function (accountId) {

  return this.find({

    accountId,
    isDeleted: false,
  }).sort({ transactionDate: 1 });
};

ledgerSchema.statics.getPartyLedger = function (partyType, partyId) {

  return this.find({

    partyType,
    partyId,
    isDeleted: false,
  }).sort({ transactionDate: 1 });
};

ledgerSchema.statics.getAllLedger = function() {

  return this.find({
    isDeleted: false,
  }).sort({ transactionDate: -1 });
};

ledgerSchema.statics.getMonthlyReport = function(month, year) {

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    transactionDate: {

      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

ledgerSchema.query.posted = function () {

  return this.where({

    postingStatus: "Posted",
    isDeleted: false,
  });
};

ledgerSchema.query.pending = function () {

  return this.where({

    postingStatus: "Draft",
    isDeleted: false,
  });
};

ledgerSchema.query.active = function () {

  return this.where({

    isDeleted: false,
  });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
ledgerSchema.set("toJSON", {

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
ledgerSchema.plugin(tenantPlugin);

module.exports = mongoose.model("Ledger", ledgerSchema);