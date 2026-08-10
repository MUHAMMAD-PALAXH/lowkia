/**
 * Phase 9 Stripe provider + customer checkout helpers (no live Stripe calls).
 * Run: node scripts/smokeStripeCheckout.js
 */
(async () => {
    const assert = require("assert");
    const {
        NonePaymentProvider,
        StripePaymentProvider,
        getPaymentProvider,
    } = require("../services/paymentProviders");
    const { mapLegacyMethod } = require("../services/customerPaymentService");
    const {
        assertMethodProviderCombo,
    } = require("../services/paymentFoundationService");
    const {
        getStripeSecretKey,
        getStripePublishableKey,
        isStripeConfigured,
    } = require("../config/stripe");
    const { PAYMENT_TYPES } = require("../config/finance");

    assert.ok(PAYMENT_TYPES.includes("CustomerPayment"));
    assert.ok(PAYMENT_TYPES.includes("CustomerRefund"));

    assert.strictEqual(mapLegacyMethod("Card"), "CARD");
    assert.strictEqual(mapLegacyMethod("Apple Pay"), "APPLE_PAY");
    assert.strictEqual(mapLegacyMethod("Cash"), "CASH");

    assert.deepStrictEqual(assertMethodProviderCombo("CARD", "STRIPE"), {
        paymentMethod: "CARD",
        paymentProvider: "STRIPE",
    });
    assert.throws(() => assertMethodProviderCombo("CARD", "NONE"));

    const none = getPaymentProvider("NONE");
    assert.ok(none instanceof NonePaymentProvider);
    assert.strictEqual(none.name, "NONE");

    const stripe = getPaymentProvider("STRIPE");
    assert.ok(stripe instanceof StripePaymentProvider);
    assert.strictEqual(stripe.name, "STRIPE");

    const prev = process.env.STRIPE_SECRET_KEY;
    const prevLegacy = process.env.STRIPE_SKRT_KET_TST;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SKRT_KET_TST;
    // Force new provider instance client check
    const stripeFresh = new StripePaymentProvider();
    assert.strictEqual(isStripeConfigured(), false);
    await assert.rejects(
        () => stripeFresh.createPayment({ amountMinor: 100, currency: "USD" }),
        /not configured/i
    );

    if (prev != null) process.env.STRIPE_SECRET_KEY = prev;
    if (prevLegacy != null) process.env.STRIPE_SKRT_KET_TST = prevLegacy;

    process.env.STRIPE_SKRT_KET_TST = "sk_test_dummy";
    process.env.STRIPE_PBLK_KET_TST = "pk_test_dummy";
    assert.strictEqual(getStripeSecretKey(), "sk_test_dummy");
    assert.strictEqual(getStripePublishableKey(), "pk_test_dummy");
    delete process.env.STRIPE_SKRT_KET_TST;
    delete process.env.STRIPE_PBLK_KET_TST;

    require("../routes/customerPayment");
    require("../routes/stripeWebhook");

    console.log("✅ Phase 9 Stripe checkout helper smoke passed.");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
