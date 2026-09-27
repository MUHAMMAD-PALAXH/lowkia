// routes/order.js
// FINAL SAFE VERSION – uses separate Settings collection for targets

const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();

const Order = require('../model/order');
const Product = require('../model/product');
const ProductVariant = require('../model/productVariant');
const Settings = require('../model/settings');
const ItemTrack = require('../model/itemTrack');
const ProductUnitBarcode = require('../model/productUnitBarcode');
const Branch = require('../model/branch');
const Employee = require('../model/employee');

const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');
const { isCompanyEmployee } = require('../utils/roleAccess');
const unitBarcodeService = require('../services/productUnitBarcodeService');
const CompanyOrder = require('../model/marketplace/companyOrder');
const {
  CANCELLABLE_COMPANY_STATUSES,
  transitionCompanyOrderStatus,
  syncMasterOrderStatus,
} = require('../services/marketplace/marketplaceOrderStatusService');
const {
  emitStatusNotificationsFromTransition,
} = require('../services/marketplace/marketplaceNotificationService');
const { exportOnlineOrdersExcel } = require('../services/onlineOrderService');
const {
  backfillOnlineOrdersForCompany,
  backfillOnlineCustomersForCompany,
} = require('../services/marketplace/marketplaceOnlineOrderBridgeService');

router.use(protect, resolveTenant, requireCompany);

// ────────────────────────────────────────────────
// Branch scope + fulfillment code helpers
// ────────────────────────────────────────────────

/**
 * Employee / branch_manager → { defaultBranchId, branchIds } where branchIds is
 * the assigned branch plus branches they manage (Branch.managerIds / managerId).
 * Owners, or staff with no branch at all → null (no branch restriction).
 */
async function resolveStaffBranchScope(req) {
  if (!isCompanyEmployee(req.user?.role) || !req.user?._id) return null;
  const employee = await Employee.findOne({
    userId: req.user._id,
    isDeleted: { $ne: true }
  })
    .select('_id branchId')
    .lean();

  const managerMatch = [{ managerId: req.user._id }];
  if (employee?._id) managerMatch.push({ managerIds: employee._id });
  const managed = await Branch.find({
    ...companyFilter(req.companyId),
    isDeleted: { $ne: true },
    $or: managerMatch
  })
    .select('_id')
    .lean();

  const defaultBranchId = employee?.branchId ? String(employee.branchId) : null;
  const branchIds = [
    ...new Set([defaultBranchId, ...managed.map((b) => String(b._id))].filter(Boolean))
  ];
  if (!branchIds.length) return null;
  return { defaultBranchId: defaultBranchId || branchIds[0], branchIds };
}

const scopeAllows = (scope, branchId) =>
  !scope || scope.branchIds.includes(String(branchId));

/**
 * Admin online-order status → marketplace CompanyOrder status (what USER_APP
 * shows via MasterOrder). Keeps finer company states that map to the same
 * online bucket (confirmed ⇄ pending, packed ⇄ processing, partially_shipped ⇄ shipped).
 */
function companyStatusForOnline(onlineStatus, currentCompanyStatus) {
  const current = String(currentCompanyStatus || '');
  switch (String(onlineStatus || '').toLowerCase()) {
    case 'pending':
      return ['pending', 'confirmed'].includes(current) ? current : 'confirmed';
    case 'processing':
      return ['processing', 'packed'].includes(current) ? current : 'processing';
    case 'shipped':
      return ['shipped', 'partially_shipped'].includes(current) ? current : 'shipped';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
      return 'cancelled';
    default:
      return current;
  }
}

const normalizeCode = (value) =>
  String(value || '').trim().toUpperCase().replace(/\s+/g, '');

function computeWarrantyExpiry(product, soldDate) {
  const type = product?.warrantyType || 'No Warranty';
  const period = Number(product?.warrantyPeriod) || 0;
  if (type === 'Lifetime') return new Date('9999-12-31T00:00:00.000Z');
  if (type === 'No Warranty' || period <= 0) return null;
  const expiry = new Date(soldDate);
  if (type === 'Days') expiry.setDate(expiry.getDate() + period);
  else if (type === 'Months') expiry.setMonth(expiry.getMonth() + period);
  else if (type === 'Years') expiry.setFullYear(expiry.getFullYear() + period);
  else return null;
  return expiry;
}

/**
 * Classify every assigned code on the order against its line product:
 * IMEI (ItemTrack) → per-unit barcode (ProductUnitBarcode) → shared
 * product/variant barcode. Returns resolved rows or a list of problems.
 */
async function resolveOrderCodes(order, tenant, branchId) {
  const lines = (order.items || []).map((item) => ({
    item,
    productId: String(item.productID || ''),
    codes: [...new Set((item.imeis || []).map(normalizeCode).filter(Boolean))]
  }));
  const allCodes = lines.flatMap((l) => l.codes);
  const result = { tracks: [], units: [], shared: [], errors: [] };
  if (!allCodes.length) return result;

  const [tracks, units, products, variants] = await Promise.all([
    ItemTrack.find({ imei: { $in: allCodes }, ...tenant })
      .select('imei productId variantId status currentBranchId')
      .lean(),
    ProductUnitBarcode.find({
      barcode: { $in: allCodes },
      status: { $ne: 'void' },
      isDeleted: { $ne: true },
      ...tenant
    })
      .select('barcode productId productVariantId status branchId')
      .lean(),
    Product.find({ barcode: { $in: allCodes }, ...tenant })
      .select('_id barcode')
      .lean(),
    ProductVariant.find({
      barcode: { $in: allCodes },
      isDeleted: { $ne: true },
      ...tenant
    })
      .select('_id productId barcode')
      .lean()
  ]);

  const trackBy = new Map(tracks.map((t) => [normalizeCode(t.imei), t]));
  const unitBy = new Map(units.map((u) => [normalizeCode(u.barcode), u]));
  const productBy = new Map(products.map((p) => [normalizeCode(p.barcode), p]));
  const variantBy = new Map(variants.map((v) => [normalizeCode(v.barcode), v]));

  const seen = new Set();
  for (const line of lines) {
    const label = line.item.productName || 'item';
    for (const code of line.codes) {
      if (seen.has(code)) {
        result.errors.push(`${code} is assigned more than once`);
        continue;
      }
      seen.add(code);

      const track = trackBy.get(code);
      if (track) {
        if (String(track.productId) !== line.productId) {
          result.errors.push(`${code} belongs to a different product than "${label}"`);
        } else if (track.status !== 'available') {
          result.errors.push(`${code} is not available (${track.status})`);
        } else if (
          branchId &&
          track.currentBranchId &&
          String(track.currentBranchId) !== branchId
        ) {
          result.errors.push(`${code} is stocked in another branch`);
        } else {
          result.tracks.push(track);
        }
        continue;
      }

      const unit = unitBy.get(code);
      if (unit) {
        if (String(unit.productId) !== line.productId) {
          result.errors.push(`${code} belongs to a different product than "${label}"`);
        } else if (unit.status !== 'available') {
          result.errors.push(`${code} is already ${unit.status}`);
        } else if (branchId && unit.branchId && String(unit.branchId) !== branchId) {
          result.errors.push(`${code} is stocked in another branch`);
        } else {
          result.units.push(unit);
        }
        continue;
      }

      const product = productBy.get(code);
      const variant = variantBy.get(code);
      const sharedProductId = product
        ? String(product._id)
        : variant
          ? String(variant.productId)
          : '';
      if (sharedProductId) {
        if (sharedProductId !== line.productId) {
          result.errors.push(`${code} belongs to a different product than "${label}"`);
        } else {
          result.shared.push({
            code,
            productId: line.productId,
            productVariantId: variant ? variant._id : null
          });
        }
        continue;
      }

      result.errors.push(`${code} was not found in inventory`);
    }
  }
  return result;
}

// ────────────────────────────────────────────────
// Helper: Get or initialize company settings document
// ────────────────────────────────────────────────
async function getCompanySettings(companyId) {
  const tenant = companyFilter(companyId);
  let settings = await Settings.findOne({ key: 'global', ...tenant });
  if (!settings) {
    settings = await Settings.create(stampCompany({ key: 'global' }, companyId));
  }
  return settings;
}

// ────────────────────────────────────────────────
// SALES TARGET ENDPOINTS
// ────────────────────────────────────────────────

/**
 * GET /orders/admin/sales-targets
 */
router.get('/admin/sales-targets', asyncHandler(async (req, res) => {
  const settings = await getCompanySettings(req.companyId);
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
  const settings = await getCompanySettings(req.companyId);

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
  const tenant = companyFilter(req.companyId);

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

  const currentMatch = { ...tenant, orderDate: { $gte: currentStart } };

  const topProducts = await Order.aggregate([
    {
      $match: {
        ...currentMatch,
        orderStatus: 'delivered'
      }
    },
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

  const stats = await Order.aggregate([
    { $match: currentMatch },
    {
      $group: {
        _id: null,
        deliveredRevenue: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        lossRevenue: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        deliveredCount: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
        },
        orderCount: { $sum: 1 }
      }
    }
  ]);

  const summary = stats[0] || {
    deliveredRevenue: 0,
    lossRevenue: 0,
    deliveredCount: 0,
    orderCount: 0
  };

  const currentRevenue = summary.deliveredRevenue;

  let prevStart = new Date(currentStart);

  switch (period) {
    case 'day':   prevStart.setDate(prevStart.getDate() - 1); break;
    case 'week':  prevStart.setDate(prevStart.getDate() - 7); break;
    case 'month': prevStart.setMonth(prevStart.getMonth() - 1); break;
    case 'year':  prevStart.setFullYear(prevStart.getFullYear() - 1); break;
    default:      prevStart = new Date(0);
  }

  const prevMatch = { ...tenant, orderDate: { $gte: prevStart, $lt: currentStart } };

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

  const settings = await getCompanySettings(req.companyId);
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
  const tenant = companyFilter(req.companyId);

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
    { $match: { ...tenant, orderDate: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$orderDate' } },
        positiveProfit: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$orderTotal.total', 0] }, 0] }
        },
        negativeProfit: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, { $multiply: [{ $ifNull: ['$orderTotal.total', 0] }, -1] }, 0] }
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
// STANDARD CRUD ROUTES
// ────────────────────────────────────────────────

/**
 * GET /orders/branch-access
 * Branches the signed-in user may fulfill online orders from.
 * unrestricted=true → owner (any company branch).
 */
router.get('/branch-access', asyncHandler(async (req, res) => {
  const scope = await resolveStaffBranchScope(req);
  res.json({
    success: true,
    data: scope
      ? { unrestricted: false, defaultBranchId: scope.defaultBranchId, branchIds: scope.branchIds }
      : { unrestricted: true, defaultBranchId: null, branchIds: [] }
  });
}));

router.get('/export/excel', asyncHandler(async (req, res) => {
  const { buffer, filename } = await exportOnlineOrdersExcel(
    req.query,
    req.companyId,
    req.user
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.status(200).send(buffer);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { userId } = req.query;
  const tenant = companyFilter(req.companyId);
  const filter = userId ? { userID: userId, ...tenant } : { ...tenant };

  // Branch staff see their accessible branches' orders plus unassigned ones they can claim.
  const scope = await resolveStaffBranchScope(req);
  if (scope) {
    filter.$or = [{ branchId: { $in: scope.branchIds } }, { branchId: null }];
  }

  // Catch marketplace checkouts completed before the Online Order bridge.
  try {
    await backfillOnlineOrdersForCompany(req.companyId, { limit: 200 });
  } catch (err) {
    console.error('[orders] marketplace online-order backfill failed:', err?.message || err);
  }
  void backfillOnlineCustomersForCompany(req.companyId, { limit: 100 }).catch((err) =>
    console.error('[orders] online-order customer backfill failed:', err?.message || err)
  );

  let orders = await Order.find(filter)
    .populate('userID', 'name email firstName lastName')
    .populate('couponCode', 'couponCode discountType discountAmount')
    .sort({ createdAt: -1 })
    .lean();

  for (const order of orders) {
    for (const item of order.items) {
      if (item.productID && mongoose.isValidObjectId(item.productID)) {
        const product = await Product.findOne({ _id: item.productID, ...tenant }).select('images').lean();
        item.image = product?.images?.[0]?.url || null;
      } else {
        item.image = null;
      }
    }
  }

  res.json({ success: true, message: 'Orders fetched', data: orders });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const tenant = companyFilter(req.companyId);
  const order = await Order.findOne({ _id: req.params.id, ...tenant })
    .populate('userID', 'name email')
    .populate('couponCode', 'couponCode')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Not found' });

  const scope = await resolveStaffBranchScope(req);
  if (order.branchId && !scopeAllows(scope, order.branchId)) {
    return res.status(403).json({
      success: false,
      message: 'This online order belongs to another branch.'
    });
  }

  for (const item of order.items) {
    if (item.productID && mongoose.isValidObjectId(item.productID)) {
      const product = await Product.findOne({ _id: item.productID, ...tenant }).select('images').lean();
      item.image = product?.images?.[0]?.url || null;
    }
  }

  res.json({ success: true, data: order });
}));

router.post('/', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      userID,
      items,
      totalPrice,
      orderTotal,
      shippingAddress,
      paymentMethod,
      couponCode,
      branchId
    } = req.body;

    if (!userID || !items?.length || !totalPrice || !orderTotal || !shippingAddress || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const tenant = companyFilter(req.companyId);
    const bulkOps = [];
    for (const item of items) {
      const variant = await ProductVariant.findOne({ _id: item.productVariantID, ...tenant }).session(session);
      if (!variant || variant.quantity < item.quantity) {
        throw new Error(`Stock insufficient for ${item.productName || 'item'}`);
      }
      bulkOps.push({
        updateOne: {
          filter: { _id: variant._id, ...tenant },
          update: { $inc: { quantity: -item.quantity } }
        }
      });
    }

    const order = new Order(stampCompany({
      userID, items, totalPrice, orderTotal, shippingAddress, paymentMethod, couponCode, branchId,
      orderStatus: 'pending'
    }, req.companyId));

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
  const { orderStatus, trackingUrl, items, branchId } = req.body;
  if (!orderStatus) {
    return res.status(400).json({ success: false, message: 'orderStatus required' });
  }

  const tenant = companyFilter(req.companyId);
  const order = await Order.findOne({ _id: req.params.id, ...tenant });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const scope = await resolveStaffBranchScope(req);
  const currentBranchId = order.branchId ? String(order.branchId) : null;
  if (currentBranchId && !scopeAllows(scope, currentBranchId)) {
    return res.status(403).json({
      success: false,
      message: 'This online order belongs to another branch.'
    });
  }

  const requestedBranchId = String(branchId || '').trim();
  let targetBranchId = currentBranchId;
  if (requestedBranchId) {
    if (!mongoose.isValidObjectId(requestedBranchId)) {
      return res.status(400).json({ success: false, message: 'Invalid branch.' });
    }
    if (!scopeAllows(scope, requestedBranchId)) {
      return res.status(403).json({
        success: false,
        message: 'You can only fulfill online orders for branches you have access to.'
      });
    }
    const branch = await Branch.findOne({
      _id: requestedBranchId,
      isDeleted: { $ne: true },
      ...tenant
    })
      .select('_id')
      .lean();
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found.' });
    }
    targetBranchId = requestedBranchId;
  } else if (scope && !currentBranchId) {
    targetBranchId = scope.defaultBranchId;
  }
  if (targetBranchId !== currentBranchId) {
    order.branchId = targetBranchId;
  }

  const previousStatus = order.orderStatus;
  order.orderStatus = orderStatus;
  if (trackingUrl !== undefined) order.trackingUrl = trackingUrl;

  if (Array.isArray(items) && items.length) {
    for (const incoming of items) {
      const key = String(incoming.sId || incoming.productID || '');
      const line = order.items.find(
        (it) =>
          String(it.sId || '') === key ||
          String(it.productID || '') === String(incoming.productID || '')
      );
      if (line && Array.isArray(incoming.imeis)) {
        line.imeis = [
          ...new Set(incoming.imeis.map(normalizeCode).filter(Boolean))
        ];
      }
    }
    order.markModified('items');
  }

  const delivering = orderStatus === 'delivered' && previousStatus !== 'delivered';
  if (delivering) {
    for (const item of order.items || []) {
      const assigned = Array.isArray(item.imeis) ? item.imeis.length : 0;
      const qty = Number(item.quantity) || 0;
      if (assigned > 0 && assigned < qty) {
        return res.status(400).json({
          success: false,
          message: `Assign ${qty} barcode/IMEI code(s) for "${item.productName}" before marking delivered.`
        });
      }
    }
  }

  // Codes are checked while the order is still open; delivered orders already consumed them.
  const shouldCheckCodes =
    previousStatus !== 'delivered' && orderStatus !== 'cancelled';
  const resolved = shouldCheckCodes
    ? await resolveOrderCodes(order, tenant, targetBranchId)
    : null;
  if (resolved && resolved.errors.length) {
    const preview = resolved.errors.slice(0, 5).join('; ');
    const more = resolved.errors.length > 5 ? ` (+${resolved.errors.length - 5} more)` : '';
    return res.status(400).json({ success: false, message: `${preview}${more}` });
  }

  // Marketplace orders (USER_APP) mirror this status on their CompanyOrder.
  const companyOrder = order.companyOrderId
    ? await CompanyOrder.findOne({
        _id: order.companyOrderId,
        isDeleted: { $ne: true },
        ...tenant
      })
    : null;
  const companyTarget = companyOrder
    ? companyStatusForOnline(orderStatus, companyOrder.status)
    : null;
  if (
    companyOrder &&
    companyTarget === 'cancelled' &&
    companyOrder.status !== 'cancelled' &&
    !CANCELLABLE_COMPANY_STATUSES.has(companyOrder.status)
  ) {
    return res.status(400).json({
      success: false,
      message: `This marketplace order is already ${companyOrder.status} and can no longer be cancelled.`
    });
  }

  if (delivering && resolved) {
    const soldDate = new Date();

    if (resolved.tracks.length) {
      const productIds = [...new Set(resolved.tracks.map((t) => String(t.productId)))];
      const products = await Product.find({ _id: { $in: productIds }, ...tenant })
        .select('warrantyType warrantyPeriod')
        .lean();
      const productById = new Map(products.map((p) => [String(p._id), p]));

      for (const pid of productIds) {
        const ids = resolved.tracks
          .filter((t) => String(t.productId) === pid)
          .map((t) => t._id);
        const warrantyExpiry = computeWarrantyExpiry(productById.get(pid), soldDate);
        const set = {
          status: 'sold',
          currentBranchId: null,
          'saleInfo.orderId': order._id,
          'saleInfo.customerPhone': order.shippingAddress?.phone || '',
          'saleInfo.soldDate': soldDate
        };
        if (warrantyExpiry) set.warrantyExpiry = warrantyExpiry;
        const update = await ItemTrack.updateMany(
          { _id: { $in: ids }, status: 'available', ...tenant },
          {
            $set: set,
            $push: {
              history: {
                status: 'sold',
                branchId: targetBranchId || undefined,
                updatedBy: req.user?._id,
                date: soldDate,
                notes: `Delivered via online order ${order._id}`
              }
            }
          }
        );
        if (update.modifiedCount !== ids.length) {
          return res.status(409).json({
            success: false,
            message: 'Some IMEIs changed status while delivering. Refresh the order and try again.'
          });
        }
      }
    }

    if (resolved.units.length) {
      const ids = resolved.units.map((u) => u._id);
      const update = await ProductUnitBarcode.updateMany(
        { _id: { $in: ids }, status: 'available', ...tenant },
        {
          $set: {
            status: 'sold',
            'soldInfo.onlineOrderId': order._id,
            'soldInfo.soldAt': soldDate
          }
        }
      );
      if (update.modifiedCount !== ids.length) {
        return res.status(409).json({
          success: false,
          message: 'Some unit barcodes were sold elsewhere. Refresh the order and try again.'
        });
      }
    }

    for (const row of resolved.shared) {
      await unitBarcodeService.markSoldFifo({
        companyId: req.companyId,
        productId: row.productId,
        productVariantId: row.productVariantId,
        quantity: 1
      });
    }
  }

  await order.save();

  if (companyOrder) {
    try {
      if (companyTarget && companyTarget !== companyOrder.status) {
        const result = await transitionCompanyOrderStatus(companyOrder, companyTarget, {
          allowSystem: true,
          actorId: req.user?._id,
          reason: companyTarget === 'cancelled' ? 'Cancelled by seller' : ''
        });
        void emitStatusNotificationsFromTransition(result);
      } else {
        // Same company status — still repair a drifted MasterOrder aggregate.
        await syncMasterOrderStatus(companyOrder.masterOrderId);
      }
    } catch (err) {
      console.error('[orders] marketplace status sync failed:', err?.message || err);
      return res.status(500).json({
        success: false,
        message: `Order saved, but the customer app status could not be updated: ${err?.message || 'sync failed'}. Save again to retry.`
      });
    }
  }

  res.json({ success: true, message: 'Updated', data: order });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const order = await Order.findOneAndDelete({
    _id: req.params.id,
    ...companyFilter(req.companyId)
  });
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, message: 'Deleted' });
}));

module.exports = router;
