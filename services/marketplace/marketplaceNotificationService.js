const mongoose = require("mongoose");
const UserNotification = require("../../model/marketplace/userNotification");
const AppError = require("../../utils/appError");
const { NOT_DELETED } = require("../../constants/marketplace");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const formatNotification = (doc) => ({
    id: doc._id,
    channel: doc.channel,
    category: doc.category,
    eventType: doc.eventType,
    title: doc.title,
    body: doc.body,
    masterOrderId: doc.masterOrderId,
    companyOrderId: doc.companyOrderId,
    companyId: doc.companyId,
    companyName: doc.companyName,
    shipmentId: doc.shipmentId,
    isRead: doc.isRead,
    readAt: doc.readAt,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
});

const sellerLabel = (seller = {}, companyName = "") =>
    String(companyName || seller.tradeName || seller.companyName || "Seller").trim();

const maybeSendPush = async ({ userId, title, body, data = {} }) => {
    const appId = process.env.ONE_SIGNAL_APP_ID;
    const apiKey = process.env.ONE_SIGNAL_REST_API_KEY;
    if (!appId || !apiKey || !userId) return;

    try {
        const OneSignal = require("onesignal-node");
        const client = new OneSignal.Client(appId, apiKey);
        await client.createNotification({
            headings: { en: title },
            contents: { en: body },
            include_external_user_ids: [String(userId)],
            data,
        });
    } catch (error) {
        console.warn(
            "[marketplace-notification] push failed:",
            error?.message || error
        );
    }
};

/**
 * Persist in-app notification and optionally send push (non-blocking).
 */
const emitMarketplaceNotification = async (payload = {}) => {
    const userId = toObjectId(payload.userId);
    if (!userId) return null;

    const doc = {
        userId,
        channel: payload.channel || "in_app",
        category: String(payload.category || "order").trim().toLowerCase(),
        eventType: String(payload.eventType || "update").trim().toLowerCase(),
        title: String(payload.title || "Order update").trim(),
        body: String(payload.body || "").trim(),
        masterOrderId: toObjectId(payload.masterOrderId),
        companyOrderId: toObjectId(payload.companyOrderId),
        companyId: toObjectId(payload.companyId),
        companyName: String(payload.companyName || "").trim(),
        shipmentId: toObjectId(payload.shipmentId),
        metadata: payload.metadata || null,
    };

    if (!doc.body) return null;

    const [notification] = await UserNotification.create([doc]);

    void maybeSendPush({
        userId,
        title: doc.title,
        body: doc.body,
        data: {
            category: doc.category,
            eventType: doc.eventType,
            masterOrderId: doc.masterOrderId ? String(doc.masterOrderId) : "",
            companyOrderId: doc.companyOrderId ? String(doc.companyOrderId) : "",
            companyId: doc.companyId ? String(doc.companyId) : "",
            companyName: doc.companyName,
            shipmentId: doc.shipmentId ? String(doc.shipmentId) : "",
        },
    });

    return notification;
};

const notifyOrderPlaced = async ({ userId, masterOrder, companyOrderCount = 0 }) => {
    if (!masterOrder) return;
    return emitMarketplaceNotification({
        userId,
        category: "order",
        eventType: "order_placed",
        title: "Order placed",
        body: `Your order ${masterOrder.orderNumber} was placed successfully${
            companyOrderCount > 1
                ? ` with ${companyOrderCount} sellers.`
                : "."
        } Complete payment to confirm.`,
        masterOrderId: masterOrder._id || masterOrder.id,
        metadata: {
            orderNumber: masterOrder.orderNumber,
            companyOrderCount,
            paymentStatus: masterOrder.paymentStatus,
        },
    });
};

const notifyPaymentSuccessful = async ({
    userId,
    masterOrder,
    payment,
}) => {
    if (!masterOrder) return;
    return emitMarketplaceNotification({
        userId,
        category: "payment",
        eventType: "payment_successful",
        title: "Payment received",
        body: `Payment for order ${masterOrder.orderNumber} was successful. Your order is now confirmed.`,
        masterOrderId: masterOrder._id || masterOrder.id,
        metadata: {
            orderNumber: masterOrder.orderNumber,
            paymentNumber: payment?.paymentNumber || "",
            amount: payment?.amount,
            currency: payment?.currency || masterOrder.currency,
        },
    });
};

const notifyPaymentFailed = async ({ userId, masterOrder, payment, reason = "" }) => {
    if (!masterOrder) return;
    const suffix = reason ? ` Reason: ${reason}` : "";
    return emitMarketplaceNotification({
        userId,
        category: "payment",
        eventType: "payment_failed",
        title: "Payment failed",
        body: `Payment for order ${masterOrder.orderNumber} could not be completed.${suffix}`,
        masterOrderId: masterOrder._id || masterOrder.id,
        metadata: {
            orderNumber: masterOrder.orderNumber,
            paymentNumber: payment?.paymentNumber || "",
            reason,
        },
    });
};

const COMPANY_STATUS_MESSAGES = {
    confirmed: (seller) => `${seller} confirmed your order.`,
    processing: (seller) => `${seller} is preparing your order.`,
    packed: (seller) => `${seller} packed your order.`,
    partially_shipped: (seller) => `Part of your order from ${seller} has shipped.`,
    shipped: (seller) => `Your order from ${seller} has shipped.`,
    partially_delivered: (seller) => `Part of your order from ${seller} was delivered.`,
    delivered: (seller) => `Your order from ${seller} was delivered.`,
    cancelled: (seller) => `Your order from ${seller} was cancelled.`,
    refunded: (seller) => `Your order from ${seller} was refunded.`,
};

const MASTER_STATUS_MESSAGES = {
    confirmed: (orderNumber) => `Order ${orderNumber} is confirmed.`,
    processing: (orderNumber) => `Order ${orderNumber} is being prepared.`,
    partially_shipped: (orderNumber) => `Part of order ${orderNumber} has shipped.`,
    shipped: (orderNumber) => `Order ${orderNumber} has shipped.`,
    partially_delivered: (orderNumber) =>
        `Part of order ${orderNumber} was delivered.`,
    delivered: (orderNumber) => `Order ${orderNumber} was delivered.`,
    cancelled: (orderNumber) => `Order ${orderNumber} was cancelled.`,
    partially_cancelled: (orderNumber) =>
        `Part of order ${orderNumber} was cancelled.`,
    refunded: (orderNumber) => `Order ${orderNumber} was refunded.`,
    partially_refunded: (orderNumber) =>
        `Part of order ${orderNumber} was refunded.`,
};

const notifyCompanyOrderStatusChange = async ({
    companyOrder,
    previousStatus,
    nextStatus,
}) => {
    if (!companyOrder || previousStatus === nextStatus) return;
    const builder = COMPANY_STATUS_MESSAGES[nextStatus];
    if (!builder) return;

    const label = sellerLabel(companyOrder.seller, companyOrder.companyName);
    return emitMarketplaceNotification({
        userId: companyOrder.userId,
        category: "order",
        eventType: `company_order_${nextStatus}`,
        title: "Order update",
        body: builder(label),
        masterOrderId: companyOrder.masterOrderId,
        companyOrderId: companyOrder._id,
        companyId: companyOrder.companyId,
        companyName: label,
        metadata: {
            orderNumber: companyOrder.orderNumber,
            previousStatus,
            nextStatus,
        },
    });
};

const notifyMasterOrderStatusChange = async ({
    masterOrder,
    previousStatus,
    nextStatus,
}) => {
    if (!masterOrder || previousStatus === nextStatus) return;

    const skipWhenRedundant = new Set([
        "pending",
        "confirmed",
        "processing",
    ]);
    if (skipWhenRedundant.has(nextStatus)) return;

    const builder = MASTER_STATUS_MESSAGES[nextStatus];
    if (!builder) return;

    return emitMarketplaceNotification({
        userId: masterOrder.userId,
        category: "order",
        eventType: `master_order_${nextStatus}`,
        title: "Order update",
        body: builder(masterOrder.orderNumber),
        masterOrderId: masterOrder._id,
        metadata: {
            orderNumber: masterOrder.orderNumber,
            previousStatus,
            nextStatus,
        },
    });
};

const notifyShipmentCreated = async ({ shipment, companyOrder }) => {
    if (!shipment || !companyOrder) return;
    const label = sellerLabel(companyOrder.seller);
    return emitMarketplaceNotification({
        userId: companyOrder.userId,
        category: "shipment",
        eventType: "shipment_created",
        title: "Shipment created",
        body: `${label} created shipment ${shipment.shipmentNumber} for your order.`,
        masterOrderId: shipment.masterOrderId,
        companyOrderId: shipment.companyOrderId,
        companyId: shipment.companyId,
        companyName: label,
        shipmentId: shipment._id,
        metadata: {
            shipmentNumber: shipment.shipmentNumber,
            status: shipment.status,
            trackingNumber: shipment.trackingNumber || "",
        },
    });
};

const notifyShipmentStatusChange = async ({
    shipment,
    companyOrder,
    previousStatus,
    nextStatus,
}) => {
    if (!shipment || !companyOrder || previousStatus === nextStatus) return;

    const notifyStatuses = new Set([
        "shipped",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "failed_delivery",
        "returned",
    ]);
    if (!notifyStatuses.has(nextStatus)) return;

    const label = sellerLabel(companyOrder.seller);
    const titles = {
        shipped: "Order shipped",
        in_transit: "Shipment in transit",
        out_for_delivery: "Out for delivery",
        delivered: "Shipment delivered",
        failed_delivery: "Delivery attempt failed",
        returned: "Shipment returned",
    };

    let body = `${label}: shipment ${shipment.shipmentNumber} is now ${nextStatus.replace(/_/g, " ")}.`;
    if (shipment.trackingNumber) {
        body += ` Tracking: ${shipment.trackingNumber}.`;
    }

    return emitMarketplaceNotification({
        userId: companyOrder.userId,
        category: "shipment",
        eventType: `shipment_${nextStatus}`,
        title: titles[nextStatus] || "Shipment update",
        body,
        masterOrderId: shipment.masterOrderId,
        companyOrderId: shipment.companyOrderId,
        companyId: shipment.companyId,
        companyName: label,
        shipmentId: shipment._id,
        metadata: {
            shipmentNumber: shipment.shipmentNumber,
            previousStatus,
            nextStatus,
            trackingNumber: shipment.trackingNumber || "",
        },
    });
};

const listNotifications = async (userId, query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "customer",
    });

    const filter = { userId: toObjectId(userId), ...NOT_DELETED };
    if (query.isRead === "true") filter.isRead = true;
    if (query.isRead === "false") filter.isRead = false;
    if (query.category) filter.category = String(query.category).trim().toLowerCase();

    const [rows, total] = await Promise.all([
        UserNotification.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        UserNotification.countDocuments(filter),
    ]);

    return {
        data: rows.map(formatNotification),
        pagination: buildPagination(total),
    };
};

const getUnreadCount = async (userId) => {
    const count = await UserNotification.countDocuments({
        userId: toObjectId(userId),
        isRead: false,
        ...NOT_DELETED,
    });
    return { unreadCount: count };
};

const markNotificationRead = async (userId, notificationId) => {
    const id = toObjectId(notificationId);
    if (!id) throw new AppError("Invalid notification id.", 400);

    const notification = await UserNotification.findOneAndUpdate(
        { _id: id, userId: toObjectId(userId), ...NOT_DELETED },
        { $set: { isRead: true, readAt: new Date() } },
        { new: true }
    ).lean();

    if (!notification) throw new AppError("Notification not found.", 404);
    return formatNotification(notification);
};

const markAllNotificationsRead = async (userId) => {
    const result = await UserNotification.updateMany(
        { userId: toObjectId(userId), isRead: false, ...NOT_DELETED },
        { $set: { isRead: true, readAt: new Date() } }
    );
    return { updatedCount: result.modifiedCount || 0 };
};

const SKIP_COMPANY_STATUS_NOTIFY = new Set(["pending", "confirmed"]);

const emitStatusNotificationsFromTransition = async (result = {}) => {
    const {
        companyOrder,
        previousStatus,
        nextStatus,
        masterOrder,
        masterPreviousStatus,
        masterStatus,
        masterStatusChanged,
    } = result;

    if (
        companyOrder &&
        previousStatus !== nextStatus &&
        !SKIP_COMPANY_STATUS_NOTIFY.has(nextStatus)
    ) {
        await notifyCompanyOrderStatusChange({
            companyOrder,
            previousStatus,
            nextStatus,
        });
    }

    if (masterOrder && masterStatusChanged) {
        await notifyMasterOrderStatusChange({
            masterOrder,
            previousStatus: masterPreviousStatus,
            nextStatus: masterStatus,
        });
    }
};

module.exports = {
    emitMarketplaceNotification,
    notifyOrderPlaced,
    notifyPaymentSuccessful,
    notifyPaymentFailed,
    notifyCompanyOrderStatusChange,
    notifyMasterOrderStatusChange,
    notifyShipmentCreated,
    notifyShipmentStatusChange,
    listNotifications,
    getUnreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    formatNotification,
    emitStatusNotificationsFromTransition,
};
