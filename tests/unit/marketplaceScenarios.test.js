/**
 * Phase 17 — Marketplace acceptance scenarios (20 cases, no DB).
 * Covers status engine, security, tenant isolation, shipping, refunds metadata.
 */
const assert = require("assert");
const mongoose = require("mongoose");
const AppError = require("../../utils/appError");
const { ROLES } = require("../../constants/roles");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../../services/companyService");
const { calculateShippingFee } = require("../../services/marketplace/shippingRuleService");
const {
    deriveMasterOrderStatus,
    assertCompanyTransition,
    COMPANY_ORDER_TRANSITIONS,
} = require("../../services/marketplace/marketplaceOrderStatusService");
const {
    buildWebhookEventKey,
    hasProcessedWebhookEvent,
    appendProcessedWebhookEvent,
    mapStripeEventToPayload,
    signPayload,
    verifyMarketplaceWebhook,
} = require("../../services/marketplace/marketplaceSecurityService");
const { REFUND_SCOPES } = require("../../constants/marketplace");

// S01 — Single-seller pending checkout maps to pending master status
exports.scenario_01_single_seller_pending_master = () => {
    assert.strictEqual(deriveMasterOrderStatus(["pending"]), "pending");
};

// S02 — Multi-company cart: mixed fulfillment → partially_shipped master
exports.scenario_02_multi_company_partial_ship = () => {
    assert.strictEqual(
        deriveMasterOrderStatus(["shipped", "confirmed"]),
        "partially_shipped"
    );
};

// S03 — One seller cancelled → partially_cancelled master
exports.scenario_03_partial_cancel_master = () => {
    assert.strictEqual(
        deriveMasterOrderStatus(["cancelled", "confirmed"]),
        "partially_cancelled"
    );
};

// S04 — Valid company transition confirmed → processing
exports.scenario_04_valid_company_transition = () => {
    assert.strictEqual(assertCompanyTransition("confirmed", "processing"), "processing");
};

// S05 — Invalid skip-ahead transition pending → shipped rejected
exports.scenario_05_invalid_skip_ship_transition = () => {
    assert.throws(() => assertCompanyTransition("pending", "shipped"));
};

// S06 — Delivered company orders are terminal (no further transitions)
exports.scenario_06_delivered_is_terminal = () => {
    assert.strictEqual(COMPANY_ORDER_TRANSITIONS.delivered.length, 0);
};

// S07 — Free shipping threshold applies when subtotal meets rule
exports.scenario_07_free_shipping_threshold = () => {
    const result = calculateShippingFee(
        {
            _id: "rule1",
            name: "Standard",
            ruleType: "free_threshold",
            flatFee: 80,
            freeShippingThreshold: 1000,
            estimatedDeliveryDays: 3,
        },
        1200,
        {}
    );
    assert.strictEqual(result.fee, 0);
    assert.strictEqual(result.freeShippingApplied, true);
};

// S08 — Flat shipping fee when no rule matched
exports.scenario_08_flat_shipping_without_rule = () => {
    const result = calculateShippingFee(null, 500, {});
    assert.strictEqual(result.fee, 0);
    assert.strictEqual(result.ruleId, null);
};

// S09 — Webhook event key prefers Stripe event id
exports.scenario_09_webhook_key_stripe_event_id = () => {
    const key = buildWebhookEventKey(
        "stripe",
        { paymentId: "p1", status: "successful" },
        { event: { id: "evt_123" } }
    );
    assert.strictEqual(key, "stripe:evt_123");
};

// S10 — Webhook dedupe stores and detects processed keys
exports.scenario_10_webhook_dedupe_keys = () => {
    const payment = { metadata: {} };
    const key = "stripe:evt_dup";
    assert.strictEqual(hasProcessedWebhookEvent(payment, key), false);
    appendProcessedWebhookEvent(payment, key);
    assert.strictEqual(hasProcessedWebhookEvent(payment, key), true);
    appendProcessedWebhookEvent(payment, key);
    assert.strictEqual(payment.metadata.processedWebhookKeys.length, 1);
};

// S11 — HMAC signature is stable and verifiable
exports.scenario_11_hmac_signature_roundtrip = () => {
    const body = '{"status":"successful","paymentId":"pay_1"}';
    const secret = "phase17-test-secret";
    const sig = signPayload(body, secret);
    assert.strictEqual(sig.length, 64);
    assert.strictEqual(signPayload(body, secret), sig);
    assert.notStrictEqual(signPayload(body, "other"), sig);
};

// S12 — Stripe success event maps to successful payment payload
exports.scenario_12_stripe_success_mapping = () => {
    const payload = mapStripeEventToPayload({
        id: "evt_ok",
        type: "payment_intent.succeeded",
        data: {
            object: {
                id: "pi_1",
                latest_charge: "ch_1",
                metadata: { marketplacePaymentId: "mp_1" },
            },
        },
    });
    assert.strictEqual(payload.status, "successful");
    assert.strictEqual(payload.providerPaymentIntentId, "pi_1");
    assert.strictEqual(payload.paymentId, "mp_1");
    assert.strictEqual(payload.eventId, "evt_ok");
};

// S13 — Stripe failure event maps to failed payment payload
exports.scenario_13_stripe_failure_mapping = () => {
    const payload = mapStripeEventToPayload({
        id: "evt_fail",
        type: "payment_intent.payment_failed",
        data: {
            object: {
                id: "pi_2",
                last_payment_error: { message: "Card declined" },
            },
        },
    });
    assert.strictEqual(payload.status, "failed");
    assert.strictEqual(payload.failureReason, "Card declined");
};

// S14 — Production manual webhook without secret is rejected
exports.scenario_14_production_manual_webhook_blocked = () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.MARKETPLACE_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.MARKETPLACE_WEBHOOK_SECRET;

    try {
        assert.throws(
            () =>
                verifyMarketplaceWebhook({
                    provider: "manual",
                    headers: {},
                    rawBody: "{}",
                    body: {},
                }),
            (err) => err instanceof AppError && err.statusCode === 403
        );
    } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevSecret !== undefined) {
            process.env.MARKETPLACE_WEBHOOK_SECRET = prevSecret;
        }
    }
};

// S15 — Signed manual webhook accepted when secret configured
exports.scenario_15_signed_manual_webhook_accepted = () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.MARKETPLACE_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    process.env.MARKETPLACE_WEBHOOK_SECRET = "prod-webhook-secret";

    const rawBody = '{"status":"successful","paymentId":"pay_x"}';
    const signature = signPayload(rawBody, process.env.MARKETPLACE_WEBHOOK_SECRET);

    try {
        const result = verifyMarketplaceWebhook({
            provider: "manual",
            headers: { "x-marketplace-webhook-signature": signature },
            rawBody,
            body: JSON.parse(rawBody),
        });
        assert.strictEqual(result.verified, true);
        assert.strictEqual(result.provider, "manual");
    } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevSecret !== undefined) {
            process.env.MARKETPLACE_WEBHOOK_SECRET = prevSecret;
        } else {
            delete process.env.MARKETPLACE_WEBHOOK_SECRET;
        }
    }
};

// S16 — Client cannot spoof companyId on write payloads
exports.scenario_16_stamp_company_strips_spoof = () => {
    const stamped = stampCompany(
        { name: "Line", companyId: "evil-tenant" },
        "trusted-tenant"
    );
    assert.strictEqual(stamped.companyId, "trusted-tenant");
};

// S17 — Cross-tenant document access is blocked
exports.scenario_17_cross_tenant_document_blocked = () => {
    assert.throws(
        () =>
            assertDocumentCompany(
                { companyId: "tenant-a" },
                "tenant-b",
                "CompanyOrder"
            ),
        /CompanyOrder not found/
    );
};

// S18 — Company filter requires tenant context
exports.scenario_18_company_filter_requires_tenant = () => {
    assert.throws(() => companyFilter(null), /Company context is required/);
    assert.deepStrictEqual(companyFilter("tenant-a"), { companyId: "tenant-a" });
};

// S19 — Refund scopes include company and line-level refunds
exports.scenario_19_refund_scopes_defined = () => {
    assert.ok(REFUND_SCOPES.includes("company_order"));
    assert.ok(REFUND_SCOPES.includes("order_item"));
    assert.ok(REFUND_SCOPES.includes("master_order"));
};

// S20 — Global super admin tenant middleware strips spoofed companyId
exports.scenario_20_gsa_strips_spoofed_company_id = async () => {
    const { resolveTenant } = require("../../middleware/tenant");
    const req = {
        user: {
            _id: new mongoose.Types.ObjectId(),
            role: ROLES.GLOBAL_SUPER_ADMIN,
            companyId: null,
        },
        body: { companyId: "spoofed" },
        query: { companyId: "spoofed" },
        activeCompanyId: null,
    };

    await new Promise((resolve, reject) => {
        resolveTenant(req, {}, (err) => (err ? reject(err) : resolve()));
    });

    assert.strictEqual(req.body.companyId, undefined);
    assert.strictEqual(req.query.companyId, undefined);
    assert.strictEqual(req.companyId, null);
    assert.strictEqual(req.isPlatformMode, true);
};
