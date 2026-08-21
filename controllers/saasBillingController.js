const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const {
    listPaymentAccounts,
    listActiveAccountsForCheckout,
    getPaymentAccount,
    createPaymentAccount,
    updatePaymentAccount,
    setPaymentAccountActive,
    softDeletePaymentAccount,
} = require("../services/platformPaymentAccountService");
const {
    createCheckoutInvoice,
    submitSubscriptionPayment,
    approveSubscriptionPayment,
    rejectSubscriptionPayment,
    listIncomingPayments,
    listSubscriptionTransactions,
    listSubscriptionInvoices,
    listCompanyInvoices,
    listCompanyPayments,
    getBillingOverview,
    getSubscriptionPayment,
    getSubscriptionInvoice,
} = require("../services/subscriptionBillingService");
const { listPlansEnriched } = require("../services/planService");
const { getCompanySubscription } = require("../services/subscriptionService");
const AppError = require("../utils/appError");

// ─── Platform payment accounts ───────────────────────────────────────────────

exports.listPaymentAccounts = asyncHandler(async (req, res) => {
    const rows = await listPaymentAccounts(req.query);
    return success(res, "Payment accounts retrieved", rows);
});

exports.getPaymentAccount = asyncHandler(async (req, res) => {
    const row = await getPaymentAccount(req.params.id);
    return success(res, "Payment account retrieved", row);
});

exports.createPaymentAccount = asyncHandler(async (req, res) => {
    const row = await createPaymentAccount(req.body, req.user);
    return success(res, "Payment account created", row, 201);
});

exports.updatePaymentAccount = asyncHandler(async (req, res) => {
    const row = await updatePaymentAccount(req.params.id, req.body, req.user);
    return success(res, "Payment account updated", row);
});

exports.activatePaymentAccount = asyncHandler(async (req, res) => {
    const row = await setPaymentAccountActive(req.params.id, true, req.user);
    return success(res, "Payment account activated", row);
});

exports.deactivatePaymentAccount = asyncHandler(async (req, res) => {
    const row = await setPaymentAccountActive(req.params.id, false, req.user);
    return success(res, "Payment account deactivated", row);
});

exports.deletePaymentAccount = asyncHandler(async (req, res) => {
    const row = await softDeletePaymentAccount(req.params.id, req.user);
    return success(res, "Payment account removed", row);
});

// ─── Platform billing overview / queues ──────────────────────────────────────

exports.getBillingOverview = asyncHandler(async (req, res) => {
    const data = await getBillingOverview();
    return success(res, "Billing overview retrieved", data);
});

exports.listIncomingPayments = asyncHandler(async (req, res) => {
    const rows = await listIncomingPayments(req.query);
    return success(res, "Incoming payments retrieved", rows);
});

exports.getIncomingPayment = asyncHandler(async (req, res) => {
    const row = await getSubscriptionPayment(req.params.id);
    return success(res, "Payment retrieved", row);
});

exports.approveIncomingPayment = asyncHandler(async (req, res) => {
    const row = await approveSubscriptionPayment(req.params.id, req.user);
    return success(res, "Payment approved", row);
});

exports.rejectIncomingPayment = asyncHandler(async (req, res) => {
    const row = await rejectSubscriptionPayment(req.params.id, req.user, {
        reason: req.body.reason,
        note: req.body.note,
    });
    return success(res, "Payment rejected", row);
});

exports.listPlatformInvoices = asyncHandler(async (req, res) => {
    const rows = await listSubscriptionInvoices(req.query);
    return success(res, "Invoices retrieved", rows);
});

exports.getPlatformInvoice = asyncHandler(async (req, res) => {
    const row = await getSubscriptionInvoice(req.params.id);
    return success(res, "Invoice retrieved", row);
});

exports.listPlatformTransactions = asyncHandler(async (req, res) => {
    const txs = await listSubscriptionTransactions(req.query);
    return success(res, "Transactions retrieved", txs);
});

// ─── Company billing (owner/admin) ───────────────────────────────────────────

exports.listCompanyBillingPlans = asyncHandler(async (req, res) => {
    // Include Active plans and legacy rows with isActive:true but no status.
    const plans = await listPlansEnriched({ activeOnly: true });
    return success(res, "Plans retrieved", plans);
});

exports.getCompanyBillingSubscription = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const sub = await getCompanySubscription(req.companyId);
    return success(res, "Subscription retrieved", sub);
});

exports.listCheckoutAccounts = asyncHandler(async (req, res) => {
    const rows = await listActiveAccountsForCheckout({
        currency: req.query.currency,
        paymentMethod: req.query.paymentMethod,
    });
    return success(res, "Payment instructions retrieved", rows);
});

exports.createCompanyCheckout = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const invoice = await createCheckoutInvoice({
        companyId: req.companyId,
        planId: req.body.planId,
        intent: req.body.intent || "new",
        preferredPaymentMethod: req.body.preferredPaymentMethod,
        paymentAccountId: req.body.paymentAccountId,
        actor: req.user,
    });
    return success(res, "Checkout invoice created", invoice, 201);
});

exports.submitCompanyPayment = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const payment = await submitSubscriptionPayment({
        companyId: req.companyId,
        invoiceId: req.body.invoiceId,
        paymentAccountId: req.body.paymentAccountId,
        paymentMethod: req.body.paymentMethod,
        transactionId: req.body.transactionId,
        paymentDate: req.body.paymentDate,
        amountMinor: req.body.amountMinor,
        proofUrl: req.body.proofUrl,
        note: req.body.note,
        actor: req.user,
    });
    return success(res, "Payment submitted for verification", payment, 201);
});

exports.listCompanyInvoices = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const rows = await listCompanyInvoices(req.companyId);
    return success(res, "Invoices retrieved", rows);
});

exports.getCompanyInvoice = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const row = await getSubscriptionInvoice(req.params.id, req.companyId);
    return success(res, "Invoice retrieved", row);
});

exports.listCompanyPayments = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const rows = await listCompanyPayments(req.companyId);
    return success(res, "Payments retrieved", rows);
});

exports.getCompanyPayment = asyncHandler(async (req, res) => {
    if (!req.companyId) throw new AppError("Company context required.", 400);
    const row = await getSubscriptionPayment(req.params.id);
    if (String(row.companyId?._id || row.companyId) !== String(req.companyId)) {
        throw new AppError("Payment not found.", 404);
    }
    return success(res, "Payment retrieved", row);
});
