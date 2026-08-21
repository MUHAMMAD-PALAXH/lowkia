const assert = require("assert");
const {
    METHODS_REQUIRING_TXN_ID,
    SUBSCRIPTION_PAYMENT_INTENTS,
} = require("../../constants/saasBilling");
const { _test } = require("../../services/subscriptionBillingService");

exports.payment_reference_format = () => {
    assert.strictEqual(
        _test.buildPaymentReference("CO000003", "SUB000007"),
        "FAP-CO000003-SUB000007"
    );
    assert.strictEqual(
        _test.buildPaymentReference(" co 1 ", " sub 2 "),
        "FAP-CO1-SUB2"
    );
};

exports.methods_requiring_txn_id = () => {
    assert.ok(METHODS_REQUIRING_TXN_ID.has("bank_transfer"));
    assert.ok(METHODS_REQUIRING_TXN_ID.has("bkash"));
    assert.ok(METHODS_REQUIRING_TXN_ID.has("nagad"));
    assert.ok(METHODS_REQUIRING_TXN_ID.has("rocket"));
    assert.ok(!METHODS_REQUIRING_TXN_ID.has("cash"));
};

exports.intents_include_v1_set = () => {
    for (const intent of [
        "new",
        "renew",
        "upgrade",
        "downgrade_schedule",
    ]) {
        assert.ok(
            SUBSCRIPTION_PAYMENT_INTENTS.includes(intent),
            `missing intent ${intent}`
        );
    }
};

exports.early_renew_extends_from_period_end = () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    const periodEnd = new Date("2026-03-20T12:00:00.000Z");
    const r = _test.resolveActivationPeriods({
        intent: "renew",
        subStatus: "active",
        currentPeriodEnd: periodEnd,
        billingInterval: "monthly",
        now,
    });
    assert.strictEqual(r.mode, "early_renew");
    assert.strictEqual(r.changePeriod, true);
    assert.strictEqual(r.periodStart.toISOString(), periodEnd.toISOString());
    assert.strictEqual(r.periodEnd.getUTCMonth(), 3); // April
};

exports.expire_renew_starts_from_now = () => {
    const now = new Date("2026-03-25T12:00:00.000Z");
    const periodEnd = new Date("2026-03-20T12:00:00.000Z");
    const r = _test.resolveActivationPeriods({
        intent: "renew",
        subStatus: "expired",
        currentPeriodEnd: periodEnd,
        billingInterval: "monthly",
        now,
    });
    assert.strictEqual(r.mode, "expire_renew");
    assert.strictEqual(r.periodStart.toISOString(), now.toISOString());
};

exports.upgrade_starts_immediately = () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const r = _test.resolveActivationPeriods({
        intent: "upgrade",
        subStatus: "active",
        currentPeriodEnd: new Date("2026-06-15T00:00:00.000Z"),
        billingInterval: "yearly",
        now,
    });
    assert.strictEqual(r.mode, "upgrade");
    assert.strictEqual(r.periodStart.toISOString(), now.toISOString());
    assert.strictEqual(r.periodEnd.getUTCFullYear(), 2027);
};

exports.trial_buy_starts_from_now = () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const r = _test.resolveActivationPeriods({
        intent: "new",
        subStatus: "trialing",
        currentPeriodEnd: new Date("2026-01-15T00:00:00.000Z"),
        billingInterval: "monthly",
        now,
    });
    assert.strictEqual(r.mode, "new_or_trial_buy");
    assert.strictEqual(r.periodStart.toISOString(), now.toISOString());
};

exports.downgrade_does_not_change_period = () => {
    const periodEnd = new Date("2026-07-01T00:00:00.000Z");
    const r = _test.resolveActivationPeriods({
        intent: "downgrade_schedule",
        subStatus: "active",
        currentPeriodEnd: periodEnd,
        billingInterval: "monthly",
        now: new Date("2026-06-01T00:00:00.000Z"),
    });
    assert.strictEqual(r.mode, "downgrade_scheduled");
    assert.strictEqual(r.changePlan, false);
    assert.strictEqual(r.changePeriod, false);
    assert.strictEqual(r.periodEnd.toISOString(), periodEnd.toISOString());
};
