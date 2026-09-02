const crypto = require("crypto");
const AppError = require("../../utils/appError");
const {
    getPaymentProvider,
    PaymentProviderError,
} = require("../paymentProviders");

const DEV_ENVS = new Set(["development", "test", ""]);

const timingSafeEqualString = (a, b) => {
    const left = Buffer.from(String(a || ""), "utf8");
    const right = Buffer.from(String(b || ""), "utf8");
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
};

const getSharedWebhookSecret = () =>
    String(
        process.env.MARKETPLACE_WEBHOOK_SECRET ||
            process.env.MARKETPLACE_WEBHOOK_SHARED_SECRET ||
            ""
    ).trim();

const isProduction = () =>
    String(process.env.NODE_ENV || "").toLowerCase() === "production";

const signPayload = (rawBody, secret) =>
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

const verifySharedSignature = ({ headers = {}, rawBody }) => {
    const secret = getSharedWebhookSecret();
    if (!secret) return false;

    const signature = String(
        headers["x-marketplace-webhook-signature"] ||
            headers["x-webhook-signature"] ||
            ""
    ).trim();

    if (!signature) return false;

    const expected = signPayload(rawBody, secret);
    const normalized = signature.replace(/^sha256=/i, "");
    return timingSafeEqualString(normalized, expected);
};

const verifyStripeSignature = ({ headers = {}, rawBody }) => {
    const signature = headers["stripe-signature"];
    if (!signature) return null;

    try {
        const stripe = getPaymentProvider("STRIPE");
        const event = stripe.constructWebhookEvent(rawBody, signature);
        return { provider: "stripe", event, payload: event };
    } catch (error) {
        if (error instanceof PaymentProviderError) throw error;
        throw new AppError("Invalid Stripe webhook signature.", 400);
    }
};

/**
 * Verify marketplace payment webhook authenticity.
 * Production requires configured verification unless provider is manual in non-prod.
 */
const verifyMarketplaceWebhook = ({
    provider,
    headers = {},
    rawBody = "",
    body = {},
}) => {
    const normalizedProvider = String(provider || "").trim().toLowerCase();

    if (normalizedProvider === "manual") {
        if (isProduction()) {
            const secret = getSharedWebhookSecret();
            if (!secret) {
                throw new AppError(
                    "Manual marketplace webhooks are disabled in production.",
                    403
                );
            }
            if (!verifySharedSignature({ headers, rawBody })) {
                throw new AppError("Invalid webhook signature.", 401);
            }
        }
        return { verified: true, provider: normalizedProvider, payload: body };
    }

    const stripeResult = verifyStripeSignature({ headers, rawBody });
    if (stripeResult) return { verified: true, ...stripeResult };

    if (verifySharedSignature({ headers, rawBody })) {
        return { verified: true, provider: normalizedProvider, payload: body };
    }

    if (isProduction()) {
        throw new AppError("Webhook signature verification failed.", 401);
    }

    if (!DEV_ENVS.has(String(process.env.NODE_ENV || "").toLowerCase())) {
        throw new AppError("Webhook signature verification failed.", 401);
    }

    console.warn(
        `[marketplace-security] webhook accepted without signature for provider=${normalizedProvider} (non-production)`
    );
    return { verified: false, provider: normalizedProvider, payload: body };
};

const buildWebhookEventKey = (provider, payload = {}, verified = null) => {
    if (verified?.event?.id) return `stripe:${verified.event.id}`;

    const explicit = String(payload.eventId || payload.idempotencyKey || "").trim();
    if (explicit) return `${provider}:${explicit}`;

    const txn = String(
        payload.providerTransactionId || payload.transactionId || ""
    ).trim();
    const status = String(payload.status || "").trim().toLowerCase();
    const paymentId = String(payload.paymentId || "").trim();

    return `${provider}:${paymentId}:${txn}:${status}`;
};

const getProcessedWebhookKeys = (payment) => {
    const metadata = payment?.metadata || {};
    const keys = metadata.processedWebhookKeys;
    return Array.isArray(keys) ? keys : [];
};

const hasProcessedWebhookEvent = (payment, eventKey) => {
    if (!eventKey) return false;
    return getProcessedWebhookKeys(payment).includes(eventKey);
};

const appendProcessedWebhookEvent = (payment, eventKey) => {
    if (!eventKey) return;
    payment.metadata = payment.metadata || {};
    const keys = getProcessedWebhookKeys(payment);
    if (!keys.includes(eventKey)) keys.push(eventKey);
    payment.metadata.processedWebhookKeys = keys.slice(-50);
};

const mapStripeEventToPayload = (event) => {
    const object = event?.data?.object || {};
    const status =
        event.type === "payment_intent.succeeded"
            ? "successful"
            : event.type === "payment_intent.payment_failed"
              ? "failed"
              : object.status || "";

    return {
        status,
        providerPaymentIntentId: object.id,
        providerTransactionId: object.latest_charge || "",
        paymentId: object.metadata?.marketplacePaymentId || object.metadata?.paymentId,
        failureReason:
            object.last_payment_error?.message ||
            object.cancellation_reason ||
            "",
        eventId: event.id,
        stripeEventType: event.type,
    };
};

module.exports = {
    verifyMarketplaceWebhook,
    buildWebhookEventKey,
    hasProcessedWebhookEvent,
    appendProcessedWebhookEvent,
    mapStripeEventToPayload,
    signPayload,
};
