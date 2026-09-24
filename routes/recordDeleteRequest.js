const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const controller = require("../controllers/recordDeleteRequestController");

router.use(protect, resolveTenant, requireCompany);

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.getById);
router.post("/:id/approve", controller.approve);
router.post("/:id/reject", controller.reject);
router.post("/:id/cancel", controller.cancel);

module.exports = router;
