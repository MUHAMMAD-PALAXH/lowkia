/**
 * Phase 11 marketplace notification helpers smoke (no DB).
 * Run: node scripts/smokeMarketplaceNotification.js
 */
const assert = require("assert");
const {
    formatNotification,
} = require("../services/marketplace/marketplaceNotificationService");

const sample = formatNotification({
    _id: "507f1f77bcf86cd799439011",
    channel: "in_app",
    category: "order",
    eventType: "order_placed",
    title: "Order placed",
    body: "Your order MORD-000001 was placed.",
    masterOrderId: "507f1f77bcf86cd799439012",
    companyOrderId: null,
    companyId: null,
    companyName: "",
    shipmentId: null,
    isRead: false,
    readAt: null,
    metadata: null,
    createdAt: new Date(),
});

assert.strictEqual(sample.eventType, "order_placed");
assert.strictEqual(sample.isRead, false);
assert.ok(sample.id);

console.log("smokeMarketplaceNotification: ok");
