const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { attendanceAdminOnly, ownerOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/holidayController");
const {
    listValidator,
    createHolidayValidator,
    updateHolidayValidator,
    idValidator
} = require("../validators/holidayValidator");

// Base: /api/holidays
router.use(protect, attendanceAdminOnly);

router.get("/", listValidator, validate, controller.getHolidays);
router.get("/:id", idValidator, validate, controller.getHolidayById);
router.post("/", createHolidayValidator, validate, controller.createHoliday);
router.put("/:id", updateHolidayValidator, validate, controller.updateHoliday);
router.delete("/:id", idValidator, validate, controller.deleteHoliday);
router.patch("/:id/restore", idValidator, validate, controller.restoreHoliday);
router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteHoliday
);

module.exports = router;
