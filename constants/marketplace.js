/**
 * Marketplace commerce constants (platform-level, separate from ERP Order / SalesOrder).
 */

const CART_STATUSES = ["active", "checked_out", "abandoned"];

const MASTER_ORDER_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "partially_shipped",
    "shipped",
    "partially_delivered",
    "delivered",
    "cancelled",
    "partially_cancelled",
    "refunded",
    "partially_refunded",
];

const COMPANY_ORDER_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "packed",
    "partially_shipped",
    "shipped",
    "partially_delivered",
    "delivered",
    "cancelled",
    "refunded",
];

const CHECKOUT_PAYMENT_STATUSES = [
    "pending",
    "processing",
    "successful",
    "failed",
    "cancelled",
    "refunded",
    "partially_refunded",
];

const CHECKOUT_PAYMENT_METHODS = [
    "cod",
    "card",
    "mobile_wallet",
    "bank_transfer",
    "gateway",
    "other",
];

const CHECKOUT_PAYMENT_PROVIDERS = [
    "manual",
    "stripe",
    "sslcommerz",
    "bkash",
    "nagad",
    "other",
];

const SHIPMENT_STATUSES = [
    "pending",
    "confirmed",
    "packed",
    "ready_to_ship",
    "shipped",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "failed_delivery",
    "returned",
    "cancelled",
];

const REFUND_STATUSES = ["pending", "processing", "completed", "failed", "cancelled"];

const REFUND_SCOPES = ["master_order", "company_order", "order_item"];

const SHIPPING_RULE_TYPES = ["flat", "free_threshold", "zone"];

const COURIER_TYPES = [
    "pathao",
    "steadfast",
    "redx",
    "paperfly",
    "local",
    "company_own",
    "other",
];

const USER_NOTIFICATION_CHANNELS = ["in_app", "push", "email", "sms"];

const MARKETPLACE_CURRENCIES = ["BDT", "USD"];

/** Validation limits reused by validators in later phases. */
const MARKETPLACE_LIMITS = {
    cartMaxItems: 50,
    cartMaxQtyPerLine: 99,
    addressLineMax: 300,
    deliveryInstructionsMax: 500,
    noteMax: 1000,
    trackingNumberMax: 120,
};

const NOT_DELETED = { isDeleted: { $ne: true } };

module.exports = {
    CART_STATUSES,
    MASTER_ORDER_STATUSES,
    COMPANY_ORDER_STATUSES,
    CHECKOUT_PAYMENT_STATUSES,
    CHECKOUT_PAYMENT_METHODS,
    CHECKOUT_PAYMENT_PROVIDERS,
    SHIPMENT_STATUSES,
    REFUND_STATUSES,
    REFUND_SCOPES,
    SHIPPING_RULE_TYPES,
    COURIER_TYPES,
    USER_NOTIFICATION_CHANNELS,
    MARKETPLACE_CURRENCIES,
    MARKETPLACE_LIMITS,
    NOT_DELETED,
};
