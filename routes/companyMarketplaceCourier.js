const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/companyMarketplaceCourierController");
const {
    listCouriersValidator,
    courierIdValidator,
    createCourierValidator,
    updateCourierValidator,
} = require("../validators/companyMarketplaceCourierValidator");

router.use(protect, resolveTenant, requireCompany, adminOnly);

router.get("/", listCouriersValidator, validate, controller.listCouriers);
router.get("/:courierId", courierIdValidator, validate, controller.getCourier);
router.post("/", createCourierValidator, validate, controller.createCourier);
router.put(
    "/:courierId",
    updateCourierValidator,
    validate,
    controller.updateCourier
);
router.delete(
    "/:courierId",
    courierIdValidator,
    validate,
    controller.deleteCourier
);

module.exports = router;
