const mongoose = require('mongoose');

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
    required: function() { return this.status !== 'sold'; } 
  },
  status: { 
    type: String, 
    enum: ['available', 'in-transit', 'sold', 'repairing'], 
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

module.exports = mongoose.model('ItemTrack', itemTrackSchema);