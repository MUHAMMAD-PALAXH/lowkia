const mongoose = require('mongoose');
const tenantPlugin = require('./plugins/tenant.plugin');

const orderSchema = new mongoose.Schema({
  userID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  orderStatus: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  items: [
    {
      productID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      productName: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true
      },
      price: {
        type: Number,
        required: true
      },
      variant: {
        type: String,
      },
      // 💥 ADDED FOR SERIALIZED IMEI TRACKING
      imeis: [{ type: String, trim: true }]
    }
  ],
  // 💥 ADDED TO IDENTIFY SOURCE OUTLET/POS BRANCH
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  },
  totalPrice: {
    type: Number,
    required: true
  },
  shippingAddress: {
    phone: String,
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'prepaid']
  },
  couponCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon'
  },
  orderTotal: {
    subtotal: Number,
    discount: Number,
    total: Number
  },
  trackingUrl: {
    type: String
  },
  /** Set when mirrored from marketplace CompanyOrder (USER_APP checkout). */
  companyOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CompanyOrder',
    default: null,
    index: true,
  },
  masterOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MasterOrder',
    default: null,
    index: true,
  },
  orderNumber: {
    type: String,
    trim: true,
    uppercase: true,
    default: '',
  },
}, {
  timestamps: true 
});

orderSchema.index(
  { companyId: 1, companyOrderId: 1 },
  { unique: true, partialFilterExpression: { companyOrderId: { $type: 'objectId' } } }
);

orderSchema.plugin(tenantPlugin);

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;