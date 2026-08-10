/**
 * Stripe env resolution (supports legacy Lowkia key names).
 */
const getStripeSecretKey = () =>
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SKRT_KET_TST ||
    process.env.STRIPE_SECRET ||
    "";

const getStripePublishableKey = () =>
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PBLK_KET_TST ||
    process.env.STRIPE_PUBLIC_KEY ||
    "";

const getStripeWebhookSecret = () =>
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.STRIPE_WHSEC ||
    "";

const getStripeApiVersion = () =>
    process.env.STRIPE_API_VERSION || "2023-10-16";

const isStripeConfigured = () => Boolean(getStripeSecretKey());

module.exports = {
    getStripeSecretKey,
    getStripePublishableKey,
    getStripeWebhookSecret,
    getStripeApiVersion,
    isStripeConfigured,
};
