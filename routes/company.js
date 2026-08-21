const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const companyController = require("../controllers/companyController");
const saasBillingController = require("../controllers/saasBillingController");
const validate = require("../middleware/validate");
const {
    checkoutValidator,
    submitPaymentValidator,
    invoiceIdValidator,
    paymentIdValidator,
    listAccountsValidator,
} = require("../validators/saasBillingValidator");
const { uploadPaymentProof } = require("../uploadFile");

router.use(protect);

router.get("/me", resolveTenant, companyController.getMyCompany);
router.post(
    "/bootstrap",
    adminOnly,
    resolveTenant,
    companyController.bootstrapCompany
);

// ─── Company Plans & Billing (owner/admin) ───────────────────────────────────
router.get(
    "/billing/plans",
    adminOnly,
    resolveTenant,
    saasBillingController.listCompanyBillingPlans
);
router.get(
    "/billing/subscription",
    adminOnly,
    resolveTenant,
    saasBillingController.getCompanyBillingSubscription
);
router.get(
    "/billing/payment-accounts",
    adminOnly,
    resolveTenant,
    listAccountsValidator,
    validate,
    saasBillingController.listCheckoutAccounts
);
router.post(
    "/billing/checkout",
    adminOnly,
    resolveTenant,
    checkoutValidator,
    validate,
    saasBillingController.createCompanyCheckout
);
router.post(
    "/billing/payments",
    adminOnly,
    resolveTenant,
    uploadPaymentProof.single("proof"),
    submitPaymentValidator,
    validate,
    (req, res, next) => {
        if (req.file?.path) req.body.proofUrl = req.file.path;
        next();
    },
    saasBillingController.submitCompanyPayment
);
router.get(
    "/billing/invoices",
    adminOnly,
    resolveTenant,
    saasBillingController.listCompanyInvoices
);
router.get(
    "/billing/invoices/:id",
    adminOnly,
    resolveTenant,
    invoiceIdValidator,
    validate,
    saasBillingController.getCompanyInvoice
);
router.get(
    "/billing/payments",
    adminOnly,
    resolveTenant,
    saasBillingController.listCompanyPayments
);
router.get(
    "/billing/payments/:id",
    adminOnly,
    resolveTenant,
    paymentIdValidator,
    validate,
    saasBillingController.getCompanyPayment
);

module.exports = router;
