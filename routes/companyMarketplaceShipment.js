const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/companyMarketplaceController");
const {
    shipmentIdValidator,
    updateShipmentValidator,
    addTrackingEventValidator,
    listShipmentsValidator,
} = require("../validators/companyMarketplaceValidator");

router.use(protect, resolveTenant, requireCompany, adminOnly);

router.get("/", listShipmentsValidator, validate, controller.listAllShipments);
router.get(
    "/:shipmentId",
    shipmentIdValidator,
    validate,
    controller.getShipment
);
router.patch(
    "/:shipmentId",
    updateShipmentValidator,
    validate,
    controller.updateShipment
);
router.post(
    "/:shipmentId/tracking-events",
    addTrackingEventValidator,
    validate,
    controller.addTrackingEvent
);

module.exports = router;
