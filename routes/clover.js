const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const validate = require("../middleware/validate");
const controller = require("../controllers/cloverController");
const {
    upsertValidator,
    deviceValidator,
} = require("../validators/cloverValidator");

// Public OAuth callback — Clover redirects the browser here (no JWT).
router.get("/oauth/callback", controller.oauthCallback);

// Base: /api/clover — company owner configures merchant/device binding
router.use(protect, resolveTenant, adminOnly);

router.get("/connection", controller.getConnection);
router.get("/oauth/start", controller.startOAuth);
router.put(
    "/connection",
    upsertValidator,
    validate,
    controller.upsertConnection
);
router.post(
    "/devices",
    deviceValidator,
    validate,
    controller.addDevice
);
router.post("/devices/ping", controller.pingDevice);
router.delete("/connection", controller.disconnect);

module.exports = router;
