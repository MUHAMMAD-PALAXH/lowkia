const mongoose = require("mongoose");

// ==========================================================
// Purchase Return Item Sub-Schema
// ==========================================================
const purchaseReturnItemSchema = new mongoose.Schema(
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

    total: {

      type: Number,
      default: 0,
      min: 0,
    },

    reason: {

      type: String,
      default: "",
      trim: true,
    },
  },
  {

    _id: false,
  }
);

// ==========================================================
// Purchase Return Main Schema
// ==========================================================
const purchaseReturnSchema = new mongoose.Schema(
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
    // Return Identity
    // ==========================================================
    returnNumber: {

      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    returnDate: {

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
    purchaseInvoiceId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseInvoice",
      default: null,
    },

    grnId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "GRN",
      default: null,
    },

    // ==========================================================
    // Return Items
    // ==========================================================
    items: [purchaseReturnItemSchema],

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
    // Supplier Adjustment
    // ==========================================================
    adjustmentType: {

      type: String,
      enum: ["Refund", "Credit Note", "Adjust With Due"],
      default: "Adjust With Due",
    },

    refundAmount: {

      type: Number,
      default: 0,
      min: 0,
    },

    adjustedAmount: {

      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Supplier Balance Update
    // ==========================================================
    supplierBalanceUpdated: {

      type: Boolean,
      default: false,
    },

    supplierBalanceUpdatedAt: {

      type: Date,
      default: null,
    },

    supplierBalanceUpdatedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    // ==========================================================
    // Return Workflow Status
    // ==========================================================
    status: {

      type: String,
      enum: ["Draft", "Pending Approval", "Approved", "Stock Returned", "Completed", "Cancelled"],
      default: "Draft",
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

    // ==========================================================
    // Stock Movement Integration
    // ==========================================================
    stockMovementId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "StockMovement",
      default: null,
    },

    // ==========================================================
    // Supplier Ledger Integration
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

    rejectedBy: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    rejectedAt: {

      type: Date,
      default: null,
    },

    rejectionReason: {

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

    timestamps: true, // Adds createdAt & updatedAt
  }
);

// ==========================================================
// DATABASE INDEXES
// ==========================================================

// Return Number Unique
purchaseReturnSchema.index({ returnNumber: 1 }, { unique: true });

// Return Report
purchaseReturnSchema.index({ returnDate: -1  });

// Branch Wise Return
purchaseReturnSchema.index({ branchId: 1, returnDate: -1 });

// Supplier Return History
purchaseReturnSchema.index({ supplierId: 1, returnDate: -1 });

// Purchase Invoice Tracking
purchaseReturnSchema.index({ purchaseInvoiceId: 1 });

// GRN Tracking
purchaseReturnSchema.index({ grnId: 1 });

// Status Based Search
purchaseReturnSchema.index({ status: 1 });

// Inventory Pending Update
purchaseReturnSchema.index({ inventoryUpdated: 1 });

// Ledger Posting Tracking
purchaseReturnSchema.index({ isLedgerPosted: 1 });

// Adjustment Type Report
purchaseReturnSchema.index({ adjustmentType: 1 });

// Supplier Balance Update
purchaseReturnSchema.index({ supplierBalanceUpdated: 1 });

// Date Range Report
purchaseReturnSchema.index({ returnDate: -1, status: 1  });

// Soft Delete Filtering
purchaseReturnSchema.index({ isDeleted: 1  });

// User Audit
purchaseReturnSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful indexes
purchaseReturnSchema.index({ supplierId: 1, returnDate: -1  });
purchaseReturnSchema.index({ status: 1, inventoryUpdated: 1  });

// ==========================================================
// VIRTUAL FIELD
// ==========================================================
purchaseReturnSchema.virtual("id").get(function () {

  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

purchaseReturnSchema.methods.calculateTotal = function () {

  this.subtotal = 0;

  this.items.forEach((item) => {

    item.total = item.quantity * item.purchasePrice;
    this.subtotal += item.total;
  });

  this.grandTotal =
    this.subtotal - this.discount + this.tax + this.otherCharges;

  return this.grandTotal;
};

purchaseReturnSchema.methods.updateSupplierAdjustment = function () {

  if (this.adjustmentType === "Refund") {

    this.refundAmount = this.grandTotal;
  } else {

    this.adjustedAmount = this.grandTotal;
  }

  return this.save();
};

purchaseReturnSchema.methods.completeReturn = function (userId) {

  this.inventoryUpdated = true;
  this.inventoryUpdatedBy = userId;
  this.inventoryUpdatedAt = new Date();
  this.status = "Stock Returned";

  return this.save();
};

purchaseReturnSchema.methods.postLedger = function (ledgerId) {

  this.ledgerEntryId = ledgerId;
  this.isLedgerPosted = true;
  this.ledgerPostedAt = new Date();
  this.status = "Completed";

  return this.save();
};

purchaseReturnSchema.methods.approve = function (userId) {

  this.status = "Approved";
  this.approvedBy = userId;
  this.approvedAt = new Date();

  return this.save();
};

purchaseReturnSchema.methods.cancel = function (userId, reason) {

  this.status = "Cancelled";
  this.cancelledBy = userId;
  this.cancelledAt = new Date();
  this.cancellationReason = reason;

  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

purchaseReturnSchema.statics.getSupplierReturns = function (supplierId) {

  return this.find({

    supplierId,
    isDeleted: false,
  }).sort({ returnDate: -1 });
};

purchaseReturnSchema.statics.getPendingInventoryReturn = function() {

  return this.find({
    inventoryUpdated: false,
    isDeleted: false,
  });
};

purchaseReturnSchema.statics.getPendingLedgerReturn = function() {

  return this.find({
    isLedgerPosted: false,
    isDeleted: false,
  });
};

purchaseReturnSchema.statics.getMonthlyReport = function(month, year) {

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    returnDate: {

      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

purchaseReturnSchema.query.active = function () {

  return this.where({ isDeleted: false });
};

purchaseReturnSchema.query.completed = function () {

  return this.where({ status: "Completed" });
};

purchaseReturnSchema.query.pending = function () {

  return this.where({

    status: {

      $in: ["Draft", "Pending Approval"],
    },
  });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
purchaseReturnSchema.set("toJSON", {

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
module.exports = mongoose.model("PurchaseReturn", purchaseReturnSchema);