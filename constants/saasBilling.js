/**
 * SaaS subscription billing constants (platform-wide).
 * Separate from ERP finance Payment model.
 */

const SAAS_PAYMENT_METHODS = [
    "bank_transfer",
    "bkash",
    "nagad",
    "rocket",
    "cash",
    "cheque",
    // reserved / extensible
    "card",
    "stripe",
    "apple_pay",
    "paypal",
    "manual",
    "other",
    "gateway",
];

const SAAS_V1_PAYMENT_METHODS = [
    "bank_transfer",
    "bkash",
    "nagad",
    "rocket",
    "cash",
    "cheque",
];

const SUBSCRIPTION_INVOICE_STATUSES = [
    "draft",
    "unpaid",
    "pending",
    "paid",
    "overdue",
    "void",
];

const SUBSCRIPTION_PAYMENT_STATUSES = [
    "submitted",
    "pending_verification",
    "verified",
    "rejected",
    "refunded",
    "cancelled",
];

const SUBSCRIPTION_PAYMENT_INTENTS = [
    "new",
    "renew",
    "upgrade",
    "downgrade_schedule",
];

const PAYMENT_REJECTION_REASONS = [
    "Invalid transaction ID",
    "Amount mismatch",
    "Payment not found",
    "Wrong payment account",
    "Duplicate payment",
    "Payment proof unclear",
    "Other",
];

const METHODS_REQUIRING_TXN_ID = new Set([
    "bank_transfer",
    "bkash",
    "nagad",
    "rocket",
    "cheque",
    "card",
]);

module.exports = {
    SAAS_PAYMENT_METHODS,
    SAAS_V1_PAYMENT_METHODS,
    SUBSCRIPTION_INVOICE_STATUSES,
    SUBSCRIPTION_PAYMENT_STATUSES,
    SUBSCRIPTION_PAYMENT_INTENTS,
    PAYMENT_REJECTION_REASONS,
    METHODS_REQUIRING_TXN_ID,
};
