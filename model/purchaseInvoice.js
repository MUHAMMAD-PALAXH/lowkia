const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

// ==========================================================
// Purchase Invoice Item Sub-Schema
// ==========================================================
const purchaseInvoiceItemSchema = new mongoose.Schema(
  {

    productId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    productVariantId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },

    sku: {

      type: String,
      default: "",
      trim: true,
    },

    productName: {

      type: String,
      required: true,
      trim: true,
    },

    quantity: {

      type: Number,
      required: true,
      min: 1,
    },

    unitId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },

    purchasePrice: {

      type: Number,
      required: true,
      min: 0,
    },

    discount: {

      type: Number,
      default: 0,
      min: 0,
    },

    tax: {

      type: Number,
      default: 0,
      min: 0,
    },

    total: {

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
// Purchase Invoice Main Schema
// ==========================================================
const purchaseInvoiceSchema = new mongoose.Schema(
{

// ==========================================================
    // Branch
    // ==========================================================
    branchId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

    // ==========================================================
    // Invoice Identity
    // ==========================================================
    invoiceNumber: {

      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    supplierInvoiceNumber: {

      type: String,
      default: "",
      trim: true,
    },

    invoiceDate: {

      type: Date,
      default: Date.now,
    },

    // ==========================================================
    // Supplier Relation
    // ==========================================================
    supplierId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },

    // ==========================================================
    // Purchase Reference
    // ==========================================================
    purchaseOrderId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
    },

    grnId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "GRN",
      default: null,
    },

    // ==========================================================
    // Invoice Items
    // ==========================================================
    items: [purchaseInvoiceItemSchema],

    // ==========================================================
    // Financial Summary
    // ==========================================================
    subtotal: {

      type: Number,
      default: 0,
      min: 0,
    },

    discount: {

      type: Number,
      default: 0,
      min: 0,
    },

    tax: {

      type: Number,
      default: 0,
      min: 0,
    },

    shippingCost: {

      type: Number,
      default: 0,
      min: 0,
    },

    otherCharges: {

      type: Number,
      default: 0,
      min: 0,
    },

    grandTotal: {

      type: Number,
      required: true,
      min: 0,
    },

    // ==========================================================
    // Payment Information
    // ==========================================================
    paymentStatus: {

      type: String,
      enum: ["Pending", "Partial", "Paid"],
      default: "Pending",
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

    // ==========================================================
    // Payment Terms
    // ==========================================================
    paymentTerms: {

      type: String,
      enum: ["Cash", "7 Days", "15 Days", "30 Days", "60 Days", "90 Days", "Custom"],
      default: "Cash",
    },

    creditDays: {

      type: Number,
      default: 0,
    },

    // ==========================================================
    // Invoice Workflow Status
    // ==========================================================
    status: {

      type: String,
      enum: ["Draft", "Pending Verification", "Verified", "Posted", "Paid", "Cancelled"],
      default: "Draft",
    },

    // ==========================================================
    // GRN Verification
    // ==========================================================
    isGRNVerified: {

      type: Boolean,
      default: false,
    },

    verifiedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    verifiedAt: {

      type: Date,
      default: null,
    },

    verificationNote: {

      type: String,
      default: "",
    },

    // ==========================================================
    // Inventory Integration
    // ==========================================================
    inventoryUpdated: {

      type: Boolean,
      default: false,
    },

    inventoryUpdatedAt: {

      type: Date,
      default: null,
    },

    inventoryUpdatedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    stockMovementIds: [
      {

        type: mongoose.Schema.Types.ObjectId,
        ref: "StockMovement",
      },
    ],

    // ==========================================================
    // Accounting Integration
    // ==========================================================
    ledgerEntryId: {

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

    rejectionReason: {

      type: String,
      default: "",
    },

    rejectedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    rejectedAt: {

      type: Date,
      default: null,
    },

    // ==========================================================
    // Supplier Payment Reference
    // ==========================================================
    paymentIds: [
      {

        type: mongoose.Schema.Types.ObjectId,
        ref: "Payment",
      },
    ],

    lastPaymentDate: {

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
    // Notes
    // ==========================================================
    supplierNote: {

      type: String,
      default: "",
      trim: true,
    },

    internalNote: {

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
    // Cancellation Tracking
    // ==========================================================
    cancelledBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    cancelledAt: {

      type: Date,
      default: null,
    },

    cancellationReason: {

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

    timestamps: true, // Automatically adds createdAt & updatedAt
  }
);

// ==========================================================
// DATABASE INDEXES
// ==========================================================

// Invoice Listing
purchaseInvoiceSchema.index({ invoiceDate: -1  });

// Branch Wise Invoice
purchaseInvoiceSchema.index({ branchId: 1, invoiceDate: -1 });

// Supplier Invoice History
purchaseInvoiceSchema.index({ supplierId: 1, invoiceDate: -1 });

// Purchase Order Tracking
purchaseInvoiceSchema.index({ purchaseOrderId: 1 });

// GRN Tracking
purchaseInvoiceSchema.index({ grnId: 1 });

// Status Based Search
purchaseInvoiceSchema.index({ status: 1 });

// Payment Status Report
purchaseInvoiceSchema.index({ paymentStatus: 1 });

// Due Amount Report
purchaseInvoiceSchema.index({ supplierId: 1, dueAmount: -1 });

// Date Range + Status Report
purchaseInvoiceSchema.index({ invoiceDate: -1, status: 1  });

// Ledger Posting Search
purchaseInvoiceSchema.index({ isLedgerPosted: 1 });

// Inventory Update Tracking
purchaseInvoiceSchema.index({ inventoryUpdated: 1 });

// Soft Delete Filtering
purchaseInvoiceSchema.index({ isDeleted: 1  });

// Creator Audit
purchaseInvoiceSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful indexes
purchaseInvoiceSchema.index({ supplierId: 1, invoiceDate: -1  });
purchaseInvoiceSchema.index({ paymentStatus: 1, dueAmount: 1  });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
purchaseInvoiceSchema.virtual("id").get(function () {

  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

purchaseInvoiceSchema.methods.calculateTotal = function () {

  this.subtotal = 0;

  this.items.forEach((item) => {

    item.total =
      item.quantity * item.purchasePrice - item.discount + item.tax;

    this.subtotal += item.total;
  });

  this.grandTotal =
    this.subtotal -
    this.discount +
    this.tax +
    this.shippingCost +
    this.otherCharges;

  return this.grandTotal;
};

purchaseInvoiceSchema.methods.updatePayment = function (amount) {

  this.paidAmount += amount;

  this.dueAmount = this.grandTotal - this.paidAmount;

  if (this.dueAmount <= 0) {

    this.paymentStatus = "Paid";
    this.status = "Paid";
  } else if (this.paidAmount > 0) {

    this.paymentStatus = "Partial";
  } else {

    this.paymentStatus = "Pending";
  }

  return this.save();
};

purchaseInvoiceSchema.methods.verify = function (userId) {

  this.status = "Verified";
  this.isGRNVerified = true;
  this.verifiedBy = userId;
  this.verifiedAt = new Date();

  return this.save();
};

purchaseInvoiceSchema.methods.postLedger = function (ledgerId) {

  this.ledgerEntryId = ledgerId;
  this.isLedgerPosted = true;
  this.ledgerPostedAt = new Date();
  this.status = "Posted";

  return this.save();
};

purchaseInvoiceSchema.methods.cancel = function (userId, reason) {

  this.status = "Cancelled";
  this.cancelledBy = userId;
  this.cancelledAt = new Date();
  this.cancellationReason = reason;

  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

purchaseInvoiceSchema.statics.getSupplierInvoices = function (supplierId) {

  return this.find({

    supplierId,
    isDeleted: false,
  }).sort({ invoiceDate: -1 });
};

purchaseInvoiceSchema.statics.getPendingPayments = function() {

  return this.find({
    paymentStatus: { $ne: "Paid" },
    isDeleted: false,
  }).sort({ dueAmount: -1 });
};

purchaseInvoiceSchema.statics.getUnpostedInvoices = function() {

  return this.find({
    isLedgerPosted: false,
    isDeleted: false,
  });
};

purchaseInvoiceSchema.statics.getMonthlyReport = function(month, year) {

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    invoiceDate: {

      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

purchaseInvoiceSchema.query.active = function () {

  return this.where({ isDeleted: false });
};

purchaseInvoiceSchema.query.paid = function () {

  return this.where({ paymentStatus: "Paid" });
};

purchaseInvoiceSchema.query.due = function () {

  return this.where({ dueAmount: { $gt: 0 } });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
purchaseInvoiceSchema.set("toJSON", {

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
purchaseInvoiceSchema.plugin(tenantPlugin);

module.exports = mongoose.model("PurchaseInvoice", purchaseInvoiceSchema);