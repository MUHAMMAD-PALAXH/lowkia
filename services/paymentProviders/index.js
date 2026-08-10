/**
 * Payment provider abstraction.
 * Stripe handles PCI card/Apple Pay; NONE is for manual ERP completions.
 * Method ≠ Provider (CARD + STRIPE, CASH + NONE, etc.).
 */

const {
    getStripeSecretKey,
    getStripePublishableKey,
    getStripeWebhookSecret,
    getStripeApiVersion,
    isStripeConfigured,
} = require("../../config/stripe");

class PaymentProviderError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "PaymentProviderError";
        this.statusCode = statusCode;
    }
}

class PaymentProvider {
    get name() {
        return "NONE";
    }

    async createPayment(_input) {
        throw new PaymentProviderError(
            `${this.name} createPayment is not implemented.`,
            501
        );
    }

    async authorizePayment(_input) {
        throw new PaymentProviderError(
            `${this.name} authorizePayment is not implemented.`,
            501
        );
    }

    async capturePayment(_providerPaymentId, _input = {}) {
        throw new PaymentProviderError(
            `${this.name} capturePayment is not implemented.`,
            501
        );
    }

    async refundPayment(_providerPaymentId, _input = {}) {
        throw new PaymentProviderError(
            `${this.name} refundPayment is not implemented.`,
            501
        );
    }

    async verifyPayment(_providerPaymentId) {
        throw new PaymentProviderError(
            `${this.name} verifyPayment is not implemented.`,
            501
        );
    }

    async getPaymentStatus(_providerPaymentId) {
        throw new PaymentProviderError(
            `${this.name} getPaymentStatus is not implemented.`,
            501
        );
    }
}

/** Manual / offline ERP payments — no external processor. */
class NonePaymentProvider extends PaymentProvider {
    get name() {
        return "NONE";
    }

    async createPayment(input) {
        return {
            provider: "NONE",
            status: "requires_manual_completion",
            amountMinor: input.amountMinor,
            currency: (input.currency || "USD").toLowerCase(),
            providerPaymentIntentId: null,
            providerTransactionId: null,
            clientSecret: null,
        };
    }

    async authorizePayment(input) {
        return this.createPayment(input);
    }

    async capturePayment(_id, input = {}) {
        return {
            provider: "NONE",
            status: "succeeded",
            ...input,
        };
    }

    async refundPayment(_id, input = {}) {
        return {
            provider: "NONE",
            status: "refunded",
            ...input,
        };
    }

    async verifyPayment() {
        return { provider: "NONE", status: "manual" };
    }

    async getPaymentStatus() {
        return { provider: "NONE", status: "manual" };
    }
}

/**
 * Stripe PaymentIntents adapter (Phase 9).
 * Never stores raw card data — only PaymentIntent / charge ids.
 */
class StripePaymentProvider extends PaymentProvider {
    constructor() {
        super();
        this._stripe = null;
    }

    get name() {
        return "STRIPE";
    }

    _client() {
        if (!isStripeConfigured()) {
            throw new PaymentProviderError(
                "Stripe is not configured. Set STRIPE_SECRET_KEY (or STRIPE_SKRT_KET_TST).",
                503
            );
        }
        if (!this._stripe) {
            const Stripe = require("stripe");
            this._stripe = new Stripe(getStripeSecretKey(), {
                apiVersion: getStripeApiVersion(),
            });
        }
        return this._stripe;
    }

    async createPayment(input = {}) {
        const stripe = this._client();
        const amount = Math.round(Number(input.amountMinor) || 0);
        if (amount < 1) {
            throw new PaymentProviderError(
                "Stripe amount must be at least 1 cent.",
                400
            );
        }
        const currency = String(input.currency || "USD").toLowerCase();

        let customerId = input.providerCustomerId || null;
        if (!customerId && (input.customerEmail || input.customerName)) {
            const customer = await stripe.customers.create({
                email: input.customerEmail || undefined,
                name: input.customerName || undefined,
                metadata: input.metadata || {},
            });
            customerId = customer.id;
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency,
            customer: customerId || undefined,
            description: input.description || undefined,
            metadata: input.metadata || {},
            automatic_payment_methods: { enabled: true },
        });

        let ephemeralKey = null;
        if (input.createEphemeralKey && customerId) {
            ephemeralKey = await stripe.ephemeralKeys.create(
                { customer: customerId },
                { apiVersion: getStripeApiVersion() }
            );
        }

        return {
            provider: "STRIPE",
            status: paymentIntent.status,
            amountMinor: paymentIntent.amount,
            currency: paymentIntent.currency,
            providerPaymentIntentId: paymentIntent.id,
            providerTransactionId: paymentIntent.latest_charge || null,
            providerCustomerId: customerId,
            clientSecret: paymentIntent.client_secret,
            publishableKey: getStripePublishableKey(),
            ephemeralKey: ephemeralKey?.secret || null,
            raw: {
                id: paymentIntent.id,
                status: paymentIntent.status,
            },
        };
    }

    async authorizePayment(input) {
        return this.createPayment(input);
    }

    async capturePayment(providerPaymentId, input = {}) {
        const stripe = this._client();
        const intent = await stripe.paymentIntents.capture(providerPaymentId, {
            amount_to_capture: input.amountMinor
                ? Math.round(Number(input.amountMinor))
                : undefined,
        });
        return {
            provider: "STRIPE",
            status: intent.status,
            providerPaymentIntentId: intent.id,
            providerTransactionId: intent.latest_charge || null,
            amountMinor: intent.amount_received || intent.amount,
            currency: intent.currency,
        };
    }

    async refundPayment(providerPaymentId, input = {}) {
        const stripe = this._client();
        let chargeId = input.chargeId || null;
        if (!chargeId && String(providerPaymentId).startsWith("pi_")) {
            const intent = await stripe.paymentIntents.retrieve(
                providerPaymentId
            );
            chargeId = intent.latest_charge;
        } else if (!chargeId) {
            chargeId = providerPaymentId;
        }
        if (!chargeId) {
            throw new PaymentProviderError(
                "No charge found to refund for this payment.",
                400
            );
        }
        const refund = await stripe.refunds.create({
            charge: chargeId,
            amount: input.amountMinor
                ? Math.round(Number(input.amountMinor))
                : undefined,
            reason: input.reason || undefined,
            metadata: input.metadata || {},
        });
        return {
            provider: "STRIPE",
            status: refund.status,
            refundId: refund.id,
            amountMinor: refund.amount,
            currency: refund.currency,
            providerTransactionId: chargeId,
        };
    }

    async verifyPayment(providerPaymentId) {
        return this.getPaymentStatus(providerPaymentId);
    }

    async getPaymentStatus(providerPaymentId) {
        const stripe = this._client();
        const intent = await stripe.paymentIntents.retrieve(providerPaymentId);
        return {
            provider: "STRIPE",
            status: intent.status,
            providerPaymentIntentId: intent.id,
            providerTransactionId: intent.latest_charge || null,
            amountMinor: intent.amount,
            amountReceivedMinor: intent.amount_received,
            currency: intent.currency,
            succeeded: intent.status === "succeeded",
        };
    }

    /** Cancel an open PaymentIntent so funds cannot be captured after local cancel. */
    async cancelPayment(providerPaymentId, reason = "requested_by_customer") {
        const stripe = this._client();
        try {
            const intent = await stripe.paymentIntents.cancel(providerPaymentId, {
                cancellation_reason: reason,
            });
            return {
                provider: "STRIPE",
                status: intent.status,
                providerPaymentIntentId: intent.id,
                canceled: intent.status === "canceled",
            };
        } catch (err) {
            // Already canceled / succeeded — surface status for callers
            if (err?.code === "payment_intent_unexpected_state") {
                const status = await this.getPaymentStatus(providerPaymentId);
                return { ...status, canceled: status.status === "canceled" };
            }
            throw new PaymentProviderError(
                err.message || "Failed to cancel Stripe PaymentIntent.",
                err.statusCode || 400
            );
        }
    }

    constructWebhookEvent(rawBody, signatureHeader) {
        const secret = getStripeWebhookSecret();
        if (!secret) {
            throw new PaymentProviderError(
                "STRIPE_WEBHOOK_SECRET is not configured.",
                503
            );
        }
        const stripe = this._client();
        return stripe.webhooks.constructEvent(
            rawBody,
            signatureHeader,
            secret
        );
    }
}

const providers = {
    NONE: new NonePaymentProvider(),
    STRIPE: new StripePaymentProvider(),
};

const getPaymentProvider = (name = "NONE") => {
    const key = String(name || "NONE").toUpperCase();
    return providers[key] || providers.NONE;
};

module.exports = {
    PaymentProvider,
    PaymentProviderError,
    NonePaymentProvider,
    StripePaymentProvider,
    getPaymentProvider,
    isStripeConfigured,
    getStripePublishableKey,
};
