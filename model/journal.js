const mongoose = require("mongoose");

// ==========================================================
// Journal Line Sub-Schema
// ==========================================================
const journalLineSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    debit: {
      type: Number,
      default: 0,
      min: 0,
    },

    credit: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

// ==========================================================
// Journal Schema
// ==========================================================
const journalSchema = new mongoose.Schema(
  {
    // ==========================================================
    // Company & Branch
    // ==========================================================
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    // ==========================================================
    // Journal Identity
    // ==========================================================
    journalNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    journalDate: {
      type: Date,
      default: Date.now,
    },

    // ==========================================================
    // Transaction Information
    // ==========================================================
    journalType: {
      type: String,
      enum: [
        "Purchase",
        "Purchase Return",
        "Sales",
        "Sales Return",
        "Payment",
        "Receipt",
        "Expense",
        "Adjustment",
        "Opening Balance",
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
        "Manual",
      ],
      default: "Manual",
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ==========================================================
    // Journal Lines
    // ==========================================================
    lines: [journalLineSchema],

    // ==========================================================
    // Accounting Summary
    // ==========================================================
    totalDebit: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCredit: {
      type: Number,
      default: 0,
      min: 0,
    },

    difference: {
      type: Number,
      default: 0,
    },

    isBalanced: {
      type: Boolean,
      default: false,
    },

    // ==========================================================
    // Posting Management
    // ==========================================================
    postingStatus: {
      type: String,
      enum: ["Draft", "Pending Approval", "Approved", "Posted", "Cancelled"],
      default: "Draft",
    },

    postedToLedger: {
      type: Boolean,
      default: false,
    },

    ledgerPostedAt: {
      type: Date,
      default: null,
    },

    ledgerReferenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },

    // ==========================================================
    // Approval Management
    // ==========================================================
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    approvalNote: {
      type: String,
      default: "",
    },

    // ==========================================================
    // Currency Management
    // ==========================================================
    currency: {
      type: String,
      default: "BDT",
      uppercase: true,
      trim: true,
    },

    exchangeRate: {
      type: Number,
      default: 1,
      min: 0,
    },

    baseCurrencyAmount: {
      type: Number,
      default: 0,
    },

    // ==========================================================
    // Additional Description
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
        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ==========================================================
    // Reversal Journal
    // ==========================================================
    isReversal: {
      type: Boolean,
      default: false,
    },

    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      default: null,
    },

    reversalReason: {
      type: String,
      default: "",
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

    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    // ==========================================================
    // Security Control
    // ==========================================================
    isManualEntry: {
      type: Boolean,
      default: true,
    },

    isSystemGenerated: {
      type: Boolean,
      default: false,
    },

    sourceModule: {
      type: String,
      enum: ["Purchase", "Sales", "Inventory", "Finance", "HR", "Manual"],
      default: "Finance",
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

    // ==========================================================
    // Additional ERP Fields
    // ==========================================================
    sequenceNumber: {
      type: Number,
      default: 0,
    },

    fiscalYear: {
      type: String,
      default: "",
    },

    period: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // Adds createdAt & updatedAt
  }
);

// ==========================================================
// DATABASE INDEXES
// ==========================================================

// Journal Number Unique Per Company
journalSchema.index({ companyId: 1, journalNumber: 1 }, { unique: true });

// Date Based Journal Report
journalSchema.index({ companyId: 1, journalDate: -1 });

// Journal Type Report
journalSchema.index({ companyId: 1, journalType: 1 });

// Reference Document Search
journalSchema.index({ referenceType: 1, referenceId: 1 });

// Posting Status Search
journalSchema.index({ postingStatus: 1 });

// Pending Approval Search
journalSchema.index({ companyId: 1, postingStatus: 1 });

// Ledger Posted Search
journalSchema.index({ postedToLedger: 1 });

// Account Line Search
journalSchema.index({ "lines.accountId": 1 });

// Balanced Journal Search
journalSchema.index({ isBalanced: 1 });

// Source Module Report
journalSchema.index({ sourceModule: 1 });

// Fiscal Year Report
journalSchema.index({ fiscalYear: 1, period: 1 });

// Created User Audit
journalSchema.index({ createdBy: 1, createdAt: -1 });

// Soft Delete Filtering
journalSchema.index({ companyId: 1, isDeleted: 1 });

// Additional useful indexes
journalSchema.index({ companyId: 1, journalType: 1, postingStatus: 1 });
journalSchema.index({ companyId: 1, journalDate: -1, postingStatus: 1 });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
journalSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

journalSchema.methods.calculateTotal = function () {
  this.totalDebit = 0;
  this.totalCredit = 0;

  this.lines.forEach((line) => {
    this.totalDebit += line.debit;
    this.totalCredit += line.credit;
  });

  this.difference = this.totalDebit - this.totalCredit;
  this.isBalanced = this.difference === 0;

  return this.isBalanced;
};

journalSchema.methods.validate = function () {
  this.calculateTotal();

  if (!this.isBalanced) {
    throw new Error("Journal debit and credit are not balanced");
  }

  return true;
};

journalSchema.methods.approve = function (userId) {
  this.postingStatus = "Approved";
  this.approvedBy = userId;
  this.approvedAt = new Date();

  return this.save();
};

journalSchema.methods.post = function (userId) {
  this.validate();

  this.postingStatus = "Posted";
  this.postedToLedger = true;
  this.ledgerPostedAt = new Date();
  this.approvedBy = userId;

  return this.save();
};

journalSchema.methods.reverse = function (userId, reason) {
  this.isReversal = true;
  this.reversalReason = reason;
  this.postingStatus = "Cancelled";
  this.updatedBy = userId;

  return this.save();
};

journalSchema.methods.cancel = function (userId) {
  this.postingStatus = "Cancelled";
  this.cancelledBy = userId;
  this.cancelledAt = new Date();

  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

journalSchema.statics.getCompanyJournals = function (companyId) {
  return this.find({
    companyId,
    isDeleted: false,
  }).sort({ journalDate: -1 });
};

journalSchema.statics.getPendingApproval = function (companyId) {
  return this.find({
    companyId,
    postingStatus: "Pending Approval",
    isDeleted: false,
  });
};

journalSchema.statics.getPostedJournals = function (companyId) {
  return this.find({
    companyId,
    postingStatus: "Posted",
    isDeleted: false,
  });
};

journalSchema.statics.getMonthlyReport = function (companyId, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    companyId,
    journalDate: {
      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

journalSchema.query.active = function () {
  return this.where({ isDeleted: false });
};

journalSchema.query.posted = function () {
  return this.where({
    postingStatus: "Posted",
    isDeleted: false,
  });
};

journalSchema.query.pending = function () {
  return this.where({
    postingStatus: "Pending Approval",
    isDeleted: false,
  });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
journalSchema.set("toJSON", {
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
module.exports = mongoose.model("Journal", journalSchema);