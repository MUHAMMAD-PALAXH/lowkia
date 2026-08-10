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
const controller = require("../controllers/supplierPaymentController");
const {
    createValidator,
    listValidator,
    idValidator,
    reasonValidator,
    reverseValidator,
} = require("../validators/supplierPaymentValidator");

// Base: /api/supplier-payments
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);
router.use(
    require("../middleware/rateLimit").rateLimit({
        windowMs: 60_000,
        max: 40,
        keyPrefix: "suppay",
    })
);

router.get("/", listValidator, validate, controller.list);
router.post("/", createValidator, validate, controller.create);

router.get("/:id", idValidator, validate, controller.getById);
router.get("/:id/receipt", idValidator, validate, controller.receipt);

router.post(
    "/:id/approve",
    idValidator,
    reasonValidator,
    validate,
    financeOwnerOnly,
    controller.approve
);
router.post(
    "/:id/complete",
    idValidator,
    reasonValidator,
    validate,
    financeOwnerOnly,
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
    "/:id/reverse",
    reverseValidator,
    validate,
    financeOwnerOnly,
    controller.reverse
);

module.exports = router;
