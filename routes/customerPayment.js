const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
    financeOwnerOnly,
} = require("../middleware/financeAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/customerPaymentController");
const {
    idValidator,
    createCheckoutValidator,
    listValidator,
    reasonValidator,
    refundValidator,
} = require("../validators/customerPaymentValidator");

// Base: /api/customer-payments
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);
router.use(
    require("../middleware/rateLimit").rateLimit({
        windowMs: 60_000,
        max: 40,
        keyPrefix: "custpay",
    })
);

router.get("/provider", controller.providerInfo);
router.get("/", listValidator, validate, controller.list);
router.post(
    "/checkout",
    createCheckoutValidator,
    validate,
    controller.createCheckout
);

router.get("/:id", idValidator, validate, controller.getStatus);
router.post(
    "/:id/complete",
    financeOwnerOnly,
    idValidator,
    validate,
    controller.complete
);
router.post(
    "/:id/cancel",
    idValidator,
    reasonValidator,
    validate,
    controller.cancel
);
router.post(
    "/:id/recover",
    financeOwnerOnly,
    idValidator,
    validate,
    controller.recover
);
router.post(
    "/:id/refund",
    financeOwnerOnly,
    idValidator,
    refundValidator,
    validate,
    controller.refund
);

module.exports = router;
