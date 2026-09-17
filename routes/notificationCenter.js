const express = require("express");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const NotificationCenterEvent = require("../model/notificationCenterEvent");
const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const { getManagedBranchIds } = require("../middleware/hrAccess");
const {
    isCompanyEmployee,
    isVendor,
    normalizeRole,
} = require("../utils/roleAccess");

const router = express.Router();
router.use(
    protect,
    resolveTenant,
    requireCompany,
    asyncHandler(async (req, _res, next) => {
        req.notificationBranchIds = await getManagedBranchIds(req.user);
        next();
    })
);

const escapeRegex = (value) =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseClock = (value) => {
    const match = String(value || "")
        .trim()
        .match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }
    return { hour, minute, minutes: hour * 60 + minute };
};

const startOfDay = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfDay = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(23, 59, 59, 999);
    return date;
};

/**
 * Company-scoped feed: every company user sees company broadcasts for their
 * tenant. Vendors still match audienceRoles. Branch staff stay branch-scoped.
 */
const visibilityQuery = (req) => {
    const role = normalizeRole(req.user.role);
    const conditions = [
        {
            $or: [
                { recipientId: null },
                { recipientId: req.user._id },
            ],
        },
        { "archivedBy.userId": { $ne: req.user._id } },
        {
            $or: [
                { expiresAt: null },
                { expiresAt: { $gt: new Date() } },
            ],
        },
    ];

    if (isVendor(role)) {
        conditions.push({
            $or: [
                { recipientId: req.user._id },
                { audienceRoles: role },
                { audienceRoles: { $size: 0 } },
            ],
        });
    }

    if (
        isCompanyEmployee(role) &&
        Array.isArray(req.notificationBranchIds) &&
        req.notificationBranchIds.length > 0
    ) {
        conditions.push({
            $or: [
                { branchId: null },
                { branchId: { $in: req.notificationBranchIds } },
            ],
        });
    }
    return {
        companyId: req.companyId,
        $and: conditions,
    };
};

const applyListFilters = (query, req) => {
    if (req.query.category && req.query.category !== "all") {
        query.category = String(req.query.category).toLowerCase();
    }
    if (req.query.priority && req.query.priority !== "all") {
        query.priority = String(req.query.priority).toLowerCase();
    }
    if (req.query.unread === "true") {
        query["readBy.userId"] = { $ne: req.user._id };
    }
    if (req.query.read === "true") {
        query["readBy.userId"] = req.user._id;
    }

    const actorId = String(req.query.actorId || req.query.userId || "").trim();
    if (actorId && mongoose.Types.ObjectId.isValid(actorId)) {
        query["actor.userId"] = new mongoose.Types.ObjectId(actorId);
    }

    const dateFrom = req.query.dateFrom
        ? startOfDay(req.query.dateFrom)
        : null;
    const dateTo = req.query.dateTo ? endOfDay(req.query.dateTo) : null;
    const timeFrom = parseClock(req.query.timeFrom);
    const timeTo = parseClock(req.query.timeTo);

    if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) {
            const from = new Date(dateFrom);
            if (timeFrom && !dateTo && !timeTo) {
                from.setHours(timeFrom.hour, timeFrom.minute, 0, 0);
            } else if (timeFrom && dateFrom) {
                from.setHours(timeFrom.hour, timeFrom.minute, 0, 0);
            }
            query.createdAt.$gte = from;
        }
        if (dateTo) {
            const to = new Date(dateTo);
            if (timeTo) {
                to.setHours(timeTo.hour, timeTo.minute, 59, 999);
            }
            query.createdAt.$lte = to;
        } else if (dateFrom && timeTo && !dateTo) {
            const to = new Date(dateFrom);
            to.setHours(timeTo.hour, timeTo.minute, 59, 999);
            query.createdAt.$lte = to;
        }
    } else if (timeFrom || timeTo) {
        const fromMins = timeFrom ? timeFrom.minutes : 0;
        const toMins = timeTo ? timeTo.minutes : 23 * 60 + 59;
        query.$and.push({
            $expr: {
                $and: [
                    {
                        $gte: [
                            {
                                $add: [
                                    { $multiply: [{ $hour: "$createdAt" }, 60] },
                                    { $minute: "$createdAt" },
                                ],
                            },
                            fromMins,
                        ],
                    },
                    {
                        $lte: [
                            {
                                $add: [
                                    { $multiply: [{ $hour: "$createdAt" }, 60] },
                                    { $minute: "$createdAt" },
                                ],
                            },
                            toMins,
                        ],
                    },
                ],
            },
        });
    }

    if (req.query.search) {
        const pattern = new RegExp(escapeRegex(req.query.search), "i");
        query.$and.push({
            $or: [
                { title: pattern },
                { message: pattern },
                { entityLabel: pattern },
                { "actor.name": pattern },
            ],
        });
    }
};

const decorate = (item, userId) => {
    const raw = item.toObject ? item.toObject() : item;
    return {
        ...raw,
        id: String(raw._id),
        isRead: (raw.readBy || []).some(
            (state) => String(state.userId) === String(userId)
        ),
        _id: undefined,
        readBy: undefined,
        archivedBy: undefined,
    };
};

router.get(
    "/",
    asyncHandler(async (req, res) => {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(
            Math.max(Number.parseInt(req.query.limit, 10) || 30, 1),
            100
        );
        const query = visibilityQuery(req);
        applyListFilters(query, req);

        const [items, total] = await Promise.all([
            NotificationCenterEvent.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            NotificationCenterEvent.countDocuments(query),
        ]);

        res.json({
            success: true,
            message: "Notifications retrieved successfully.",
            data: {
                items: items.map((item) => decorate(item, req.user._id)),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(Math.ceil(total / limit), 1),
                },
            },
        });
    })
);

router.get(
    "/actors",
    asyncHandler(async (req, res) => {
        const actors = await NotificationCenterEvent.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(
                        String(req.companyId)
                    ),
                    "actor.userId": { $ne: null },
                },
            },
            {
                $group: {
                    _id: "$actor.userId",
                    name: { $first: "$actor.name" },
                    role: { $first: "$actor.role" },
                    count: { $sum: 1 },
                },
            },
            { $sort: { name: 1 } },
        ]);
        res.json({
            success: true,
            message: "Notification actors retrieved successfully.",
            data: actors.map((item) => ({
                id: String(item._id),
                name: item.name || "User",
                role: item.role || "",
                count: item.count || 0,
            })),
        });
    })
);

router.get(
    "/summary",
    asyncHandler(async (req, res) => {
        const base = visibilityQuery(req);
        const unread = {
            ...base,
            "readBy.userId": { $ne: req.user._id },
        };
        const [total, unreadCount, critical, byCategory, recent] =
            await Promise.all([
                NotificationCenterEvent.countDocuments(base),
                NotificationCenterEvent.countDocuments(unread),
                NotificationCenterEvent.countDocuments({
                    ...unread,
                    priority: { $in: ["high", "critical"] },
                }),
                NotificationCenterEvent.aggregate([
                    { $match: unread },
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                ]),
                NotificationCenterEvent.find(base)
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .lean(),
            ]);
        res.json({
            success: true,
            message: "Notification summary retrieved successfully.",
            data: {
                total,
                unread: unreadCount,
                important: critical,
                byCategory: Object.fromEntries(
                    byCategory.map((item) => [item._id, item.count])
                ),
                recent: recent.map((item) => decorate(item, req.user._id)),
            },
        });
    })
);

router.patch(
    "/read-all",
    asyncHandler(async (req, res) => {
        const query = {
            ...visibilityQuery(req),
            "readBy.userId": { $ne: req.user._id },
        };
        if (req.body.category && req.body.category !== "all") {
            query.category = String(req.body.category).toLowerCase();
        }
        const result = await NotificationCenterEvent.updateMany(query, {
            $push: { readBy: { userId: req.user._id, at: new Date() } },
        });
        res.json({
            success: true,
            message: "Notifications marked as read.",
            data: { updated: result.modifiedCount },
        });
    })
);

router.patch(
    "/:id/read",
    asyncHandler(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid notification id.",
                data: null,
            });
        }
        const event = await NotificationCenterEvent.findOne({
            _id: req.params.id,
            ...visibilityQuery(req),
        });
        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Notification not found.",
                data: null,
            });
        }
        const alreadyRead = event.readBy.some(
            (state) => String(state.userId) === String(req.user._id)
        );
        if (!alreadyRead) {
            event.readBy.push({ userId: req.user._id, at: new Date() });
            await event.save();
        }
        res.json({
            success: true,
            message: "Notification marked as read.",
            data: decorate(event, req.user._id),
        });
    })
);

router.patch(
    "/:id/archive",
    asyncHandler(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid notification id.",
                data: null,
            });
        }
        const event = await NotificationCenterEvent.findOne({
            _id: req.params.id,
            ...visibilityQuery(req),
        });
        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Notification not found.",
                data: null,
            });
        }
        event.archivedBy.push({ userId: req.user._id, at: new Date() });
        await event.save();
        res.json({
            success: true,
            message: "Notification archived.",
            data: null,
        });
    })
);

router.post(
    "/archive-bulk",
    asyncHandler(async (req, res) => {
        const ids = req.body.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No notification ids provided.",
                data: null,
            });
        }
        const validIds = ids
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        if (validIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid notification ids provided.",
                data: null,
            });
        }
        const query = {
            _id: { $in: validIds },
            ...visibilityQuery(req),
        };
        const result = await NotificationCenterEvent.updateMany(query, {
            $addToSet: {
                archivedBy: { userId: req.user._id, at: new Date() },
            },
        });
        res.json({
            success: true,
            message: `${result.modifiedCount} notification(s) archived.`,
            data: { archived: result.modifiedCount },
        });
    })
);

module.exports = router;
