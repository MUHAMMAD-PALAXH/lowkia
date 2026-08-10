const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const ProductVariant = require('../model/productVariant');
const ItemTrack = require('../model/itemTrack');
const { uploadProduct } = require('../uploadFile');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const { protect, vendorOrAdmin } = require('../middleware/auth');

// ====================== Helper Functions ======================
function safeObjectId(value) {
  if (!value || value === 'null' || value == null || value === '') return undefined;
  try { return new mongoose.Types.ObjectId(value); } catch { return undefined; }
}

const parseVariants = (input) => {
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return []; }
  }
  return Array.isArray(input) ? input : [];
};

const parseIdArray = (input) => {
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return []; }
  }
  return Array.isArray(input) 
    ? input.filter(id => /^[0-9a-fA-F]{24}$/.test(id)).map(safeObjectId)
    : [];
};

// ====================== PUBLIC ROUTES ======================

router.get('/last-update', asyncHandler(async (req, res) => {
  const latest = await Product.findOne().sort({ updatedAt: -1 }).select('updatedAt');
  res.json({ success: true, last_updated: latest?.updatedAt });
}));

// Advanced Filter + Pagination
router.get('/', asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 20, search, status, isPublished, 
    proCategoryId, proSubCategoryId, proBrandId, vendorId,
    isFeatured, isNewArrival, isBestSeller, isTrending, isRecommended,
    minPrice, maxPrice, sortBy = 'createdAt', order = 'desc'
  } = req.query;

  const query = { isDeleted: false };

  // User app must not sell unapproved employee/vendor uploads.
  // Older products without approvalStatus are treated as approved.
  query.$and = [
    {
      $or: [
        { approvalStatus: "Approved" },
        { approvalStatus: { $exists: false } },
        { approvalStatus: null }
      ]
    }
  ];

  if (status) query.status = status;
  if (isPublished !== undefined) query.isPublished = isPublished === 'true';
  if (proCategoryId) query.proCategoryId = safeObjectId(proCategoryId);
  if (proSubCategoryId) query.proSubCategoryId = safeObjectId(proSubCategoryId);
  if (proBrandId) query.proBrandId = safeObjectId(proBrandId);
  if (vendorId) query.vendorId = safeObjectId(vendorId);

  if (isFeatured === 'true') query.isFeatured = true;
  if (isNewArrival === 'true') query.isNewArrival = true;
  if (isBestSeller === 'true') query.isBestSeller = true;
  if (isTrending === 'true') query.isTrending = true;
  if (isRecommended === 'true') query.isRecommended = true;

  if (minPrice || maxPrice) {
    query.sellingPrice = {};
    if (minPrice) query.sellingPrice.$gte = Number(minPrice);
    if (maxPrice) query.sellingPrice.$lte = Number(maxPrice);
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { productCode: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const sort = {}; 
  sort[sortBy] = order === 'asc' ? 1 : -1;

  const products = await Product.find(query)
    .populate('proCategoryId', 'name')
    .populate('proSubCategoryId', 'name')
    .populate('proBrandId', 'name')
    .populate('proVariantTypeId', 'type')
    .sort(sort)
    .skip((page - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  const total = await Product.countDocuments(query);

  res.json({
    success: true,
    data: products,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// Get Single Product
router.get('/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('proCategoryId proSubCategoryId proBrandId proVariantTypeId vendorId');

  if (!product) return res.status(404).json({ success: false, message: "প্রোডাক্ট পাওয়া যায়নি।" });

  const variants = await ProductVariant.find({ productId: req.params.id }).lean();
  const inventory = await ItemTrack.find({ productId: req.params.id }).lean();

  const obj = product.toObject();
  obj.productVariants = variants.map(v => {
    const imeis = inventory
      .filter(i => i.variantId?.toString() === v._id?.toString())
      .map(i => ({ imei: i.imei, status: i.status, branchId: i.branchId }));
    return { ...v, imeis };
  });

  res.json({ success: true, data: obj });
}));

// ====================== PROTECTED ROUTES ======================

// Create Product
router.post('/', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  uploadProduct.fields([
    { name: 'image1', maxCount: 1 }, { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 }, { name: 'image4', maxCount: 1 },
    { name: 'image5', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 },
    { name: 'brochure', maxCount: 1 }
  ])(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const body = req.body;
    const images = [];

    ['image1','image2','image3','image4','image5'].forEach((f, i) => {
      if (req.files[f]?.[0]) {
        images.push({
          url: req.files[f][0].path,
          publicId: req.files[f][0].filename || '',
          isPrimary: i === 0,
          alt: body[`alt${i+1}`] || ''
        });
      }
    });

    const productData = {
      vendorId: req.user._id,

      name: body.name,
      description: body.description,

      productCode: body.productCode?.toUpperCase(),
      sku: body.sku?.toUpperCase(),
      slug: body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),

      proCategoryId: safeObjectId(body.proCategoryId),
      proSubCategoryId: safeObjectId(body.proSubCategoryId),
      proBrandId: safeObjectId(body.proBrandId),
      unitId: safeObjectId(body.unitId),

      productType: body.productType || "Simple",
      proVariantTypeId: safeObjectId(body.proVariantTypeId),
      proVariantId: parseIdArray(body.proVariantId),

      purchasePrice: Number(body.purchasePrice) || 0,
      costPrice: Number(body.costPrice) || 0,
      sellingPrice: Number(body.sellingPrice) || 0,
      wholesalePrice: Number(body.wholesalePrice) || 0,
      minimumSellingPrice: Number(body.minimumSellingPrice) || 0,
      maximumSellingPrice: Number(body.maximumSellingPrice) || 0,

      taxType: body.taxType || "No Tax",
      taxPercentage: Number(body.taxPercentage) || 0,
      taxCode: body.taxCode,

      manufacturer: body.manufacturer,
      countryOfOrigin: body.countryOfOrigin || "Bangladesh",
      warrantyPeriod: Number(body.warrantyPeriod) || 0,
      warrantyType: body.warrantyType || "No Warranty",

      hsnCode: body.hsnCode,
      barcode: body.barcode,
      qrCode: body.qrCode,

      images,
      thumbnail: req.files.thumbnail?.[0]?.path || body.thumbnail,
      videoUrl: body.videoUrl,
      brochure: req.files.brochure?.[0]?.path || body.brochure,

      tags: typeof body.tags === 'string' ? JSON.parse(body.tags || '[]') : body.tags || [],
      searchKeywords: typeof body.searchKeywords === 'string' ? JSON.parse(body.searchKeywords || '[]') : [],
      metaTitle: body.metaTitle || body.name,
      metaDescription: body.metaDescription,
      metaKeywords: typeof body.metaKeywords === 'string' ? JSON.parse(body.metaKeywords || '[]') : [],

      status: body.status || "Draft",
      visibility: body.visibility || "Public",
      isPublished: body.isPublished === 'true',
      isFeatured: body.isFeatured === 'true',
      isNewArrival: body.isNewArrival === 'true',
      isBestSeller: body.isBestSeller === 'true',
      isTrending: body.isTrending === 'true',
      isRecommended: body.isRecommended === 'true',

      allowBackorder: body.allowBackorder === 'true',
      isReturnable: body.isReturnable !== 'false',
      returnDays: Number(body.returnDays) || 7,

      publishStartDate: body.publishStartDate ? new Date(body.publishStartDate) : null,
      publishEndDate: body.publishEndDate ? new Date(body.publishEndDate) : null,

      sortOrder: Number(body.sortOrder) || 0,
      showOnHomepage: body.showOnHomepage === 'true',
      showInMobileApp: body.showInMobileApp !== 'false',
      showOnWebsite: body.showOnWebsite !== 'false',

      notes: body.notes,
      createdBy: req.user._id,
    };

    const newProduct = await Product.create(productData);

    // Variants + IMEI
    const variants = parseVariants(body.productVariants);
    for (let v of variants) {
      const savedVariant = await ProductVariant.create({
        productId: newProduct._id,
        ...v,
        attributes: (v.attributes || []).map(a => ({
          variantTypeId: safeObjectId(a.variantTypeId),
          variantId: safeObjectId(a.variantId)
        }))
      });

      if (v.imeis && Array.isArray(v.imeis) && v.imeis.length > 0) {
        const imeiDocs = v.imeis.map(imei => ({
          productId: newProduct._id,
          variantId: savedVariant._id,
          imei: imei.toString().trim(),
          status: 'available',
          supplierId: safeObjectId(body.supplierId),
          branchId: safeObjectId(body.branchId)
        }));
        await ItemTrack.insertMany(imeiDocs);
      }
    }

    res.status(201).json({ success: true, message: "প্রোডাক্ট সফলভাবে তৈরি হয়েছে।", data: newProduct });
  });
}));

// Update Product (সম্পূর্ণ ইমেজ লজিক সহ)
router.put('/:id', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  uploadProduct.fields([
    { name: 'image1', maxCount: 1 }, { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 }, { name: 'image4', maxCount: 1 },
    { name: 'image5', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 },
    { name: 'brochure', maxCount: 1 }
  ])(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "প্রোডাক্ট পাওয়া যায়নি।" });

    if (req.user.role !== 'admin' && product.vendorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "অনুমতি নেই।" });
    }

    const body = req.body;

    // Update All Fields
    product.name = body.name || product.name;
    product.description = body.description || product.description;
    product.productCode = body.productCode ? body.productCode.toUpperCase() : product.productCode;
    product.sku = body.sku ? body.sku.toUpperCase() : product.sku;
    product.slug = body.slug || product.slug;

    product.proCategoryId = safeObjectId(body.proCategoryId) || product.proCategoryId;
    product.proSubCategoryId = safeObjectId(body.proSubCategoryId) || product.proSubCategoryId;
    product.proBrandId = safeObjectId(body.proBrandId) || product.proBrandId;
    product.unitId = safeObjectId(body.unitId) || product.unitId;

    product.productType = body.productType || product.productType;
    product.proVariantTypeId = safeObjectId(body.proVariantTypeId) || product.proVariantTypeId;
    product.proVariantId = parseIdArray(body.proVariantId).length ? parseIdArray(body.proVariantId) : product.proVariantId;

    product.purchasePrice = Number(body.purchasePrice) || product.purchasePrice;
    product.costPrice = Number(body.costPrice) || product.costPrice;
    product.sellingPrice = Number(body.sellingPrice) || product.sellingPrice;
    product.wholesalePrice = Number(body.wholesalePrice) || product.wholesalePrice;
    product.minimumSellingPrice = Number(body.minimumSellingPrice) || product.minimumSellingPrice;
    product.maximumSellingPrice = Number(body.maximumSellingPrice) || product.maximumSellingPrice;

    product.taxType = body.taxType || product.taxType;
    product.taxPercentage = Number(body.taxPercentage) || product.taxPercentage;
    product.taxCode = body.taxCode || product.taxCode;

    product.manufacturer = body.manufacturer || product.manufacturer;
    product.countryOfOrigin = body.countryOfOrigin || product.countryOfOrigin;
    product.warrantyPeriod = Number(body.warrantyPeriod) || product.warrantyPeriod;
    product.warrantyType = body.warrantyType || product.warrantyType;

    product.hsnCode = body.hsnCode || product.hsnCode;
    product.barcode = body.barcode || product.barcode;
    product.qrCode = body.qrCode || product.qrCode;

    product.videoUrl = body.videoUrl || product.videoUrl;
    product.notes = body.notes || product.notes;

    product.tags = typeof body.tags === 'string' ? JSON.parse(body.tags || '[]') : body.tags || product.tags;
    product.searchKeywords = typeof body.searchKeywords === 'string' ? JSON.parse(body.searchKeywords || '[]') : body.searchKeywords || product.searchKeywords;
    product.metaTitle = body.metaTitle || product.metaTitle;
    product.metaDescription = body.metaDescription || product.metaDescription;
    product.metaKeywords = typeof body.metaKeywords === 'string' ? JSON.parse(body.metaKeywords || '[]') : body.metaKeywords || product.metaKeywords;

    product.status = body.status || product.status;
    product.visibility = body.visibility || product.visibility;
    product.isPublished = body.isPublished === 'true' || product.isPublished;
    product.isFeatured = body.isFeatured === 'true' || product.isFeatured;
    product.isNewArrival = body.isNewArrival === 'true' || product.isNewArrival;
    product.isBestSeller = body.isBestSeller === 'true' || product.isBestSeller;
    product.isTrending = body.isTrending === 'true' || product.isTrending;
    product.isRecommended = body.isRecommended === 'true' || product.isRecommended;

    product.allowBackorder = body.allowBackorder === 'true' || product.allowBackorder;
    product.isReturnable = body.isReturnable !== 'false';
    product.returnDays = Number(body.returnDays) || product.returnDays;

    product.publishStartDate = body.publishStartDate ? new Date(body.publishStartDate) : product.publishStartDate;
    product.publishEndDate = body.publishEndDate ? new Date(body.publishEndDate) : product.publishEndDate;

    product.sortOrder = Number(body.sortOrder) || product.sortOrder;
    product.showOnHomepage = body.showOnHomepage === 'true' || product.showOnHomepage;
    product.showInMobileApp = body.showInMobileApp !== 'false';
    product.showOnWebsite = body.showOnWebsite !== 'false';

    // ====================== Images Update Logic ======================
    ['image1','image2','image3','image4','image5'].forEach((f, i) => {
      if (req.files[f]?.[0]) {
        const newUrl = req.files[f][0].path;
        const existingIndex = product.images.findIndex(img => img.image === i+1 || img.isPrimary === (i === 0));
        
        if (existingIndex !== -1) {
          product.images[existingIndex].url = newUrl;
        } else {
          product.images.push({
            url: newUrl,
            publicId: req.files[f][0].filename || '',
            isPrimary: i === 0,
            alt: body[`alt${i+1}`] || ''
          });
        }
      }
    });

    if (req.files.thumbnail?.[0]) {
      product.thumbnail = req.files.thumbnail[0].path;
    }
    if (req.files.brochure?.[0]) {
      product.brochure = req.files.brochure[0].path;
    }

    await product.save();

    res.json({ success: true, message: "প্রোডাক্ট সফলভাবে আপডেট হয়েছে।", data: product });
  });
}));

// Soft Delete
router.delete('/:id', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "প্রোডাক্ট পাওয়া যায়নি।" });

  if (req.user.role !== 'admin' && product.vendorId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "অনুমতি নেই।" });
  }

  await product.softDelete(req.user._id);
  await ProductVariant.deleteMany({ productId: req.params.id });
  await ItemTrack.updateMany({ productId: req.params.id }, { status: 'deleted' });

  res.json({ success: true, message: "প্রোডাক্ট সফট ডিলিট হয়েছে।" });
}));

module.exports = router;