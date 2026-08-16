const asyncHandler = require("express-async-handler");
const {
    getPaymentProvider,
    PaymentProviderError,
} = require("../services/paymentProviders");
const {
    completeByPaymentIntent,
} = require("../services/customerPaymentService");
const { emitNotification } = require("../services/notificationCenterService");

/**
 * Stripe webhook — must receive raw Buffer body.
 * Mounted at POST /api/webhooks/stripe before express.json().
 */
module.exports = asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
        return res.status(400).send("Missing stripe-signature header.");
    }

    let event;
    try {
        const stripe = getPaymentProvider("STRIPE");
        event = stripe.constructWebhookEvent(req.body, signature);
    } catch (err) {
        const status =
            err instanceof PaymentProviderError ? err.statusCode : 400;
        console.error("Stripe webhook signature error:", err.message);
        return res.status(status).send("Webhook signature verification failed.");
    }

    try {
        switch (event.type) {
            case "payment_intent.succeeded": {
                const intent = event.data.object;
                const result = await completeByPaymentIntent(intent.id, {
                    skipProviderCheck: true,
                    webhookAmountMinor: intent.amount_received ?? intent.amount,
                    webhookCurrency: intent.currency,
                });
                const payment = result?.payment;
                if (payment?.companyId) {
                    await emitNotification({
                        companyId: payment.companyId,
                        branchId: payment.branchId || null,
                        audienceRoles: ["admin", "branch_manager"],
                        category: "payment",
                        eventType: "paid",
                        priority: "high",
                        title: `Payment ${payment.paymentNumber || ""} completed`.trim(),
                        message: "Stripe confirmed a customer payment.",
                        entityType: "Payment",
                        entityId: String(payment.id || payment._id || ""),
                        entityLabel: payment.paymentNumber || "",
                        screen: "Finance",
                        source: "stripe",
                        eventKey: `stripe:${event.id}`,
                        metadata: { provider: "STRIPE" },
                    });
                }
                break;
            }
            case "payment_intent.payment_failed": {
                const intent = event.data.object;
                const Payment = require("../model/payment");
                // Only fail open / in-flight statuses — never cancelled → failed.
                await Payment.updateOne(
                    {
                        providerPaymentIntentId: intent.id,
                        paymentType: "CustomerPayment",
                        status: {
                            $in: [
                                "draft",
                                "pendingApproval",
                                "approved",
                                "processing",
                            ],
                        },
                    },
                    {
                        $set: {
                            status: "failed",
                            failureReason:
                                intent.last_payment_error?.message ||
                                "payment_failed",
                        },
                    }
                );
                const payment = await Payment.findOne({
                    providerPaymentIntentId: intent.id,
                    paymentType: "CustomerPayment",
                }).lean();
                if (payment?.companyId) {
                    await emitNotification({
                        companyId: payment.companyId,
                        branchId: payment.branchId || null,
                        audienceRoles: ["admin", "branch_manager"],
                        category: "payment",
                        eventType: "failed",
                        priority: "critical",
                        title: `Payment ${payment.paymentNumber || ""} failed`.trim(),
                        message:
                            intent.last_payment_error?.message ||
                            "Stripe reported a failed customer payment.",
                        entityType: "Payment",
                        entityId: String(payment._id),
                        entityLabel: payment.paymentNumber || "",
                        screen: "Finance",
                        source: "stripe",
                        eventKey: `stripe:${event.id}`,
                        metadata: { provider: "STRIPE" },
                    });
                }
                break;
            }
            default:
                break;
        }
        return res.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook handler error:", err);
        // Ask Stripe to retry; do not leak internals to the client.
        return res.status(500).json({ received: false });
    }
});
