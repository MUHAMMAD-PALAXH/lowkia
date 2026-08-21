/**
 * Integration smoke for SaaS offline billing (skipped if MONGO_URL unset).
 * checkout → submit → approve (transaction) and reject path.
 */
require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");

const Company = require("../../model/company");
const { ROLES } = require("../../constants/roles");
const {
    ensureDefaultPlans,
    listPlans,
    assignSubscription,
} = require("../../services/subscriptionService");
const { ensureDefaultCompany } = require("../../services/companyService");
const {
    createPaymentAccount,
    listPaymentAccounts,
} = require("../../services/platformPaymentAccountService");
const {
    createCheckoutInvoice,
    submitSubscriptionPayment,
    approveSubscriptionPayment,
    rejectSubscriptionPayment,
} = require("../../services/subscriptionBillingService");
const SubscriptionPayment = require("../../model/subscriptionPayment");
const SubscriptionInvoice = require("../../model/subscriptionInvoice");
const CompanySubscription = require("../../model/companySubscription");

const hasMongo = Boolean(process.env.MONGO_URL);

async function withDb(fn) {
    if (!hasMongo) {
        console.log("    (skip — MONGO_URL not set)");
        return;
    }
    await mongoose.connect(process.env.MONGO_URL);
    try {
        await fn();
    } finally {
        await mongoose.disconnect();
    }
}

const gsaActor = () => ({
    _id: new mongoose.Types.ObjectId(),
    role: ROLES.GLOBAL_SUPER_ADMIN,
    firstName: "Test",
    lastName: "GSA",
    email: "billing-gsa@example.com",
});

const ownerActor = (companyId) => ({
    _id: new mongoose.Types.ObjectId(),
    role: ROLES.COMPANY_SUPER_ADMIN,
    firstName: "Owner",
    lastName: "Test",
    email: "billing-owner@example.com",
    companyId,
});

exports.checkout_submit_approve_activates = async () => {
    await withDb(async () => {
        await ensureDefaultPlans();
        const plans = await listPlans({ activeOnly: true });
        const plan =
            plans.find((p) => p.planCode === "STARTER_MONTHLY") || plans[0];
        assert.ok(plan);

        const company = await ensureDefaultCompany();
        const owner = ownerActor(company._id);
        const gsa = gsaActor();

        await assignSubscription(company._id, plan._id, owner._id, {
            startTrial: true,
        });

        let accounts = await listPaymentAccounts({
            currency: plan.currency || "USD",
            paymentMethod: "bank_transfer",
        });
        if (!accounts.length) {
            await createPaymentAccount(
                {
                    currency: plan.currency || "USD",
                    paymentMethod: "bank_transfer",
                    bankName: "Test Bank",
                    accountName: "FAP SaaS",
                    accountNumber: "1234567890",
                    instructions: "Use payment reference",
                },
                gsa
            );
            accounts = await listPaymentAccounts({
                currency: plan.currency || "USD",
                paymentMethod: "bank_transfer",
            });
        }
        const account = accounts[0];
        assert.ok(account);

        const invoice = await createCheckoutInvoice({
            companyId: company._id,
            planId: plan._id,
            intent: "new",
            preferredPaymentMethod: "bank_transfer",
            paymentAccountId: account.id || account._id,
            actor: owner,
        });
        assert.ok(invoice);
        assert.strictEqual(invoice.status, "unpaid");
        assert.ok(String(invoice.paymentReference).startsWith("FAP-"));

        const txn = `TXN-APPROVE-${Date.now()}`;
        const payment = await submitSubscriptionPayment({
            companyId: company._id,
            invoiceId: invoice._id,
            paymentAccountId: account.id || account._id,
            paymentMethod: "bank_transfer",
            transactionId: txn,
            paymentDate: new Date(),
            amountMinor: invoice.amountMinor,
            actor: owner,
        });
        assert.strictEqual(payment.status, "pending_verification");

        const approved = await approveSubscriptionPayment(payment._id, gsa);
        assert.strictEqual(approved.status, "verified");

        const sub = await CompanySubscription.findById(payment.subscriptionId);
        assert.strictEqual(sub.status, "active");
        assert.strictEqual(sub.paymentStatus, "paid");

        const inv = await SubscriptionInvoice.findById(invoice._id);
        assert.strictEqual(inv.status, "paid");

        const companyFresh = await Company.findById(company._id);
        assert.strictEqual(companyFresh.status, "Active");
    });
};

exports.submit_reject_reopens_invoice = async () => {
    await withDb(async () => {
        await ensureDefaultPlans();
        const plans = await listPlans({ activeOnly: true });
        const plan =
            plans.find((p) => p.planCode === "PRO_MONTHLY") ||
            plans.find((p) => p.planCode === "STARTER_MONTHLY") ||
            plans[0];

        const company = await ensureDefaultCompany();
        const owner = ownerActor(company._id);
        const gsa = gsaActor();

        await assignSubscription(company._id, plan._id, owner._id, {
            startTrial: true,
        });

        let accounts = await listPaymentAccounts({
            currency: plan.currency || "USD",
            paymentMethod: "bkash",
        });
        if (!accounts.length) {
            await createPaymentAccount(
                {
                    currency: plan.currency || "USD",
                    paymentMethod: "bkash",
                    accountName: "FAP bKash",
                    accountNumber: "01700000000",
                    phoneNumber: "01700000000",
                },
                gsa
            );
            accounts = await listPaymentAccounts({
                currency: plan.currency || "USD",
                paymentMethod: "bkash",
            });
        }

        const invoice = await createCheckoutInvoice({
            companyId: company._id,
            planId: plan._id,
            intent: "new",
            preferredPaymentMethod: "bkash",
            paymentAccountId: accounts[0].id || accounts[0]._id,
            actor: owner,
        });

        const payment = await submitSubscriptionPayment({
            companyId: company._id,
            invoiceId: invoice._id,
            paymentAccountId: accounts[0].id || accounts[0]._id,
            paymentMethod: "bkash",
            transactionId: `TXN-REJECT-${Date.now()}`,
            paymentDate: new Date(),
            amountMinor: invoice.amountMinor,
            actor: owner,
        });

        const rejected = await rejectSubscriptionPayment(payment._id, gsa, {
            reason: "Invalid transaction ID",
            note: "smoke reject",
        });
        assert.strictEqual(rejected.status, "rejected");

        const inv = await SubscriptionInvoice.findById(invoice._id);
        assert.strictEqual(inv.status, "unpaid");

        const pay = await SubscriptionPayment.findById(payment._id);
        assert.strictEqual(pay.status, "rejected");
        assert.strictEqual(pay.rejectionReason, "Invalid transaction ID");
    });
};

exports.early_renew_extends_period_on_approve = async () => {
    await withDb(async () => {
        await ensureDefaultPlans();
        const plans = await listPlans({ activeOnly: true });
        const plan =
            plans.find((p) => p.planCode === "STARTER_MONTHLY") || plans[0];

        const company = await ensureDefaultCompany();
        const owner = ownerActor(company._id);
        const gsa = gsaActor();

        const sub = await assignSubscription(
            company._id,
            plan._id,
            owner._id,
            { startTrial: false }
        );

        // Force active period still in future
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + 10);
        await CompanySubscription.updateOne(
            { _id: sub._id },
            {
                $set: {
                    status: "active",
                    paymentStatus: "paid",
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: periodEnd,
                },
            }
        );

        let accounts = await listPaymentAccounts({
            currency: plan.currency || "USD",
            paymentMethod: "cash",
        });
        if (!accounts.length) {
            await createPaymentAccount(
                {
                    currency: plan.currency || "USD",
                    paymentMethod: "cash",
                    accountName: "Cash desk",
                    accountNumber: "CASH-1",
                    instructions: "Pay at office",
                },
                gsa
            );
            accounts = await listPaymentAccounts({
                currency: plan.currency || "USD",
                paymentMethod: "cash",
            });
        }

        const invoice = await createCheckoutInvoice({
            companyId: company._id,
            planId: plan._id,
            intent: "renew",
            preferredPaymentMethod: "cash",
            paymentAccountId: accounts[0].id || accounts[0]._id,
            actor: owner,
        });

        const payment = await submitSubscriptionPayment({
            companyId: company._id,
            invoiceId: invoice._id,
            paymentAccountId: accounts[0].id || accounts[0]._id,
            paymentMethod: "cash",
            transactionId: "",
            paymentDate: new Date(),
            amountMinor: invoice.amountMinor,
            actor: owner,
        });

        await approveSubscriptionPayment(payment._id, gsa);

        const fresh = await CompanySubscription.findById(sub._id);
        assert.strictEqual(fresh.status, "active");
        assert.ok(
            new Date(fresh.currentPeriodStart).getTime() ===
                periodEnd.getTime(),
            "early renew should start from prior period end"
        );
        assert.ok(
            new Date(fresh.currentPeriodEnd) > periodEnd,
            "period end should extend past previous end"
        );
    });
};
