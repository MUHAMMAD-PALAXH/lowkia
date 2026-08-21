const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const { ownerOnly, attendanceAdminOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/settingsController");
const { updateSettingsValidator } = require("../validators/settingsValidator");

// Base: /api/settings — company-scoped tenant settings (not platform console)
router.use(protect, resolveTenant, requireCompany);

router.get(
    "/timezone",
    attendanceAdminOnly,
    controller.getTimezone
);

router.get("/", attendanceAdminOnly, controller.getSettings);

router.patch(
    "/",
    ownerOnly,
    updateSettingsValidator,
    validate,
    controller.updateSettings
);

module.exports = router;
