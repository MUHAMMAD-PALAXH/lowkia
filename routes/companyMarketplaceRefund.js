const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/companyMarketplaceRefundController");
const {
    refundIdValidator,
    completeRefundValidator,
    listRefundsValidator,
} = require("../validators/companyMarketplaceRefundValidator");

router.use(protect, resolveTenant, requireCompany, adminOnly);

router.get("/", listRefundsValidator, validate, controller.listAllRefunds);
router.get("/:refundId", refundIdValidator, validate, controller.getRefund);
router.post(
    "/:refundId/complete",
    completeRefundValidator,
    validate,
    controller.completeRefund
);
router.post(
    "/:refundId/cancel",
    refundIdValidator,
    validate,
    controller.cancelRefund
);

module.exports = router;
