const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { ownerOnly, attendanceAdminOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/settingsController");
const { updateSettingsValidator } = require("../validators/settingsValidator");

// Base: /api/settings
router.get(
    "/timezone",
    protect,
    attendanceAdminOnly,
    controller.getTimezone
);

router.get("/", protect, attendanceAdminOnly, controller.getSettings);

router.patch(
    "/",
    protect,
    ownerOnly,
    updateSettingsValidator,
    validate,
    controller.updateSettings
);

module.exports = router;
