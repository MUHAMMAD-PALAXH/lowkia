const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { attendanceAdminOnly, ownerOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/shiftController");
const {
    listValidator,
    createShiftValidator,
    updateShiftValidator,
    idValidator
} = require("../validators/shiftValidator");

// Base: /api/shifts
router.use(protect, attendanceAdminOnly);

router.get("/", listValidator, validate, controller.getShifts);
router.get("/active", controller.getActiveShifts);
router.get("/:id", idValidator, validate, controller.getShiftById);
router.post("/", createShiftValidator, validate, controller.createShift);
router.put("/:id", updateShiftValidator, validate, controller.updateShift);
router.delete("/:id", idValidator, validate, controller.deleteShift);
router.patch("/:id/restore", idValidator, validate, controller.restoreShift);
router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteShift
);

module.exports = router;
