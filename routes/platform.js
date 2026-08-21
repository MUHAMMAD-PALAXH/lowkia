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
router.post("/plans/ensure", subscriptionController.ensurePlans);

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

module.exports = router;
