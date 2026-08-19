const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const AdminUser = require('../model/adminUser');
const Product = require('../model/product');
const ProductVariant = require('../model/productVariant');
const Coupon = require('../model/couponCode');
const Order = require('../model/order');
const Supplier = require('../model/supplier');
const { ensureSupplierLoginProfile } = require('../services/supplierService');
const jwt = require('jsonwebtoken');
const otpGenerator = require('otp-generator');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const otpStore = {}; // Use Redis in production
const AppError = require('../utils/appError');

const normalizePhone = (value = "") =>
  String(value)
    .trim()
    .replace(/[\s\-()]/g, "");

/** Account is usable only after email + phone verification. */
const isFullyVerified = (user) =>
  Boolean(user?.isVerified && user?.isPhoneVerified);

const isPendingRegistration = (user) =>
  Boolean(user) && !isFullyVerified(user);

const sendOTP = async (email, purpose, { phone } = {}) => {
  const otp = otpGenerator.generate(6, {
    digits: true,
    alphabets: false,
    upperCase: false,
    specialChars: false,
  });
  const key = email.toLowerCase();
  otpStore[key] = { otp, purpose, expires: Date.now() + 10 * 60 * 1000 };

  const phoneLine =
    purpose === "Phone Verification" && phone
      ? `<p>Confirm phone number <strong>${phone}</strong> with this code.</p>`
      : "";

  try {
    const { data, error } = await resend.emails.send({
      from: "Admin App <onboarding@resend.dev>",
      to: [email],
      subject: `${purpose} OTP`,
      text:
        purpose === "Phone Verification" && phone
          ? `Phone verification OTP for ${phone}: ${otp}. Valid 10 min.`
          : `OTP: ${otp}. Valid 10 min.`,
      html: `<strong>${otp}</strong>${phoneLine}<p>Valid 10 min.</p>`,
    });

    if (error) {
      delete otpStore[key];
      throw new AppError(
        error.message ||
          'Could not send verification email. Please try again.',
        502
      );
    }
    return data;
  } catch (err) {
    delete otpStore[key];
    if (err instanceof AppError) throw err;
    throw new AppError(
      err.message ||
        'Could not send verification email. Please try again.',
      502
    );
  }
};

/** Remove incomplete signup rows so failed OTP never leaves a stuck account. */
const rollbackPendingUser = async (userId) => {
  if (!userId) return;
  await AdminUser.deleteOne({
    _id: userId,
    $or: [
      { isVerified: { $ne: true } },
      { isPhoneVerified: { $ne: true } },
    ],
  });
};

// Protect middleware
const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = await AdminUser.findById(decoded.id);
  if (!req.user) return res.status(401).json({ success: false, message: 'Invalid token' });
  if (req.user.status === 'Blocked') {
    return res.status(403).json({
      success: false,
      message: 'This account has been blocked. Contact an administrator.',
    });
  }
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
  if (!user.isVerified || !user.isPhoneVerified) {
    return res.status(400).json({
      success: false,
      message: 'User must verify email and phone before approval',
    });
  }
  if (user.isApproved) return res.status(400).json({ success: false, message: 'User already approved' });

  user.isApproved = true;
  user.status = 'Active';
  await user.save();
  res.json({ success: true, message: 'User approved successfully' });
}));

// Block access without deleting the directory or its related business data.
router.post('/:id/block', protect, adminOnly, asyncHandler(async (req, res) => {
  if (String(req.user._id) === String(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'You cannot block your own account',
    });
  }

  const user = await AdminUser.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.status === 'Blocked') {
    return res.status(400).json({ success: false, message: 'Account is already blocked' });
  }

  user.status = 'Blocked';
  user.updatedBy = req.user._id;
  await user.save();
  res.json({ success: true, message: 'Account blocked successfully', data: user });
}));

router.post('/:id/unblock', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await AdminUser.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.status !== 'Blocked') {
    return res.status(400).json({ success: false, message: 'Account is not blocked' });
  }

  user.status = user.isApproved ? 'Active' : 'Pending';
  user.updatedBy = req.user._id;
  await user.save();
  res.json({ success: true, message: 'Account unblocked successfully', data: user });
}));

// GET all login accounts (admin, vendor, employee, supplier)
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
  await Supplier.updateMany({ userId: user._id }, { $unset: { userId: 1 } });

  await user.deleteOne();

  res.json({ success: true, message: `${user.role} deleted successfully` });
}));

// Register — incomplete until email + phone OTP succeed.
// If Resend fails, pending DB row is rolled back so "email exists" cannot trap users.
router.post('/register', asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, role, phone } = req.body;
  if (!firstName || !lastName || !email || !password || !role || !phone) {
    return res.status(400).json({
      success: false,
      message: 'All fields required (including phone)',
    });
  }

  if (!['admin', 'vendor', 'branch_manager', 'supplier'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  const emailKey = String(email).toLowerCase().trim();
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid phone number',
    });
  }

  let existing = await AdminUser.findOne({ email: emailKey });

  if (existing && isFullyVerified(existing)) {
    return res.status(400).json({
      success: false,
      message: 'Email already registered. Please sign in.',
    });
  }

  const phoneOwner = await AdminUser.findOne({ phone: normalizedPhone });
  if (
    phoneOwner &&
    String(phoneOwner._id) !== String(existing?._id) &&
    isFullyVerified(phoneOwner)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Phone number already registered',
    });
  }

  // Free phone from another incomplete signup so resume can proceed.
  if (
    phoneOwner &&
    isPendingRegistration(phoneOwner) &&
    String(phoneOwner._id) !== String(existing?._id)
  ) {
    await AdminUser.deleteOne({ _id: phoneOwner._id });
  }

  let user = existing;
  let createdNow = false;

  try {
    if (user && isPendingRegistration(user)) {
      user.firstName = String(firstName).trim();
      user.lastName = String(lastName).trim();
      user.phone = normalizedPhone;
      user.password = password;
      user.role = role;
      user.isVerified = false;
      user.isPhoneVerified = false;
      user.isApproved = false;
      user.status = 'Pending';
      await user.save();
    } else {
      user = await AdminUser.create({
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: emailKey,
        phone: normalizedPhone,
        password,
        role,
        isVerified: false,
        isPhoneVerified: false,
        isApproved: false,
        status: 'Pending',
      });
      createdNow = true;
    }

    await sendOTP(emailKey, 'Registration');

    return res.json({
      success: true,
      message: 'Registration started. Check email for OTP.',
      data: { nextStep: 'email', phone: normalizedPhone },
    });
  } catch (err) {
    delete otpStore[emailKey];
    // Never leave a half-created / stuck pending account after mail failure.
    if (user?._id && (createdNow || isPendingRegistration(user))) {
      await rollbackPendingUser(user._id);
    }
    const status = err.statusCode || 502;
    return res.status(status).json({
      success: false,
      message:
        err.message ||
        'Could not send verification email. Please try again.',
      data: null,
      errors: null,
    });
  }
}));

// Resend OTP (email registration or phone verification)
router.post('/resend-otp', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const purpose = req.body.purpose === 'Phone Verification'
    ? 'Phone Verification'
    : 'Registration';

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const user = await AdminUser.findOne({ email });
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'No pending registration found for this email. Please sign up again.',
    });
  }

  if (isFullyVerified(user)) {
    return res.status(400).json({
      success: false,
      message: 'Account already verified. Please sign in.',
    });
  }

  try {
    if (purpose === 'Registration') {
      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email already verified. Continue with phone verification.',
          data: { nextStep: 'phone', phone: user.phone },
        });
      }
      await sendOTP(email, 'Registration');
      return res.json({ success: true, message: 'Email OTP resent' });
    }

    if (!user.isVerified) {
      return res.status(400).json({ success: false, message: 'Verify email first' });
    }
    if (user.isPhoneVerified) {
      return res.status(400).json({ success: false, message: 'Phone already verified' });
    }
    if (!user.phone) {
      return res.status(400).json({ success: false, message: 'No phone on account' });
    }

    await sendOTP(email, 'Phone Verification', { phone: user.phone });
    return res.json({
      success: true,
      message: 'Phone verification OTP resent to your email',
    });
  } catch (err) {
    const status = err.statusCode || 502;
    return res.status(status).json({
      success: false,
      message:
        err.message ||
        'Could not send verification email. Please try again.',
      data: null,
      errors: null,
    });
  }
}));

// Verify email OTP
router.post('/verify', asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const key = String(email || '').toLowerCase();
  const stored = otpStore[key];
  if (!stored || stored.purpose !== 'Registration' || Date.now() > stored.expires || stored.otp !== otp) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  const user = await AdminUser.findOne({ email: key });
  if (!user) {
    delete otpStore[key];
    return res.status(404).json({
      success: false,
      message: 'Registration not found. Please sign up again.',
    });
  }

  user.isVerified = true;
  await user.save();
  delete otpStore[key];

  if (user.phone && !user.isPhoneVerified) {
    try {
      await sendOTP(key, 'Phone Verification', { phone: user.phone });
      return res.json({
        success: true,
        message: 'Email verified. Check email for phone verification OTP.',
        data: { nextStep: 'phone', phone: user.phone },
      });
    } catch (err) {
      return res.json({
        success: true,
        message:
          'Email verified, but phone OTP email failed. Tap Resend on the phone step.',
        data: { nextStep: 'phone', phone: user.phone, otpSendFailed: true },
      });
    }
  }

  res.json({
    success: true,
    message: 'Email verified. Awaiting admin approval.',
    data: { nextStep: 'done' },
  });
}));

// Verify phone OTP (delivered via Resend email — Resend has no SMS API)
router.post('/verify-phone', asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const key = String(email || '').toLowerCase();
  const stored = otpStore[key];
  if (
    !stored ||
    stored.purpose !== 'Phone Verification' ||
    Date.now() > stored.expires ||
    stored.otp !== otp
  ) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  const user = await AdminUser.findOne({ email: key });
  if (!user) {
    delete otpStore[key];
    return res.status(404).json({
      success: false,
      message: 'Registration not found. Please sign up again.',
    });
  }
  if (!user.isVerified) {
    return res.status(400).json({ success: false, message: 'Verify email first' });
  }

  user.isPhoneVerified = true;
  await user.save();
  delete otpStore[key];

  if (user.role === 'supplier') {
    await ensureSupplierLoginProfile(user);
  }

  res.json({
    success: true,
    message: 'Phone verified. Awaiting admin approval.',
    data: { nextStep: 'done' },
  });
}));

// Login — only fully verified (+ approved) accounts
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await AdminUser.findOne({ email: String(email || '').toLowerCase() });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  if (user.status === 'Blocked') {
    return res.status(403).json({
      success: false,
      message: 'This account has been blocked. Contact an administrator.',
    });
  }
  if (!user.isVerified) {
    return res.status(401).json({
      success: false,
      message: 'Verify email first',
      data: { nextStep: 'email', email: user.email },
    });
  }
  if (user.phone && !user.isPhoneVerified) {
    return res.status(401).json({
      success: false,
      message: 'Verify phone first',
      data: { nextStep: 'phone', phone: user.phone, email: user.email },
    });
  }
  if (!user.isApproved) {
    return res.status(403).json({
      success: false,
      message: 'Account pending admin approval',
    });
  }

  if (user.role === 'supplier') {
    await ensureSupplierLoginProfile(user);
  }

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