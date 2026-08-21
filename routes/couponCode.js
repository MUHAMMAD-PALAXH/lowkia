const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const Coupon = require('../model/couponCode');
const Product = require('../model/product');
const { protect, vendorOrAdmin } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');

router.use(protect, resolveTenant, requireCompany);

router.get('/', asyncHandler(async (req, res) => {
  const coupons = await Coupon.find({ ...companyFilter(req.companyId) })
    .populate('applicableCategory', 'id name')
    .populate('applicableSubCategory', 'id name')
    .populate('applicableProduct', 'id name');
  res.json({ success: true, message: "Coupons retrieved successfully.", data: coupons });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id)
    .populate('applicableCategory', 'id name')
    .populate('applicableSubCategory', 'id name')
    .populate('applicableProduct', 'id name');
  if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found." });
  assertDocumentCompany(coupon, req.companyId, 'Coupon');
  res.json({ success: true, message: "Coupon retrieved successfully.", data: coupon });
}));

router.post('/check-coupon', asyncHandler(async (req, res) => {
  const { couponCode, productIds, purchaseAmount } = req.body;
  const tenant = companyFilter(req.companyId);

  const coupon = await Coupon.findOne({ couponCode, ...tenant });
  if (!coupon) return res.json({ success: false, message: "Coupon not found." });

  const currentDate = new Date();
  if (coupon.endDate < currentDate) return res.json({ success: false, message: "Coupon is expired." });
  if (coupon.status !== 'active') return res.json({ success: false, message: "Coupon is inactive." });
  if (coupon.minimumPurchaseAmount && purchaseAmount < coupon.minimumPurchaseAmount) {
    return res.json({ success: false, message: `Minimum purchase amount not met.` });
  }

  const productsInCart = await Product.find({ _id: { $in: productIds }, ...tenant });

  if (!coupon.applicableCategory && !coupon.applicableSubCategory && !coupon.applicableProduct) {
    return res.json({ success: true, message: "Coupon applicable for all products.", data: coupon });
  }

  if (coupon.applicableProduct) {
    const requiredProductId = coupon.applicableProduct.toString();
    const isProductInCart = productsInCart.some(p => p._id.toString() === requiredProductId);
    if (!isProductInCart) return res.json({ success: false, message: "Specific product not in cart." });
  } else if (coupon.applicableCategory || coupon.applicableSubCategory) {
    const isValid = productsInCart.some(product => {
      let categoryMatch = true;
      let subCategoryMatch = true;
      if (coupon.applicableCategory) categoryMatch = coupon.applicableCategory.toString() === product.proCategoryId?.toString();
      if (coupon.applicableSubCategory) subCategoryMatch = coupon.applicableSubCategory.toString() === product.proSubCategoryId?.toString();
      return categoryMatch && subCategoryMatch;
    });
    if (!isValid) return res.json({ success: false, message: "Coupon not applicable to cart items." });
  }

  res.json({ success: true, message: "Coupon applicable.", data: coupon });
}));

router.post('/', vendorOrAdmin, asyncHandler(async (req, res) => {
  const { couponCode, discountType, discountAmount, minimumPurchaseAmount, endDate, status, applicableCategory, applicableSubCategory, applicableProduct } = req.body;
  if (!couponCode || !discountType || !discountAmount || !endDate || !status) {
    return res.status(400).json({ success: false, message: "Required fields missing." });
  }

  const coupon = new Coupon(stampCompany({
    couponCode, discountType, discountAmount, minimumPurchaseAmount, endDate, status,
    applicableCategory, applicableSubCategory, applicableProduct,
    vendorId: req.user._id
  }, req.companyId));

  const newCoupon = await coupon.save();
  res.json({ success: true, message: "Coupon created successfully.", data: newCoupon });
}));

router.put('/:id', vendorOrAdmin, asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({ _id: req.params.id, ...companyFilter(req.companyId) });
  if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found." });
  if (req.user.role !== 'admin' && coupon.vendorId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized to edit this coupon." });
  }

  const { couponCode, discountType, discountAmount, minimumPurchaseAmount, endDate, status, applicableCategory, applicableSubCategory, applicableProduct } = req.body;
  if (!couponCode || !discountType || !discountAmount || !endDate || !status) {
    return res.status(400).json({ success: false, message: "Required fields missing." });
  }

  const updatedCoupon = await Coupon.findOneAndUpdate(
    { _id: req.params.id, ...companyFilter(req.companyId) },
    { couponCode, discountType, discountAmount, minimumPurchaseAmount, endDate, status, applicableCategory, applicableSubCategory, applicableProduct },
    { new: true }
  );

  res.json({ success: true, message: "Coupon updated successfully.", data: updatedCoupon });
}));

router.delete('/:id', vendorOrAdmin, asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({ _id: req.params.id, ...companyFilter(req.companyId) });
  if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found." });
  if (req.user.role !== 'admin' && coupon.vendorId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized to delete this coupon." });
  }

  await Coupon.findOneAndDelete({ _id: req.params.id, ...companyFilter(req.companyId) });
  res.json({ success: true, message: "Coupon deleted successfully." });
}));

module.exports = router;
