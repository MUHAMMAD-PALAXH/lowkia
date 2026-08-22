const express = require("express");
const router = express.Router();

const { protect, globalSuperAdminOnly } = require("../middleware/auth");
const companyController = require("../controllers/companyController");
const subscriptionController = require("../controllers/subscriptionController");

/**
 * Global Super Admin — Platform Console
 * Base: /api/platform
 */
router.use(protect, globalSuperAdminOnly);

router.get("/session", companyController.getPlatformSession);
router.get("/dashboard", companyController.getPlatformDashboard);

router.get("/companies", companyController.listPlatformCompanies);
router.post("/companies", companyController.createPlatformCompany);
router.get("/companies/:id", companyController.getPlatformCompany);
router.patch("/companies/:id", companyController.updatePlatformCompany);

router.post("/companies/:id/enter", companyController.enterCompany);
router.post("/companies/:id/suspend", companyController.suspendCompany);
router.post("/companies/:id/reactivate", companyController.reactivateCompany);
router.post("/companies/:id/block", companyController.blockCompany);
router.post("/companies/:id/cancel", companyController.cancelCompany);

router.post("/enter-company", companyController.enterCompany);
router.post("/exit-company", companyController.exitCompany);

router.get("/plans", subscriptionController.listPlans);
router.get("/plans/summary", subscriptionController.getPlansSummary);
router.post("/plans", subscriptionController.createPlan);
router.post("/plans/ensure", subscriptionController.ensurePlans);
router.get("/plans/:id", subscriptionController.getPlan);
router.patch("/plans/:id", subscriptionController.updatePlan);
router.post("/plans/:id/activate", subscriptionController.activatePlan);
router.post("/plans/:id/deactivate", subscriptionController.deactivatePlan);
router.post("/plans/:id/archive", subscriptionController.archivePlan);
router.post("/plans/:id/duplicate", subscriptionController.duplicatePlan);
router.delete("/plans/:id", subscriptionController.deletePlan);
router.get("/plans/:id/subscribers", subscriptionController.listPlanSubscribers);

router.get(
    "/companies/:companyId/subscription",
    subscriptionController.getCompanySubscription
);
router.get(
    "/companies/:companyId/subscriptions",
    subscriptionController.listCompanySubscriptions
);
router.post(
    "/companies/:companyId/subscriptions",
    subscriptionController.assignSubscription
);
router.post(
    "/subscriptions/:subscriptionId/mark-paid",
    subscriptionController.markPaid
);
router.post(
    "/subscriptions/:subscriptionId/cancel",
    subscriptionController.cancelSubscription
);
router.post(
    "/subscriptions/:subscriptionId/extend-trial",
    subscriptionController.extendTrial
);
router.post(
    "/subscriptions/:subscriptionId/renew",
    subscriptionController.renewSubscription
);

// ─── Billing & Payments (SaaS) ───────────────────────────────────────────────
const saasBillingController = require("../controllers/saasBillingController");
const validate = require("../middleware/validate");
const {
    createAccountValidator,
    updateAccountValidator,
    accountIdValidator,
    listAccountsValidator,
    paymentIdValidator,
    invoiceIdValidator,
    rejectPaymentValidator,
    listPaymentsValidator,
    listInvoicesValidator,
} = require("../validators/saasBillingValidator");
const {
    uploadPaymentQr,
} = require("../uploadFile");

router.get("/billing/overview", saasBillingController.getBillingOverview);

router.get(
    "/billing/payment-accounts",
    listAccountsValidator,
    validate,
    saasBillingController.listPaymentAccounts
);
router.post(
    "/billing/payment-accounts",
    uploadPaymentQr.single("qrImage"),
    createAccountValidator,
    validate,
    (req, res, next) => {
        if (req.file?.path) req.body.qrImageUrl = req.file.path;
        next();
    },
    saasBillingController.createPaymentAccount
);
router.get(
    "/billing/payment-accounts/:id",
    accountIdValidator,
    validate,
    saasBillingController.getPaymentAccount
);
router.patch(
    "/billing/payment-accounts/:id",
    uploadPaymentQr.single("qrImage"),
    updateAccountValidator,
    validate,
    (req, res, next) => {
        if (req.file?.path) req.body.qrImageUrl = req.file.path;
        next();
    },
    saasBillingController.updatePaymentAccount
);
router.post(
    "/billing/payment-accounts/:id/activate",
    accountIdValidator,
    validate,
    saasBillingController.activatePaymentAccount
);
router.post(
    "/billing/payment-accounts/:id/deactivate",
    accountIdValidator,
    validate,
    saasBillingController.deactivatePaymentAccount
);
router.delete(
    "/billing/payment-accounts/:id",
    accountIdValidator,
    validate,
    saasBillingController.deletePaymentAccount
);

router.get(
    "/billing/invoices",
    listInvoicesValidator,
    validate,
    saasBillingController.listPlatformInvoices
);
router.get(
    "/billing/invoices/:id",
    invoiceIdValidator,
    validate,
    saasBillingController.getPlatformInvoice
);

router.get(
    "/billing/incoming-payments",
    listPaymentsValidator,
    validate,
    saasBillingController.listIncomingPayments
);
router.get(
    "/billing/incoming-payments/:id",
    paymentIdValidator,
    validate,
    saasBillingController.getIncomingPayment
);
router.post(
    "/billing/incoming-payments/:id/approve",
    paymentIdValidator,
    validate,
    saasBillingController.approveIncomingPayment
);
router.post(
    "/billing/incoming-payments/:id/reject",
    rejectPaymentValidator,
    validate,
    saasBillingController.rejectIncomingPayment
);

router.get(
    "/billing/transactions",
    listPaymentsValidator,
    validate,
    saasBillingController.listPlatformTransactions
);

module.exports = router;
