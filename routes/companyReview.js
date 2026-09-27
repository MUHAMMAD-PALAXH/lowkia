const express = require('express');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Review = require('../model/review');
const Product = require('../model/product');
const User = require('../model/user');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter } = require('../utils/tenantScope');
const { resolveStaffBranchScope } = require('../utils/staffBranchScope');

const router = express.Router();

router.use(protect, resolveTenant, requireCompany);

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const personName = (u) => {
  if (!u || typeof u !== 'object') return '';
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.email || '';
};

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  rating_high: { rating: -1, createdAt: -1 },
  rating_low: { rating: 1, createdAt: -1 },
};

/**
 * Reviews are written by marketplace customers without a companyId, so the
 * company scope comes from the reviewed product (and, for branch staff, the
 * product's branches — same rule as online orders).
 */
router.get('/', asyncHandler(async (req, res) => {
  const scope = await resolveStaffBranchScope(req);
  const productFilter = { ...companyFilter(req.companyId), isDeleted: { $ne: true } };
  if (scope) {
    productFilter.branchIds = {
      $in: scope.branchIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  const products = await Product.find(productFilter)
    .select('_id name productCode images')
    .lean();

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const emptySummary = { total: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

  if (!products.length) {
    return res.json({
      success: true,
      data: { items: [], total: 0, page, limit, pages: 1, summary: emptySummary },
    });
  }

  const productById = new Map(products.map((p) => [String(p._id), p]));
  const scopedIds = products.map((p) => p._id);
  const base = { productId: { $in: scopedIds } };

  const filter = { ...base };
  const productId = String(req.query.productId || '').trim();
  if (productId) {
    if (!productById.has(productId)) {
      return res.json({
        success: true,
        data: { items: [], total: 0, page, limit, pages: 1, summary: emptySummary },
      });
    }
    filter.productId = new mongoose.Types.ObjectId(productId);
  }
  const rating = parseInt(req.query.rating, 10);
  if (rating >= 1 && rating <= 5) filter.rating = rating;
  const source = String(req.query.source || '').trim();
  if (source === 'app' || source === 'website') filter.source = source;
  if (req.query.replied === 'true') filter['replies.0'] = { $exists: true };
  if (req.query.replied === 'false') filter['replies.0'] = { $exists: false };

  const search = String(req.query.search || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const productMatches = products
      .filter((p) => rx.test(p.name || '') || rx.test(p.productCode || ''))
      .map((p) => p._id);
    const userMatches = await User.find({
      $or: [{ firstName: rx }, { lastName: rx }, { email: rx }],
    })
      .select('_id')
      .limit(500)
      .lean();
    filter.$or = [
      { comment: rx },
      { productId: { $in: productMatches } },
      { userId: { $in: userMatches.map((u) => u._id) } },
    ];
  }

  const sort = SORTS[req.query.sort] || SORTS.newest;

  const [total, rows, stats] = await Promise.all([
    Review.countDocuments(filter),
    Review.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'firstName lastName email')
      .populate('replies.userId', 'firstName lastName email')
      .lean(),
    Review.aggregate([
      { $match: base },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  const summary = { total: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  let ratingSum = 0;
  for (const s of stats) {
    const r = Math.round(Number(s._id) || 0);
    if (r < 1 || r > 5) continue;
    summary.distribution[r] += s.count;
    summary.total += s.count;
    ratingSum += r * s.count;
  }
  summary.average = summary.total ? Math.round((ratingSum / summary.total) * 10) / 10 : 0;

  const items = rows.map((r) => {
    const p = productById.get(String(r.productId)) || {};
    const u = r.userId && typeof r.userId === 'object' ? r.userId : null;
    return {
      _id: r._id,
      rating: r.rating,
      comment: r.comment,
      source: r.source || null,
      likes: Array.isArray(r.likes) ? r.likes.length : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      product: {
        _id: r.productId,
        name: p.name || '',
        productCode: p.productCode || '',
        image: p.images?.[0]?.url || null,
      },
      customer: {
        _id: u?._id || r.userId || null,
        name: personName(u),
        email: u?.email || '',
      },
      replies: (r.replies || []).map((rep) => {
        const ru = rep.userId && typeof rep.userId === 'object' ? rep.userId : null;
        return {
          _id: rep._id,
          comment: rep.comment,
          likes: Array.isArray(rep.likes) ? rep.likes.length : 0,
          createdAt: rep.createdAt,
          userName: personName(ru),
        };
      }),
    };
  });

  res.json({
    success: true,
    data: {
      items,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      summary,
    },
  });
}));

module.exports = router;
