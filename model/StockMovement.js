const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
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
    // Movement Identity
    // ==========================================================
    movementNumber: {

      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    movementDate: {

      type: Date,
      default: Date.now,
      index: true,
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
    // Product Information
    // ==========================================================
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
      index: true,
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

    // ==========================================================
    // Movement Information
    // ==========================================================
    movementType: {

      type: String,
      enum: [
        "Purchase",
        "Sale",
        "Purchase Return",
        "Sales Return",
        "Transfer In",
        "Transfer Out",
        "Adjustment",
        "Damage",
        "Opening Stock",
      ],
      required: true,
      index: true,
    },

    movementDirection: {

      type: String,
      enum: ["IN", "OUT"],
      required: true,
      index: true,
    },

    // ==========================================================
    // Quantity Information
    // ==========================================================
    quantity: {

      type: Number,
      required: true,
      min: 0,
    },

    previousStock: {

      type: Number,
      default: 0,
      min: 0,
    },

    currentStock: {

      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Unit Information
    // ==========================================================
    unitId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },

    conversionFactor: {

      type: Number,
      default: 1,
      min: 1,
    },

    // ==========================================================
    // Remarks
    // ==========================================================
    remarks: {

      type: String,
      default: "",
      trim: true,
    },

    // ==========================================================
    // Transaction Reference
    // ==========================================================
    referenceType: {

      type: String,
      enum: [
        "Purchase Order",
        "GRN",
        "Purchase Invoice",
        "Sales Order",
        "Sales Invoice",
        "Sales Return",
        "Purchase Return",
        "Stock Transfer",
        "Stock Adjustment",
        "Opening Balance",
        "Manual",
      ],
      required: true,
      index: true,
    },

    referenceId: {

      type: mongoose.Schema.Types.ObjectId,
      default: null,
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

    purchaseInvoiceId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseInvoice",
      default: null,
    },

    // ==========================================================
    // Sales Reference
    // ==========================================================
    salesOrderId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesOrder",
      default: null,
    },

    salesInvoiceId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesInvoice",
      default: null,
    },

    salesReturnId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesReturn",
      default: null,
    },

    // ==========================================================
    // Transfer Reference
    // ==========================================================
    stockTransferId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "StockTransfer",
      default: null,
    },

    // ==========================================================
    // Adjustment
    // ==========================================================
    adjustmentReason: {

      type: String,
      default: "",
    },

    // ==========================================================
    // Cost Information
    // ==========================================================
    unitCost: {

      type: Number,
      default: 0,
      min: 0,
    },

    totalCost: {

      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Selling Information
    // ==========================================================
    sellingPrice: {

      type: Number,
      default: 0,
      min: 0,
    },

    totalSellingAmount: {

      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================================
    // Profit Information
    // ==========================================================
    profitAmount: {

      type: Number,
      default: 0,
    },

    profitMargin: {

      type: Number,
      default: 0,
    },

    // ==========================================================
    // Batch & Serial Tracking
    // ==========================================================
    batchNumber: {

      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    lotNumber: {

      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    serialNumbers: [
      {

        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    // ==========================================================
    // Manufacturing & Expiry
    // ==========================================================
    manufacturingDate: {

      type: Date,
      default: null,
    },

    expiryDate: {

      type: Date,
      default: null,
    },

    // ==========================================================
    // Transfer Information
    // ==========================================================
    fromWarehouseId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    toWarehouseId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    fromBranchId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    toBranchId: {

      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    // ==========================================================
    // Location Tracking
    // ==========================================================
    fromLocation: {

      rack: { type: String, default: "" },
      shelf: { type: String, default: "" },
      bin: { type: String, default: "" },
    },

    toLocation: {

      rack: { type: String, default: "" },
      shelf: { type: String, default: "" },
      bin: { type: String, default: "" },
    },

    // ==========================================================
    // Transfer Status
    // ==========================================================
    transferStatus: {

      type: String,
      enum: ["Pending", "In Transit", "Completed", "Cancelled"],
      default: "Completed",
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
    // Approval Information
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

    // ==========================================================
    // System Tracking
    // ==========================================================
    isSystemGenerated: {

      type: Boolean,
      default: true,
    },

    source: {

      type: String,
      enum: ["Admin Panel", "Mobile App", "API", "Import", "System"],
      default: "System",
    },

    // ==========================================================
    // Import Tracking
    // ==========================================================
    importBatchId: {

      type: String,
      default: null,
    },

    externalReference: {

      type: String,
      default: "",
      trim: true,
    },
  },
  {

    timestamps: true, // Adds createdAt & updatedAt automatically
  }
);

// ==========================================================
// DATABASE INDEXES
// ==========================================================

// Movement Number (already unique in field definition)
stockMovementSchema.index({ movementNumber: 1 }, { unique: true });

// Date Report
stockMovementSchema.index({ movementDate: -1  });

// Warehouse Stock History
stockMovementSchema.index({ warehouseId: 1, movementDate: -1  });

// Product Stock Ledger
stockMovementSchema.index({ productId: 1, movementDate: -1  });

// Product Variant Ledger
stockMovementSchema.index({ productVariantId: 1, movementDate: -1  });

// Movement Type Report
stockMovementSchema.index({ movementType: 1, movementDate: -1  });

// IN / OUT Report
stockMovementSchema.index({ movementDirection: 1, movementDate: -1 });

// Reference Document Lookup
stockMovementSchema.index({ referenceType: 1, referenceId: 1 });

// Purchase Tracking
stockMovementSchema.index({ purchaseOrderId: 1 });
stockMovementSchema.index({ grnId: 1 });
stockMovementSchema.index({ purchaseInvoiceId: 1 });

// Sales Tracking
stockMovementSchema.index({ salesInvoiceId: 1 });
stockMovementSchema.index({ salesReturnId: 1 });

// Transfer Tracking
stockMovementSchema.index({ stockTransferId: 1 });

// Batch Tracking
stockMovementSchema.index({ batchNumber: 1  });

// Expiry Report
stockMovementSchema.index({ expiryDate: 1  });

// User Audit
stockMovementSchema.index({ createdBy: 1, createdAt: -1 });

// Additional useful compound indexes
stockMovementSchema.index({ movementType: 1, movementDirection: 1  });
stockMovementSchema.index({ fromWarehouseId: 1, toWarehouseId: 1  });

// ==========================================================
// VIRTUAL FIELDS
// ==========================================================
stockMovementSchema.virtual("id").get(function () {

  return this._id.toHexString();
});

// ==========================================================
// INSTANCE METHODS
// ==========================================================

stockMovementSchema.methods.calculateCost = function () {

  this.totalCost = this.quantity * this.unitCost;
  return this.totalCost;
};

stockMovementSchema.methods.calculateProfit = function () {

  this.profitAmount = this.totalSellingAmount - this.totalCost;

  if (this.totalCost > 0) {

    this.profitMargin = (this.profitAmount / this.totalCost) * 100;
  } else {

    this.profitMargin = 0;
  }

  return this.profitAmount;
};

stockMovementSchema.methods.approve = function (userId) {

  this.approvedBy = userId;
  this.approvedAt = new Date();
  return this.save();
};

stockMovementSchema.methods.updateBalance = function (newBalance) {

  this.currentStock = newBalance;
  return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

stockMovementSchema.statics.getProductHistory = function (productId) {

  return this.find({ productId }).sort({ movementDate: -1 });
};

stockMovementSchema.statics.getWarehouseHistory = function (warehouseId) {

  return this.find({ warehouseId }).sort({ movementDate: -1 });
};

stockMovementSchema.statics.getExpiryProducts = function(date) {

  return this.find({
    expiryDate: { $lte: date },
  });
};

stockMovementSchema.statics.getBatchHistory = function (batchNumber) {

  return this.find({ batchNumber });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

stockMovementSchema.query.incoming = function () {

  return this.where({ movementDirection: "IN" });
};

stockMovementSchema.query.outgoing = function () {

  return this.where({ movementDirection: "OUT" });
};

stockMovementSchema.query.recent = function () {

  return this.sort({ movementDate: -1 });
};

// ==========================================================
// JSON CONFIG
// ==========================================================
stockMovementSchema.set("toJSON", {

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
module.exports = mongoose.model("StockMovement", stockMovementSchema);