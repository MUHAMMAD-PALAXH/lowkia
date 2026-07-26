const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const AdminUser = require('../model/adminUser');
const Product = require('../model/product');
const ProductVariant = require('../model/productVariant');
const Coupon = require('../model/couponCode');
const Order = require('../model/order');
const jwt = require('jsonwebtoken');
const otpGenerator = require('otp-generator');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const otpStore = {}; // Use Redis in production

const sendOTP = async (email, purpose) => {
  const otp = otpGenerator.generate(6, { digits: true, alphabets: false, upperCase: false, specialChars: false });
  otpStore[email] = { otp, purpose, expires: Date.now() + 10 * 60 * 1000 };

  const { data, error } = await resend.emails.send({
    from: 'Admin App <onboarding@resend.dev>',
    to: [email],
    subject: `${purpose} OTP`,
    text: `OTP: ${otp}. Valid 10 min.`,
    html: `<strong>${otp}</strong><p>Valid 10 min.</p>`,
  });

  if (error) throw new Error(error.message);
  return data;
};

// Protect middleware
const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = await AdminUser.findById(decoded.id);
  if (!req.user) return res.status(401).json({ success: false, message: 'Invalid token' });
  next();
});

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
  next();
};

// NEW: Approve user (admin only)
router.post('/:id/approve', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await AdminUser.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.isApproved) return res.status(400).json({ success: false, message: 'User already approved' });

  user.isApproved = true;
  await user.save();
  res.json({ success: true, message: 'User approved successfully' });
}));

// GET all admins + vendors + branch managers (admin only)
router.get('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const users = await AdminUser.find()
    .select('-password -__v')
    .sort({ createdAt: -1 });
  res.json({ success: true, data: users });
}));

// GET stats (works for admin, vendor, branch_manager)
router.get('/:id/stats', protect, adminOnly, asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const user = await AdminUser.findById(userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const productCount = await Product.countDocuments({ vendorId: user._id });

  const vendorProductIds = await Product.find({ vendorId: user._id }).distinct('_id');

  const salesAgg = await Order.aggregate([
    { $match: { orderStatus: 'delivered' } },
    { $unwind: '$items' },
    { $match: { 'items.productID': { $in: vendorProductIds } } },
    { $group: { _id: null, totalSales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } }
  ]);
  const totalSales = salesAgg.length > 0 ? salesAgg[0].totalSales : 0;

  const topProducts = await Order.aggregate([
    { $match: { orderStatus: 'delivered' } },
    { $unwind: '$items' },
    { $match: { 'items.productID': { $in: vendorProductIds } } },
    { $group: { _id: '$items.productID', name: { $first: '$items.productName' }, totalSold: { $sum: '$items.quantity' } } },
    { $sort: { totalSold: -1 } },
    { $limit: 3 }
  ]);

  res.json({
    success: true,
    data: {
      productCount,
      totalSales,
      topProducts: topProducts.map(p => ({ id: p._id.toString(), name: p.name, sold: p.totalSold }))
    }
  });
}));

// DELETE user (admin only)
router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await AdminUser.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const products = await Product.find({ vendorId: user._id }).select('_id');
  const productIds = products.map(p => p._id);
  await ProductVariant.deleteMany({ productId: { $in: productIds } });
  await Product.deleteMany({ vendorId: user._id });
  await Coupon.deleteMany({ vendorId: user._id });

  await user.deleteOne();

  res.json({ success: true, message: `${user.role} deleted successfully` });
}));

// Register
router.post('/register', asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;
  if (!firstName || !lastName || !email || !password || !role) return res.status(400).json({ success: false, message: 'All fields required' });

  // UPDATED: Added 'branch_manager' to allowed roles
  if (!['admin', 'vendor', 'branch_manager'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });

  const existing = await AdminUser.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(400).json({ success: false, message: 'Email exists' });

  const user = new AdminUser({ 
    firstName, 
    lastName, 
    email: email.toLowerCase(), 
    password, 
    role,
    isVerified: false,
    isApproved: false 
  });
  await user.save();

  await sendOTP(email.toLowerCase(), 'Registration');
  res.json({ success: true, message: 'Registration started. Check email for OTP.' });
}));

// Verify OTP
router.post('/verify', asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const stored = otpStore[email.toLowerCase()];
  if (!stored || stored.purpose !== 'Registration' || Date.now() > stored.expires || stored.otp !== otp) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  await AdminUser.findOneAndUpdate({ email: email.toLowerCase() }, { isVerified: true });
  const updatedUser = await AdminUser.findOne({ email: email.toLowerCase() });
  delete otpStore[email.toLowerCase()];
  res.json({ success: true, message: 'Email verified. Awaiting admin approval.' });
}));

// Login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await AdminUser.findOne({ email: email.toLowerCase() });
  if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  if (!user.isVerified) return res.status(401).json({ success: false, message: 'Verify email first' });
  if (!user.isApproved) return res.status(403).json({ success: false, message: 'Account pending admin approval' });

  const token = user.generateToken();
  res.json({ success: true, data: { user, token } });
}));

// Forgot password
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await AdminUser.findOne({ email: email.toLowerCase() });
  if (!user) return res.status(404).json({ success: false, message: 'Not found' });

  await sendOTP(email.toLowerCase(), 'Password Reset');
  res.json({ success: true, message: 'OTP sent' });
}));

// Reset password
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const stored = otpStore[email.toLowerCase()];
  if (!stored || stored.purpose !== 'Password Reset' || Date.now() > stored.expires || stored.otp !== otp) {
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  }

  const user = await AdminUser.findOne({ email: email.toLowerCase() });
  user.password = newPassword;
  await user.save();
  delete otpStore[email.toLowerCase()];
  res.json({ success: true, message: 'Password reset successful' });
}));

// Self delete own account
router.post('/delete', protect, asyncHandler(async (req, res) => {
  await req.user.deleteOne();
  res.json({ success: true, message: 'Account deleted permanently' });
}));

// Request OTP for profile update
router.post('/request-update-otp', protect, asyncHandler(async (req, res) => {
  await sendOTP(req.user.email, 'Profile Update');
  res.json({ success: true, message: 'OTP sent' });
}));

// Update profile
router.post('/update-profile', protect, asyncHandler(async (req, res) => {
  const { otp, firstName, lastName, email, newPassword } = req.body;
  const stored = otpStore[req.user.email];
  if (!stored || stored.purpose !== 'Profile Update' || Date.now() > stored.expires || stored.otp !== otp) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  const updates = {};
  if (firstName) updates.firstName = firstName.trim();
  if (lastName) updates.lastName = lastName.trim();
  if (newPassword) updates.password = newPassword;
  if (email && email.toLowerCase() !== req.user.email) {
    updates.email = email.toLowerCase();
    updates.isVerified = false;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No updates provided' });
  }

  Object.assign(req.user, updates);
  await req.user.save();
  delete otpStore[req.user.email];

  const token = req.user.generateToken();

  res.json({
    success: true,
    data: { user: req.user, token },
    message: email && email.toLowerCase() !== req.user.email ? 'Email changed – verify new email' : 'Profile updated',
  });
}));

// GET /admin/top-vendors?period=month
router.get('/top-vendors', protect, adminOnly, asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;

  let startDate = new Date();
  switch (period) {
    case 'day':   startDate.setHours(0,0,0,0); break;
    case 'week':  startDate.setDate(startDate.getDate() - 7); break;
    case 'month': startDate.setMonth(startDate.getMonth() - 1); break;
    case 'year':  startDate.setFullYear(startDate.getFullYear() - 1); break;
    default:      startDate = new Date(0);
  }

  const match = {
    createdAt: { $gte: startDate },
    orderStatus: 'delivered'
  };

  const topVendors = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productID',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: '$product' },
    {
      $group: {
        _id: '$product.vendorId',
        totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
        orderCount: { $addToSet: '$_id' }
      }
    },
    {
      $project: {
        vendorId: '$_id',
        totalRevenue: 1,
        orderCount: { $size: '$orderCount' },
        _id: 0
      }
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'adminusers',
        localField: 'vendorId',
        foreignField: '_id',
        as: 'vendor'
      }
    },
    { $unwind: '$vendor' },
    {
      $project: {
        vendorId: 1,
        name: { $concat: ['$vendor.firstName', ' ', '$vendor.lastName'] },
        totalRevenue: 1,
        orderCount: 1
      }
    }
  ]);

  res.json({ success: true, data: topVendors });
}));

module.exports = router;