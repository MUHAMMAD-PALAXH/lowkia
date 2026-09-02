const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/companyMarketplaceController");
const refundController = require("../controllers/companyMarketplaceRefundController");
const {
    listCompanyOrdersValidator,
    companyOrderIdValidator,
    createShipmentValidator,
    shipmentIdValidator,
    updateShipmentValidator,
    updateCompanyOrderStatusValidator,
    bridgeErpValidator,
} = require("../validators/companyMarketplaceValidator");
const {
    createCompanyRefundValidator,
    listRefundsValidator,
} = require("../validators/companyMarketplaceRefundValidator");

router.use(protect, resolveTenant, requireCompany, adminOnly);

router.get(
    "/dashboard/summary",
    controller.getCompanyOrderDashboard
);
router.get(
    "/",
    listCompanyOrdersValidator,
    validate,
    controller.listCompanyOrders
);
router.get(
    "/:companyOrderId",
    companyOrderIdValidator,
    validate,
    controller.getCompanyOrder
);
router.get(
    "/:companyOrderId/refunds",
    [...companyOrderIdValidator, ...listRefundsValidator],
    validate,
    refundController.listRefunds
);
router.post(
    "/:companyOrderId/refunds",
    createCompanyRefundValidator,
    validate,
    refundController.createRefund
);
router.patch(
    "/:companyOrderId/status",
    updateCompanyOrderStatusValidator,
    validate,
    controller.updateCompanyOrderStatus
);
router.post(
    "/:companyOrderId/erp-bridge",
    bridgeErpValidator,
    validate,
    controller.bridgeToErp
);
router.get(
    "/:companyOrderId/shipments",
    companyOrderIdValidator,
    validate,
    controller.listShipments
);
router.post(
    "/:companyOrderId/shipments",
    createShipmentValidator,
    validate,
    controller.createShipment
);

module.exports = router;
