const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const notificationService = require("../services/marketplace/marketplaceNotificationService");

exports.listNotifications = asyncHandler(async (req, res) => {
    const result = await notificationService.listNotifications(
        req.user._id,
        req.query
    );
    return res.status(200).json({
        success: true,
        message: "Notifications retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getUnreadCount = asyncHandler(async (req, res) => {
    const data = await notificationService.getUnreadCount(req.user._id);
    return success(res, "Unread count retrieved.", data);
});

exports.markRead = asyncHandler(async (req, res) => {
    const data = await notificationService.markNotificationRead(
        req.user._id,
        req.params.notificationId
    );
    return success(res, "Notification marked as read.", data);
});

exports.markAllRead = asyncHandler(async (req, res) => {
    const data = await notificationService.markAllNotificationsRead(req.user._id);
    return success(res, "All notifications marked as read.", data);
});
