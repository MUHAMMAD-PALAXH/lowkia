// routes/order.js
// FINAL SAFE VERSION – uses separate Settings collection for targets

const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();

const Order = require('../model/order');
const Product = require('../model/product');
const ProductVariant = require('../model/productVariant');
const Settings = require('../model/settings'); // ← NEW

const mongoose = require('mongoose');

// ────────────────────────────────────────────────
// Helper: Get or initialize global settings document
// ────────────────────────────────────────────────
async function getGlobalSettings() {
  let settings = await Settings.findOne({ key: 'global' });
  if (!settings) {
    settings = await Settings.create({ key: 'global' });
  }
  return settings;
}

// ────────────────────────────────────────────────
// SALES TARGET ENDPOINTS (admin only – add auth middleware later)
// ────────────────────────────────────────────────

/**
 * GET /orders/admin/sales-targets
 */
router.get('/admin/sales-targets', asyncHandler(async (req, res) => {
  const settings = await getGlobalSettings();
  res.json({
    success: true,
    data: settings.salesTargets
  });
}));

/**
 * PUT /orders/admin/sales-targets
 */
router.put('/admin/sales-targets', asyncHandler(async (req, res) => {
  const { daily, weekly, monthly, yearly } = req.body;
  const settings = await getGlobalSettings();

  if (daily !== undefined)    settings.salesTargets.daily    = Number(daily);
  if (weekly !== undefined)   settings.salesTargets.weekly   = Number(weekly);
  if (monthly !== undefined)  settings.salesTargets.monthly  = Number(monthly);
  if (yearly !== undefined)   settings.salesTargets.yearly   = Number(yearly);

  await settings.save();

  res.json({
    success: true,
    data: settings.salesTargets
  });
}));

// ────────────────────────────────────────────────
// ANALYTICS ENDPOINT – full summary + target + change %
// ────────────────────────────────────────────────

router.get('/admin/analytics', asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;

  let currentStart = new Date();

  switch (period) {
    case 'day':
      currentStart.setHours(0, 0, 0, 0);
      break;
    case 'week':
      currentStart.setDate(currentStart.getDate() - 7);
      break;
    case 'month':
      currentStart.setMonth(currentStart.getMonth() - 1);
      break;
    case 'year':
      currentStart.setFullYear(currentStart.getFullYear() - 1);
      break;
    default:
      currentStart = new Date(0);
  }

  const currentMatch = { createdAt: { $gte: currentStart } };

  // Top 5 products
  const topProducts = await Order.aggregate([
    { $match: currentMatch },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productID',
        name: { $first: '$items.productName' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
      }
    },
    { $sort: { quantity: -1 } },
    { $limit: 5 }
  ]);

  // Main summary stats
  const stats = await Order.aggregate([
    { $match: currentMatch },
    {
      $group: {
        _id: null,
        deliveredRevenue: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        lossRevenue: {
          $sum: { $cond: [{ $in: ['$orderStatus', ['cancelled', 'returned']] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        orderCount: { $sum: 1 }
      }
    }
  ]);

  const summary = stats[0] || { deliveredRevenue: 0, lossRevenue: 0, orderCount: 0 };

  const currentRevenue = summary.deliveredRevenue;

  // Previous period for change %
  let prevStart = new Date(currentStart);

  switch (period) {
    case 'day':   prevStart.setDate(prevStart.getDate() - 1); break;
    case 'week':  prevStart.setDate(prevStart.getDate() - 7); break;
    case 'month': prevStart.setMonth(prevStart.getMonth() - 1); break;
    case 'year':  prevStart.setFullYear(prevStart.getFullYear() - 1); break;
    default:      prevStart = new Date(0);
  }

  const prevMatch = { createdAt: { $gte: prevStart, $lt: currentStart } };

  const prevAgg = await Order.aggregate([
    { $match: prevMatch },
    {
      $group: {
        _id: null,
        prevRevenue: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        }
      }
    }
  ]);

  const prevRevenue = prevAgg[0]?.prevRevenue || 0;
  const changePercent = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  // Current period target
  const settings = await getGlobalSettings();
  const targetForPeriod = Number(settings.salesTargets?.[period] || 0);

  res.json({
    success: true,
    data: {
      summary,
      topProducts,
      currentRevenue,
      salesTargetForPeriod: targetForPeriod,
      changePercent: Number(changePercent.toFixed(1)),
      period
    }
  });
}));

// ────────────────────────────────────────────────
// DAILY PROFIT BREAKDOWN (zero-filled)
// ────────────────────────────────────────────────

router.get('/daily-profit-by-status', asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;

  let startDate = new Date();
  let dateFormat = '%Y-%m-%d';

  switch (period) {
    case 'day':   startDate.setHours(0, 0, 0, 0); break;
    case 'week':  startDate.setDate(startDate.getDate() - 7); break;
    case 'month': startDate.setMonth(startDate.getMonth() - 1); break;
    case 'year':
      startDate.setFullYear(startDate.getFullYear() - 1);
      dateFormat = '%Y-%m';
      break;
    default:      startDate = new Date(0);
  }

  const aggregated = await Order.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
        positiveProfit: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        negativeProfit: {
          $sum: { $cond: [{ $in: ['$orderStatus', ['cancelled', 'returned']] }, { $multiply: [{ $ifNull: ['$orderTotal.total', 0] }, -1] }, 0] }
        },
        potentialProfit: {
          $sum: { $cond: [{ $in: ['$orderStatus', ['pending', 'processing', 'shipped']] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        }
      }
    }
  ]);

  const dataMap = new Map(aggregated.map(item => [item._id, item]));

  const result = [];
  let current = new Date(startDate);
  const today = new Date();

  while (current <= today) {
    const key = (period === 'year')
      ? current.toISOString().slice(0, 7)
      : current.toISOString().slice(0, 10);

    const entry = dataMap.get(key) || {
      _id: key,
      positiveProfit: 0,
      negativeProfit: 0,
      potentialProfit: 0
    };

    result.push(entry);
    current.setDate(current.getDate() + 1);
  }

  res.json({ success: true, data: result });
}));

// ────────────────────────────────────────────────
// STANDARD CRUD ROUTES (unchanged)
// ────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const { userId } = req.query;
  const filter = userId ? { userID: userId } : {};

  let orders = await Order.find(filter)
    .populate('userID', 'name email')
    .populate('couponCode', 'couponCode discountType discountAmount')
    .sort({ createdAt: -1 })
    .lean();

  for (const order of orders) {
    for (const item of order.items) {
      if (item.productID && mongoose.isValidObjectId(item.productID)) {
        const product = await Product.findById(item.productID).select('images').lean();
        item.image = product?.images?.[0]?.url || null;
      } else {
        item.image = null;
      }
    }
  }

  res.json({ success: true, message: 'Orders fetched', data: orders });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('userID', 'name email')
    .populate('couponCode', 'couponCode')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Not found' });

  for (const item of order.items) {
    if (item.productID && mongoose.isValidObjectId(item.productID)) {
      const product = await Product.findById(item.productID).select('images').lean();
      item.image = product?.images?.[0]?.url || null;
    }
  }

  res.json({ success: true, data: order });
}));

router.post('/', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userID, items, totalPrice, orderTotal, shippingAddress, paymentMethod, couponCode } = req.body;

    if (!userID || !items?.length || !totalPrice || !orderTotal || !shippingAddress || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const bulkOps = [];
    for (const item of items) {
      const variant = await ProductVariant.findById(item.productVariantID).session(session);
      if (!variant || variant.quantity < item.quantity) {
        throw new Error(`Stock insufficient for ${item.productName || 'item'}`);
      }
      bulkOps.push({
        updateOne: {
          filter: { _id: variant._id },
          update: { $inc: { quantity: -item.quantity } }
        }
      });
    }

    const order = new Order({
      userID, items, totalPrice, orderTotal, shippingAddress, paymentMethod, couponCode,
      orderStatus: 'pending'
    });

    await order.save({ session });
    if (bulkOps.length) await ProductVariant.bulkWrite(bulkOps, { session });

    await session.commitTransaction();
    res.status(201).json({ success: true, message: 'Order created', data: order });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { orderStatus, trackingUrl, items } = req.body;
  if (!orderStatus) {
    return res.status(400).json({ success: false, message: 'orderStatus required' });
  }

  const ItemTrack = require('../model/itemTrack');
  const order = await Order.findById(req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const previousStatus = order.orderStatus;
  order.orderStatus = orderStatus;
  if (trackingUrl !== undefined) order.trackingUrl = trackingUrl;

  // Persist per-line IMEIs when admin assigns them during fulfillment
  if (Array.isArray(items) && items.length) {
    for (const incoming of items) {
      const key = String(incoming.sId || incoming.productID || '');
      const line = order.items.find(
        (it) =>
          String(it.sId || '') === key ||
          String(it.productID || '') === String(incoming.productID || '')
      );
      if (line && Array.isArray(incoming.imeis)) {
        line.imeis = incoming.imeis.map((e) => String(e).trim()).filter(Boolean);
      }
    }
    order.markModified('items');
  }

  // On deliver: validate IMEI count for lines that have IMEIs and mark ItemTrack sold
  if (orderStatus === 'delivered' && previousStatus !== 'delivered') {
    const allImeis = [];
    for (const item of order.items || []) {
      const imeis = Array.isArray(item.imeis) ? item.imeis : [];
      const qty = Number(item.quantity) || 0;
      if (imeis.length > 0 && imeis.length < qty) {
        return res.status(400).json({
          success: false,
          message: `Assign ${qty} IMEI(s) for "${item.productName}" before marking delivered.`
        });
      }
      allImeis.push(...imeis.map((i) => String(i).trim()).filter(Boolean));
    }

    if (allImeis.length) {
      const unique = [...new Set(allImeis)];
      const available = await ItemTrack.find({
        imei: { $in: unique },
        status: 'available'
      });
      if (available.length !== unique.length) {
        const found = available.map((t) => t.imei);
        const missing = unique.filter((i) => !found.includes(i));
        return res.status(400).json({
          success: false,
          message: `These IMEIs are not available: ${missing.join(', ')}`
        });
      }

      await ItemTrack.updateMany(
        { imei: { $in: unique } },
        {
          $set: {
            status: 'sold',
            'saleInfo.orderId': order._id,
            'saleInfo.soldDate': new Date()
          },
          $push: {
            history: {
              status: 'sold',
              date: new Date(),
              notes: `Delivered via online order ${order._id}`
            }
          }
        }
      );
    }
  }

  await order.save();
  res.json({ success: true, message: 'Updated', data: order });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndDelete(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, message: 'Deleted' });
}));

module.exports = router;