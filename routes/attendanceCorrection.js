const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
    attendanceAdminOnly,
    blockVendor,
    ownerOnly,
    attachBranchScope,
    stripSpoofFields
} = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/attendanceCorrectionController");
const {
    listValidator,
    createCorrectionValidator,
    approveValidator,
    rejectValidator,
    cancelValidator,
    idValidator,
    adminAdjustValidator
} = require("../validators/attendanceCorrectionValidator");

// Base: /api/attendance-corrections
router.use(protect, blockVendor);

// Employee
router.get("/me", listValidator, validate, controller.getMyCorrections);
router.post(
    "/me",
    stripSpoofFields,
    createCorrectionValidator,
    validate,
    controller.createMyCorrection
);
router.patch(
    "/me/:id/cancel",
    cancelValidator,
    validate,
    controller.cancelMyCorrection
);

// Admin review
router.get(
    "/",
    attendanceAdminOnly,
    attachBranchScope,
    listValidator,
    validate,
    controller.getCorrections
);
router.get(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.getCorrectionById
);
router.patch(
    "/:id/approve",
    attendanceAdminOnly,
    attachBranchScope,
    approveValidator,
    validate,
    controller.approveCorrection
);
router.patch(
    "/:id/reject",
    attendanceAdminOnly,
    attachBranchScope,
    rejectValidator,
    validate,
    controller.rejectCorrection
);
router.patch(
    "/:id/cancel",
    attendanceAdminOnly,
    attachBranchScope,
    cancelValidator,
    validate,
    controller.cancelCorrectionAdmin
);

// Authorized manual adjust (owner/admin)
router.patch(
    "/adjust/:attendanceId",
    attendanceAdminOnly,
    ownerOnly,
    adminAdjustValidator,
    validate,
    controller.adminAdjustAttendance
);

module.exports = router;
