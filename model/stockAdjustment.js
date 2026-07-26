const mongoose = require("mongoose");

// ==========================================================
// Stock Adjustment Item Sub-Schema
// ==========================================================
const stockAdjustmentItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
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

    systemQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    actualQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    adjustmentQuantity: {
      type: Number,
      default: 0,
    },

    unitCost: {
      type: Number,
      default: 0,
    },

    totalCost: {
      type: Number,
      default: 0,
    },

    reason: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  }
);

// ==========================================================
// Stock Adjustment Schema
// ==========================================================
const stockAdjustmentSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },

    // ==========================================================
    // Adjustment Identity
    // ==========================================================
    adjustmentNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    adjustmentDate: {
      type: Date,
      default: Date.now,
    },

    referenceNumber: {
      type: String,
      default: "",
    },

    // ==========================================================
    // Warehouse
    // ==========================================================
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      index: true,
    },

    // ==========================================================
    // Adjustment Information
    // ==========================================================
    adjustmentType: {
      type: String,
      enum: ["Increase", "Decrease"],
      required: true,
    },

    adjustmentReason: {
      type: String,
      enum: ["Damage", "Expired", "Lost", "Physical Count", "Opening Correction", "System Error", "Other"],
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    // ==========================================================
    // Products
    // ==========================================================
    items: [stockAdjustmentItemSchema],

    // ==========================================================
    // Approval Workflow
    // ==========================================================
    status: {
      type: String,
      enum: ["Draft", "Pending Approval", "Approved", "Rejected", "Completed", "Cancelled"],
      default: "Draft",
    },

    requiresApproval: {
      type: Boolean,
      default: true,
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
    // Stock Integration
    // ==========================================================
    stockMovementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockMovement",
      default: null,
    },

    isStockUpdated: {
      type: Boolean,
      default: false,
    },

    stockUpdatedAt: {
      type: Date,
      default: null,
    },

    stockUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    // ==========================================================
    // Accounting Integration
    // ==========================================================
    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      default: null,
    },

    isJournalPosted: {
      type: Boolean,
      default: false,
    },

    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },

    isLedgerPosted: {
      type: Boolean,
      default: false,
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
    // Notes
    // ==========================================================
    note: {
      type: String,
      default: "",
    },

    internalNote: {
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

stockAdjustmentSchema.index({ companyId: 1, adjustmentNumber: 1 }, { unique: true });
stockAdjustmentSchema.index({ companyId: 1, adjustmentDate: -1 });
stockAdjustmentSchema.index({ warehouseId: 1, adjustmentDate: -1 });
stockAdjustmentSchema.index({ status: 1 });
stockAdjustmentSchema.index({ adjustmentReason: 1 });
stockAdjustmentSchema.index({ stockMovementId: 1 });
stockAdjustmentSchema.index({ createdBy: 1, createdAt: -1 });
stockAdjustmentSchema.index({ companyId: 1, isDeleted: 1 });

// Additional useful indexes
stockAdjustmentSchema.index({ companyId: 1, status: 1, adjustmentDate: -1 });
stockAdjustmentSchema.index({ companyId: 1, adjustmentReason: 1, status: 1 });

// ==========================================================
// VIRTUAL FIELDS
// ==========================================================
stockAdjustmentSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

stockAdjustmentSchema.methods.calculateAdjustment = function () {
  this.items.forEach((item) => {
    item.adjustmentQuantity = item.actualQuantity - item.systemQuantity;
    item.totalCost = item.adjustmentQuantity * item.unitCost;
  });

  return this.items;
};

stockAdjustmentSchema.methods.approve = function (userId) {
  this.status = "Approved";
  this.approvedBy = userId;
  this.approvedAt = new Date();
  return this.save();
};

stockAdjustmentSchema.methods.reject = function (userId, reason) {
  this.status = "Rejected";
  this.rejectedBy = userId;
  this.rejectedAt = new Date();
  this.rejectionReason = reason;
  return this.save();
};

stockAdjustmentSchema.methods.completeStockUpdate = function (movementId, userId) {
  this.isStockUpdated = true;
  this.stockMovementId = movementId;
  this.stockUpdatedBy = userId;
  this.stockUpdatedAt = new Date();
  this.status = "Completed";
  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

stockAdjustmentSchema.statics.getCompanyAdjustments = function (companyId) {
  return this.find({
    companyId,
    isDeleted: false,
  }).sort({ adjustmentDate: -1 });
};

stockAdjustmentSchema.statics.getWarehouseAdjustments = function (warehouseId) {
  return this.find({
    warehouseId,
    isDeleted: false,
  }).sort({ adjustmentDate: -1 });
};

stockAdjustmentSchema.statics.getPendingApproval = function (companyId) {
  return this.find({
    companyId,
    status: "Pending Approval",
    isDeleted: false,
  }).sort({ createdAt: -1 });
};

stockAdjustmentSchema.statics.getDamageReport = function (companyId) {
  return this.find({
    companyId,
    adjustmentReason: "Damage",
    isDeleted: false,
  });
};

stockAdjustmentSchema.statics.getMonthlyReport = function (companyId, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return this.find({
    companyId,
    adjustmentDate: {
      $gte: startDate,
      $lte: endDate,
    },
    isDeleted: false,
  });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

stockAdjustmentSchema.query.active = function () {
  return this.where({ isDeleted: false });
};

stockAdjustmentSchema.query.pending = function () {
  return this.where({
    status: "Pending Approval",
    isDeleted: false,
  });
};

stockAdjustmentSchema.query.completed = function () {
  return this.where({
    status: "Completed",
    isDeleted: false,
  });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
stockAdjustmentSchema.set("toJSON", {
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
module.exports = mongoose.model("StockAdjustment", stockAdjustmentSchema);