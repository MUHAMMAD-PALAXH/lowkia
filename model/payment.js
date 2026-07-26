const mongoose = require("mongoose");

// ==========================================================
// Payment Schema
// ==========================================================
const paymentSchema = new mongoose.Schema(
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
      index: true,
    },

    // ==========================================================
    // Payment Identity
    // ==========================================================
    paymentNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    paymentDate: {
      type: Date,
      default: Date.now,
    },

    // ==========================================================
    // Payment Type
    // ==========================================================
    paymentType: {
      type: String,
      enum: [
        "Supplier Payment",
        "Customer Refund",
        "Expense Payment",
        "Salary Payment",
        "Loan Payment",
        "Other",
      ],
      required: true,
    },

    // ==========================================================
    // Party Relation
    // ==========================================================
    partyType: {
      type: String,
      enum: ["Supplier", "Customer", "Employee", "Other"],
      required: true,
    },

    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // ==========================================================
    // Reference Document
    // ==========================================================
    referenceType: {
      type: String,
      enum: ["PurchaseInvoice", "SalesReturn", "Expense", "Salary", "Manual"],
      default: "Manual",
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ==========================================================
    // Amount Information
    // ==========================================================
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    dueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Payment Method
    // ==========================================================
    paymentMethod: {
      type: String,
      enum: ["Cash", "Bank Transfer", "Cheque", "Card", "Mobile Banking", "Online Payment"],
      required: true,
    },

    // ==========================================================
    // Account Mapping
    // ==========================================================
    paymentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },

    cashBankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },

    // ==========================================================
    // Transaction Information
    // ==========================================================
    transactionReference: {
      type: String,
      default: "",
      trim: true,
    },

    chequeNumber: {
      type: String,
      default: "",
    },

    bankName: {
      type: String,
      default: "",
    },

    transactionDate: {
      type: Date,
      default: null,
    },

    // ==========================================================
    // Currency
    // ==========================================================
    currency: {
      type: String,
      default: "BDT",
      uppercase: true,
    },

    exchangeRate: {
      type: Number,
      default: 1,
    },

    // ==========================================================
    // Journal Integration
    // ==========================================================
    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      default: null,
    },

    isJournalCreated: {
      type: Boolean,
      default: false,
    },

    journalCreatedAt: {
      type: Date,
      default: null,
    },

    // ==========================================================
    // Ledger Integration
    // ==========================================================
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },

    isLedgerPosted: {
      type: Boolean,
      default: false,
    },

    ledgerPostedAt: {
      type: Date,
      default: null,
    },

    // ==========================================================
    // Posting Workflow
    // ==========================================================
    status: {
      type: String,
      enum: ["Draft", "Pending Approval", "Approved", "Paid", "Cancelled"],
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
    // Approval System
    // ==========================================================
    requiresApproval: {
      type: Boolean,
      default: false,
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

    approvalNote: {
      type: String,
      default: "",
    },

    // ==========================================================
    // Reconciliation
    // ==========================================================
    isReconciled: {
      type: Boolean,
      default: false,
    },

    reconciledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    reconciledAt: {
      type: Date,
      default: null,
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
    // Notes & Remarks
    // ==========================================================
    note: {
      type: String,
      default: "",
      trim: true,
    },

    internalNote: {
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
    sourceModule: {
      type: String,
      enum: ["Purchase", "Sales", "Expense", "HR", "Finance", "Manual"],
      default: "Finance",
    },

    isSystemGenerated: {
      type: Boolean,
      default: false,
    },

    isManualEntry: {
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

// Payment Number Unique Per Company
paymentSchema.index({ companyId: 1, paymentNumber: 1 }, { unique: true });

// Company Payment History
paymentSchema.index({ companyId: 1, paymentDate: -1 });

// Branch Wise Payment
paymentSchema.index({ branchId: 1, paymentDate: -1 });

// Party Payment Search
paymentSchema.index({ partyType: 1, partyId: 1, paymentDate: -1 });

// Supplier Payment Report
paymentSchema.index({ paymentType: 1, partyId: 1 });

// Reference Document Search
paymentSchema.index({ referenceType: 1, referenceId: 1 });

// Payment Method Report
paymentSchema.index({ paymentMethod: 1 });

// Account Wise Payment
paymentSchema.index({ paymentAccountId: 1, paymentDate: -1 });

// Journal Search
paymentSchema.index({ journalId: 1 });

// Ledger Search
paymentSchema.index({ ledgerId: 1 });

// Approval Workflow
paymentSchema.index({ status: 1 });

// Pending Approval Payment
paymentSchema.index({ requiresApproval: 1, status: 1 });

// Reconciliation Report
paymentSchema.index({ isReconciled: 1 });

// Currency Report
paymentSchema.index({ currency: 1 });

// Soft Delete Filter
paymentSchema.index({ companyId: 1, isDeleted: 1 });

// Audit Search
paymentSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful indexes
paymentSchema.index({ companyId: 1, paymentType: 1, status: 1 });
paymentSchema.index({ companyId: 1, partyType: 1, partyId: 1 });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
paymentSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

paymentSchema.methods.calculateDue = function () {
  this.dueAmount = (this.amount - this.discountAmount) - this.paidAmount;
  if (this.dueAmount < 0) {
    this.dueAmount = 0;
  }
  return this.dueAmount;
};

paymentSchema.methods.validatePayment = function () {
  if (this.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }
  if (this.paidAmount > this.amount) {
    throw new Error("Paid amount cannot exceed total amount.");
  }
  return true;
};

paymentSchema.methods.approve = function (userId, note = "") {
  this.status = "Approved";
  this.approvedBy = userId;
  this.approvedAt = new Date();
  this.approvalNote = note;
  return this.save();
};

paymentSchema.methods.markAsPaid = function (userId) {
  this.validatePayment();
  this.calculateDue();
  this.status = "Paid";
  this.postedBy = userId;
  this.postedAt = new Date();
  return this.save();
};

paymentSchema.methods.reconcile = function (userId) {
  this.isReconciled = true;
  this.reconciledBy = userId;
  this.reconciledAt = new Date();
  return this.save();
};

paymentSchema.methods.cancel = function (userId) {
  this.status = "Cancelled";
  this.cancelledBy = userId;
  this.cancelledAt = new Date();
  return this.save();
};

paymentSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

paymentSchema.statics.getCompanyPayments = function (companyId) {
  return this.find({
    companyId,
    isDeleted: false,
  }).sort({ paymentDate: -1 });
};

paymentSchema.statics.getSupplierPayments = function (supplierId) {
  return this.find({
    partyType: "Supplier",
    partyId: supplierId,
    isDeleted: false,
  }).sort({ paymentDate: -1 });
};

paymentSchema.statics.getPendingPayments = function (companyId) {
  return this.find({
    companyId,
    status: "Pending Approval",
    isDeleted: false,
  });
};

paymentSchema.statics.getMonthlyReport = function (companyId, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    companyId,
    paymentDate: {
      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

paymentSchema.query.active = function () {
  return this.where({ isDeleted: false });
};

paymentSchema.query.approved = function () {
  return this.where({
    status: "Approved",
    isDeleted: false,
  });
};

paymentSchema.query.paid = function () {
  return this.where({
    status: "Paid",
    isDeleted: false,
  });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
paymentSchema.set("toJSON", {
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
module.exports = mongoose.model("Payment", paymentSchema);