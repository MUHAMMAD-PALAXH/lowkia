const mongoose = require('mongoose');

const branchTransferSchema = new mongoose.Schema(
  {
    transferNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true
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
    fromBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true
    },
    toBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true
    },
    imeis: {
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one IMEI is required'
      }
    },
    status: {
      type: String,
      enum: ['In Transit', 'Completed', 'Cancelled'],
      default: 'In Transit',
      index: true
    },
    note: { type: String, default: '', trim: true },
    dispatchedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true
    },
    dispatchedAt: { type: Date, default: Date.now },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null
    },
    receivedAt: { type: Date, default: null }
  },
  { timestamps: true, versionKey: false }
);

branchTransferSchema.index({ status: 1, dispatchedAt: -1 });

module.exports = mongoose.model('BranchTransfer', branchTransferSchema);
