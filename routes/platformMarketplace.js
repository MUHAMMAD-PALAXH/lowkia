const express = require("express");
const router = express.Router();

const validate = require("../middleware/validate");
const controller = require("../controllers/platformMarketplaceController");
const {
    listOrdersValidator,
    listPaymentsValidator,
    listRefundsValidator,
    masterOrderIdValidator,
    paymentIdValidator,
} = require("../validators/platformMarketplaceValidator");

/**
 * Global Super Admin marketplace monitoring (read-only).
 * Mounted at /api/platform/marketplace (inherits protect + globalSuperAdminOnly).
 */
router.get("/dashboard", controller.getDashboard);

router.get("/orders", listOrdersValidator, validate, controller.listOrders);
router.get(
    "/orders/:masterOrderId",
    masterOrderIdValidator,
    validate,
    controller.getOrder
);

router.get("/payments", listPaymentsValidator, validate, controller.listPayments);
router.get(
    "/payments/:paymentId",
    paymentIdValidator,
    validate,
    controller.getPayment
);

router.get("/refunds", listRefundsValidator, validate, controller.listRefunds);

module.exports = router;
