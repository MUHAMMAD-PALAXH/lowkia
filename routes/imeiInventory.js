const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ItemTrack = require('../model/itemTrack');
const ProductVariant = require('../model/productVariant');
const Order = require('../model/order');
const Branch = require('../model/branch');
const { protect, vendorOrAdmin } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');

// =========================================================
// 🚀 DYNAMIC FETCH: GET ALL DISTRIBUTION BRANCHES
// =========================================================
router.get('/branches', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const allBranches = await Branch.find({}).lean();

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
  const { name, location, phone, isActive } = req.body; // 'phone' যোগ করুন

  if (!name || !location) {
    return res.status(400).json({ success: false, message: "Branch name and location are required." });
  }

  const newBranch = new Branch({
    name,
    location,
    phone: phone || '', // ফোন নম্বর না থাকলে ফাঁকা স্ট্রিং
    isActive: isActive ?? true
  });

  const createdBranch = await newBranch.save();
  res.status(201).json({ success: true, data: createdBranch });
}));

// =========================================================
// STEP 2A: DISPATCH TRANSFER (Set Status to 'in-transit')
// =========================================================
router.put('/transfer/dispatch', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const { imeis, targetBranchId } = req.body;

  if (!Array.isArray(imeis) || imeis.length === 0 || !targetBranchId) {
    return res.status(400).json({ success: false, message: "IMEI items and target branch are mandatory." });
  }

  const cleanImeis = imeis.map(i => i.trim());

  const result = await ItemTrack.updateMany(
    { imei: { $in: cleanImeis }, status: 'available' },
    { 
      $set: { status: 'in-transit' },
      $push: { history: { status: 'in-transit', branchId: targetBranchId, updatedBy: req.user._id, notes: 'Dispatched to branch transit' } }
    }
  );

  if (result.matchedCount === 0) {
    return res.status(404).json({ success: false, message: "No available matching IMEI records found to dispatch." });
  }

  res.json({ success: true, message: `${result.modifiedCount} units are now marked 'in-transit'.` });
}));

// =========================================================
// STEP 2B: RECEIVE TRANSFER (Set Status back to 'available')
// =========================================================
router.put('/transfer/receive', protect, vendorOrAdmin, asyncHandler(async (req, res) => {
  const { imeis, receivingBranchId } = req.body;

  if (!Array.isArray(imeis) || imeis.length === 0 || !receivingBranchId) {
    return res.status(400).json({ success: false, message: "Scanned items and destination identifier required." });
  }

  const cleanImeis = imeis.map(i => i.trim());

  const result = await ItemTrack.updateMany(
    { imei: { $in: cleanImeis }, status: 'in-transit' },
    {
      $set: { status: 'available', currentBranchId: receivingBranchId },
      $push: { history: { status: 'available', branchId: receivingBranchId, updatedBy: req.user._id, notes: 'Received into physical branch inventory' } }
    }
  );

  res.json({ success: true, message: `${result.modifiedCount} units safely received at target branch.` });
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

    // 4. Update IMEI Status Metadata (Bulk update)
    const dynamicExpiry = new Date();
    dynamicExpiry.setFullYear(dynamicExpiry.getFullYear() + 1);

    await ItemTrack.updateMany(
      { imei: { $in: orderImeis } },
      {
        $set: {
          status: 'sold',
          currentBranchId: null, // Clear branch footprint upon sale
          'saleInfo.orderId': savedOrder._id,
          'saleInfo.customerPhone': shippingAddress?.phone || '',
          'saleInfo.soldPrice': orderTotal.total / orderImeis.length,
          'saleInfo.soldDate': new Date(),
          warrantyExpiry: dynamicExpiry
        },
        $push: { 
          history: { 
            status: 'sold', 
            updatedBy: req.user._id, 
            notes: `Sold via POS Invoice: ${savedOrder._id}` 
          } 
        }
      },
      { session }
    );

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
  const item = await ItemTrack.findOne({ imei: req.params.imei.trim() })
    .populate('productId', 'name description')
    .populate('variantId')
    .lean();

  if (!item) {
    return res.status(404).json({ success: false, message: "IMEI record not found in system storage." });
  }

  const currentDate = new Date();
  const hasWarranty = item.warrantyExpiry ? new Date(item.warrantyExpiry) > currentDate : false;
  const daysLeft = item.warrantyExpiry 
    ? Math.max(0, Math.ceil((new Date(item.warrantyExpiry) - currentDate) / (1000 * 60 * 60 * 24)))
    : 0;

  res.json({
    success: true,
    data: {
      imei: item.imei,
      productName: item.productId?.name,
      variantSpecs: item.variantId?.attributes,
      status: item.status,
      customerPhone: item.saleInfo?.customerPhone || 'N/A',
      soldDate: item.saleInfo?.soldDate || null,
      warrantyExpiry: item.warrantyExpiry || null,
      isWarrantyValid: hasWarranty,
      daysRemaining: daysLeft,
      lifecycleHistory: item.history
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