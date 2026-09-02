const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/shippingRuleController");
const {
    createShippingRuleValidator,
    updateShippingRuleValidator,
    listShippingRulesValidator,
    shippingRuleIdValidator,
} = require("../validators/shippingRuleValidator");

router.use(protect, resolveTenant, requireCompany, adminOnly);

router.get("/", listShippingRulesValidator, validate, controller.listShippingRules);
router.get("/:id", shippingRuleIdValidator, validate, controller.getShippingRule);
router.post("/", createShippingRuleValidator, validate, controller.createShippingRule);
router.put(
    "/:id",
    updateShippingRuleValidator,
    validate,
    controller.updateShippingRule
);
router.delete(
    "/:id",
    shippingRuleIdValidator,
    validate,
    controller.deleteShippingRule
);

module.exports = router;
