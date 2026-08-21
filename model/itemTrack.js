const mongoose = require('mongoose');
const tenantPlugin = require("./plugins/tenant.plugin");

const itemTrackSchema = new mongoose.Schema({
  imei: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    index: true 
  },
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: true 
  },
  variantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ProductVariant', 
    required: true 
  },
  vendorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'AdminUser', 
    required: true 
  },
  currentBranchId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Branch', 
    default: null
  },
  status: { 
    type: String, 
    // "deleted" = cleared with product stock / trash prep (not physically sold)
    enum: ['available', 'in-transit', 'sold', 'repairing', 'deleted'], 
    default: 'available',
    index: true
  },
  // History log for lifecycle tracking
  history: [
    {
      status: String,
      branchId: mongoose.Schema.Types.ObjectId,
      updatedBy: mongoose.Schema.Types.ObjectId,
      date: { type: Date, default: Date.now },
      notes: String
    }
  ],
  transferInfo: {
    transferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BranchTransfer',
      default: null
    },
    transferNumber: { type: String, default: '' },
    fromBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null
    },
    toBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null
    },
    dispatchedAt: { type: Date, default: null }
  },
  // Sale lifecycle attachments
  saleInfo: {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    customerPhone: String,
    soldPrice: Number,
    soldDate: Date
  },
  warrantyExpiry: { type: Date }
}, { timestamps: true });

// Optimize compound index for fast dashboard stock calculation
itemTrackSchema.index({ variantId: 1, currentBranchId: 1, status: 1 });

itemTrackSchema.plugin(tenantPlugin);

module.exports = mongoose.model('ItemTrack', itemTrackSchema);