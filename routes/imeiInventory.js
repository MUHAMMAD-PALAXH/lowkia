const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ItemTrack = require('../model/itemTrack');
const ProductVariant = require('../model/productVariant');
const Order = require('../model/order');
const Branch = require('../model/branch');
const BranchTransfer = require('../model/branchTransfer');
const { protect, vendorOrAdmin } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');

// =========================================================
// 🚀 DYNAMIC FETCH: GET ALL DISTRIBUTION BRANCHES
// =========================================================
router.get('/branches', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const allBranches = await Branch.find({ isDeleted: { $ne: true } }).lean();

  if (!allBranches || allBranches.length === 0) {
    return res.status(404).json({ success: false, message: "No distribution hubs found in database." });
  }

  res.json({ success: true, data: allBranches });
}));

// =========================================================
// STEP 1: STOCK IN (Bulk creation of unique IMEI units)
// =========================================================
router.post('/stock-in', protect, asyncHandler(async (req, res) => {
    const { productId, variantId, currentBranchId, imeis } = req.body;

    if (!productId || !variantId || !currentBranchId || !imeis || imeis.length === 0) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    // Verify the variant exists
    const variantExists = await ProductVariant.findById(variantId);
    if (!variantExists) {
        return res.status(404).json({ success: false, message: "Variant not found." });
    }

    // Prepare data with the required fields
    const stockItems = imeis.map(imei => ({
        productId: productId,
        variantId: variantId,
        currentBranchId: currentBranchId, // Correct field name
        vendorId: req.user._id,           // CRITICAL: Added missing vendorId
        imei: imei.trim(),
        status: 'available',
        createdAt: new Date()
    }));

    try {
        // Attempt insertion
        const result = await ItemTrack.insertMany(stockItems);
        console.log("Success! Items added:", result.length);
        res.json({ success: true, message: `${imeis.length} items added to stock.` });
    } catch (error) {
        // Log the actual validation error if it happens
        console.error("Mongoose Validation Error:", error);
        res.status(500).json({ success: false, message: "Error saving stock: " + error.message });
    }
}));

// =========================================================
// 🚀 CREATE NEW BRANCH
// =========================================================
router.post('/add-branch', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  // Legacy endpoint — prefer POST /api/branches
  const branchService = require('../services/branchService');
  const { name, location, phone, isActive, city, address, warehouseIds } = req.body;

  if (!name || (!location && !city)) {
    return res.status(400).json({ success: false, message: "Branch name and location/city are required." });
  }

  try {
    const createdBranch = await branchService.createBranch(
      {
        name,
        location,
        city: city || location,
        address: address || location || "",
        phone: phone || "",
        isActive: isActive ?? true,
        warehouseIds: warehouseIds || []
      },
      req.user?._id || null
    );

    res.status(201).json({ success: true, data: createdBranch });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message
    });
  }
}));

const transferPopulate = (query) => query
  .populate('productId', 'name productCode trackingType')
  .populate('variantId', 'combinationString sku')
  .populate('fromBranchId', 'name branchCode city')
  .populate('toBranchId', 'name branchCode city');

router.get('/transfers', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim();
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { transferNumber: { $regex: search, $options: 'i' } },
      { imeis: { $elemMatch: { $regex: search, $options: 'i' } } }
    ];
  }
  const items = await transferPopulate(
    BranchTransfer.find(filter).sort({ dispatchedAt: -1 }).lean()
  );
  res.json({ success: true, data: items });
}));

router.get('/transfers/in-transit', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const items = await transferPopulate(
    BranchTransfer.find({ status: 'In Transit' })
      .sort({ dispatchedAt: -1 })
      .lean()
  );
  res.json({ success: true, data: items });
}));

router.get('/transfers/history', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const items = await transferPopulate(
    BranchTransfer.find({ status: { $in: ['Completed', 'Cancelled'] } })
      .sort({ dispatchedAt: -1 })
      .lean()
  );
  res.json({ success: true, data: items });
}));

// Dispatch only when every IMEI belongs to the selected product, variant and
// source branch. Partial updates are rejected to keep a manifest atomic.
router.put('/transfer/dispatch', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const {
    imeis,
    productId,
    variantId,
    fromBranchId,
    targetBranchId,
    note
  } = req.body;

  if (
    !Array.isArray(imeis) ||
    imeis.length === 0 ||
    !productId ||
    !variantId ||
    !fromBranchId ||
    !targetBranchId
  ) {
    return res.status(400).json({
      success: false,
      message: 'Product, variant, source, target and IMEI items are mandatory.'
    });
  }
  if (String(fromBranchId) === String(targetBranchId)) {
    return res.status(400).json({
      success: false,
      message: 'Source and target branches must be different.'
    });
  }

  const cleanImeis = [...new Set(
    imeis.map((value) => String(value || '').trim()).filter(Boolean)
  )];
  if (cleanImeis.length !== imeis.length) {
    return res.status(400).json({
      success: false,
      message: 'IMEIs must be non-empty and unique.'
    });
  }

  const [fromBranch, toBranch, tracks] = await Promise.all([
    Branch.findById(fromBranchId).lean(),
    Branch.findById(targetBranchId).lean(),
    ItemTrack.find({
      imei: { $in: cleanImeis },
      productId,
      variantId,
      currentBranchId: fromBranchId,
      status: 'available'
    }).lean()
  ]);
  if (!fromBranch || !toBranch) {
    return res.status(404).json({
      success: false,
      message: 'Source or target branch was not found.'
    });
  }
  if (tracks.length !== cleanImeis.length) {
    const found = new Set(tracks.map((item) => item.imei));
    const invalid = cleanImeis.filter((imei) => !found.has(imei));
    return res.status(409).json({
      success: false,
      message: `These IMEIs are not available at the source branch: ${invalid.join(', ')}`
    });
  }

  const transferNumber = `BTR-${Date.now()}`;
  const transfer = await BranchTransfer.create({
    transferNumber,
    productId,
    variantId,
    fromBranchId,
    toBranchId: targetBranchId,
    imeis: cleanImeis,
    note: String(note || '').trim(),
    dispatchedBy: req.user._id
  });

  await ItemTrack.updateMany(
    { _id: { $in: tracks.map((item) => item._id) }, status: 'available' },
    {
      $set: {
        status: 'in-transit',
        transferInfo: {
          transferId: transfer._id,
          transferNumber,
          fromBranchId,
          toBranchId: targetBranchId,
          dispatchedAt: transfer.dispatchedAt
        }
      },
      $push: {
        history: {
          status: 'in-transit',
          branchId: targetBranchId,
          updatedBy: req.user._id,
          notes: `Dispatched as ${transferNumber}`
        }
      }
    }
  );

  const populated = await transferPopulate(
    BranchTransfer.findById(transfer._id).lean()
  );
  res.json({
    success: true,
    message: `${cleanImeis.length} units dispatched as ${transferNumber}.`,
    data: populated
  });
}));

router.put('/transfer/receive/:id', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const transfer = await BranchTransfer.findById(req.params.id);
  if (!transfer) {
    return res.status(404).json({ success: false, message: 'Transfer not found.' });
  }
  if (transfer.status !== 'In Transit') {
    return res.status(409).json({
      success: false,
      message: `Transfer is already ${transfer.status.toLowerCase()}.`
    });
  }

  const scanned = Array.isArray(req.body.imeis)
    ? [...new Set(req.body.imeis.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  const expected = [...transfer.imeis].sort();
  if (
    scanned.length !== expected.length ||
    scanned.sort().some((imei, index) => imei !== expected[index])
  ) {
    return res.status(400).json({
      success: false,
      message: 'Received IMEIs must exactly match the dispatched manifest.'
    });
  }

  const result = await ItemTrack.updateMany(
    {
      imei: { $in: transfer.imeis },
      status: 'in-transit',
      'transferInfo.transferId': transfer._id
    },
    {
      $set: {
        status: 'available',
        currentBranchId: transfer.toBranchId,
        transferInfo: null
      },
      $push: {
        history: {
          status: 'available',
          branchId: transfer.toBranchId,
          updatedBy: req.user._id,
          notes: `Received from ${transfer.transferNumber}`
        }
      }
    }
  );
  if (result.modifiedCount !== transfer.imeis.length) {
    return res.status(409).json({
      success: false,
      message: 'Some manifest units are no longer in transit. Refresh and investigate before receiving.'
    });
  }

  transfer.status = 'Completed';
  transfer.receivedBy = req.user._id;
  transfer.receivedAt = new Date();
  await transfer.save();

  res.json({
    success: true,
    message: `${result.modifiedCount} units received at the destination branch.`
  });
}));

// =========================================================
// STEP 3: POS CHECKOUT (Concurrence & Transaction Secured)
// =========================================================
router.post('/pos/checkout', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const { userID, items, shippingAddress, paymentMethod, couponCode, orderTotal, branchId } = req.body;

  // 1. Validation & Pre-flight
  const orderImeis = items.flatMap(item => item.imeis || []).map(i => i.trim());
  
  if (!branchId || orderImeis.length === 0) {
    return res.status(400).json({ success: false, message: "Branch ID and valid IMEI numbers are required for POS billing." });
  }

  // ACID Transaction session for data integrity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Availability Check: Ensure IMEIs are available in the current branch
    const targets = await ItemTrack.find({
      imei: { $in: orderImeis },
      status: 'available',
      currentBranchId: branchId
    }).session(session);

    if (targets.length !== orderImeis.length) {
      const foundImeis = targets.map(t => t.imei);
      const missingImeis = orderImeis.filter(i => !foundImeis.includes(i));
      throw new Error(`Inventory mismatch: The following devices are not available in this branch: ${missingImeis.join(', ')}`);
    }

    // 3. Create Order Document
    const order = new Order({
      userID,
      items: items.map(item => ({
        productID: item.productID,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
        variant: item.variant,
        sId: item.sId,
        imeis: item.imeis
      })),
      totalPrice: orderTotal.total,
      shippingAddress,
      paymentMethod,
      couponCode,
      orderTotal,
      orderStatus: 'delivered',
      branchId
    });

    const savedOrder = await order.save({ session });

    // 4. Update IMEI Status Metadata (per unit — warranty from product)
    const Product = require('../model/product');
    const soldDate = new Date();
    for (const track of targets) {
      const product = await Product.findById(track.productId)
        .select('warrantyType warrantyPeriod')
        .session(session)
        .lean();
      const wType = product?.warrantyType || 'No Warranty';
      const wPeriod = Number(product?.warrantyPeriod) || 0;
      let warrantyExpiry = null;
      if (wType === 'Lifetime') {
        warrantyExpiry = new Date('9999-12-31T00:00:00.000Z');
      } else if (wType !== 'No Warranty' && wPeriod > 0) {
        warrantyExpiry = new Date(soldDate);
        if (wType === 'Days') warrantyExpiry.setDate(warrantyExpiry.getDate() + wPeriod);
        else if (wType === 'Months') warrantyExpiry.setMonth(warrantyExpiry.getMonth() + wPeriod);
        else if (wType === 'Years') warrantyExpiry.setFullYear(warrantyExpiry.getFullYear() + wPeriod);
      }

      track.status = 'sold';
      track.currentBranchId = null;
      track.saleInfo = {
        ...(track.saleInfo || {}),
        orderId: savedOrder._id,
        customerPhone: shippingAddress?.phone || '',
        soldPrice: orderTotal.total / orderImeis.length,
        soldDate
      };
      if (warrantyExpiry) track.warrantyExpiry = warrantyExpiry;
      track.history = track.history || [];
      track.history.push({
        status: 'sold',
        updatedBy: req.user._id,
        notes: `Sold via POS Invoice: ${savedOrder._id} • Warranty: ${wType === 'Lifetime' ? 'Lifetime' : wType === 'No Warranty' ? 'No Warranty' : `${wPeriod} ${wType}`}`
      });
      await track.save({ session });
    }

    // 5. Optimized Variant Decrement (Grouped bulk updates)
    // Map items to their variant counts to avoid O(N) database calls
    const variantDecrementMap = new Map();
    
    targets.forEach(item => {
      const vid = item.variantId.toString();
      variantDecrementMap.set(vid, (variantDecrementMap.get(vid) || 0) + 1);
    });

    for (const [variantId, count] of variantDecrementMap) {
      await ProductVariant.findByIdAndUpdate(
        variantId, 
        { $inc: { quantity: -count } }, 
        { session }
      );
    }

    // 6. Commit Transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ 
      success: true, 
      message: "Order finalized successfully.", 
      orderId: savedOrder._id 
    });

  } catch (err) {
    // Rollback on any failure
    await session.abortTransaction();
    session.endSession();
    console.error("POS Checkout Error:", err);
    res.status(400).json({ success: false, message: err.message || "Failed to process checkout." });
  }
}));

// =========================================================
// UPDATE BRANCH
// =========================================================
router.put('/update-branch/:id', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const { name, location, phone, isActive } = req.body; // <--- এখানে 'phone' রিসিভ করছেন কি?
  
  const updatedBranch = await Branch.findByIdAndUpdate(
    req.params.id,
    { 
      name, 
      location, 
      phone: phone, // <--- এখানে ডাটাবেজে পাঠাচ্ছেন কি?
      isActive 
    },
    { new: true }
  );
  
  if (!updatedBranch) return res.status(404).json({ message: "Branch not found" });
  
  res.json({ success: true, data: updatedBranch });
}));

// =========================================================
// DELETE BRANCH
// =========================================================
router.delete('/delete-branch/:id', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const deletedBranch = await Branch.findByIdAndDelete(req.params.id);

  if (!deletedBranch) {
    return res.status(404).json({ success: false, message: "Branch not found." });
  }

  res.json({ success: true, message: "Branch deleted successfully." });
}));

// =========================================================
// STEP 4: SERVICE LOOKUP & JOB CARD TICKET GENERATOR
// =========================================================
router.get('/search/:imei', protect, asyncHandler(async (req, res) => {
  const raw = String(req.params.imei || "").trim();
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const item = await ItemTrack.findOne({
    imei: { $regex: `^${escaped}$`, $options: "i" }
  })
    .populate('productId', 'name description warrantyType warrantyPeriod')
    .populate('variantId')
    .lean();

  if (!item) {
    return res.status(404).json({ success: false, message: "IMEI record not found in system storage." });
  }

  const currentDate = new Date();
  const productWarrantyType = item.productId?.warrantyType || 'No Warranty';
  const productWarrantyPeriod = Number(item.productId?.warrantyPeriod) || 0;
  const isLifetime =
    productWarrantyType === 'Lifetime' ||
    (item.warrantyExpiry && new Date(item.warrantyExpiry).getFullYear() >= 9999);

  let isWarrantyValid = false;
  let daysLeft = 0;
  let warrantyStatus = 'None';

  if (isLifetime) {
    isWarrantyValid = item.status === 'sold' || !!item.saleInfo?.soldDate;
    daysLeft = null;
    warrantyStatus = 'Lifetime';
  } else if (item.warrantyExpiry) {
    const expiry = new Date(item.warrantyExpiry);
    isWarrantyValid = expiry > currentDate;
    daysLeft = Math.max(0, Math.ceil((expiry - currentDate) / (1000 * 60 * 60 * 24)));
    warrantyStatus = isWarrantyValid ? 'Active' : 'Expired';
  } else if (productWarrantyType === 'No Warranty') {
    warrantyStatus = 'None';
  }

  const history = (item.history || []).map((h) => ({
    status: h.status,
    notes: h.notes,
    branchId: h.branchId,
    updatedAt: h.date || h.updatedAt || h.timestamp || null,
    date: h.date || h.updatedAt || h.timestamp || null
  }));

  res.json({
    success: true,
    data: {
      imei: item.imei,
      productName: item.productId?.name,
      variantSpecs: item.variantId?.attributes || item.variantId?.combinationString,
      status: item.status,
      customerPhone: item.saleInfo?.customerPhone || 'N/A',
      soldDate: item.saleInfo?.soldDate || null,
      salesOrderId: item.saleInfo?.orderId || null,
      warrantyType: productWarrantyType,
      warrantyPeriod: productWarrantyPeriod,
      warrantyExpiry: isLifetime ? null : (item.warrantyExpiry || null),
      isWarrantyValid,
      daysRemaining: daysLeft,
      warrantyStatus,
      lifecycleHistory: history
    }
  });
}));

// Optional: Service center updates item status to repairing
router.put('/repair/issue-ticket', protect, asyncHandler(async (req, res) => {
  const { imei, notes } = req.body;
  
  const result = await ItemTrack.findOneAndUpdate(
    { imei: imei.trim() },
    { 
      $set: { status: 'repairing' },
      $push: { history: { status: 'repairing', updatedBy: req.user._id, notes: notes || 'Job card issued' } }
    },
    { new: true }
  );

  if (!result) return res.status(404).json({ success: false, message: "IMEI not found." });
  res.json({ success: true, message: "Item status changed to 'repairing'. Ticket issued.", data: result });
}));

module.exports = router;