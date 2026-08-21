const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
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
router.use(protect, resolveTenant, requireCompany, blockVendor);

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

// Trash (before /:id)
router.get(
    "/trash-count",
    attendanceAdminOnly,
    attachBranchScope,
    controller.getTrashCount
);
router.post(
    "/bulk-delete",
    attendanceAdminOnly,
    attachBranchScope,
    controller.bulkDeleteCorrections
);
router.post(
    "/bulk-restore",
    attendanceAdminOnly,
    attachBranchScope,
    controller.bulkRestoreCorrections
);
router.post(
    "/bulk-permanent-delete",
    attendanceAdminOnly,
    attachBranchScope,
    ownerOnly,
    controller.bulkPermanentDeleteCorrections
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
router.delete(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.deleteCorrection
);
router.patch(
    "/:id/restore",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.restoreCorrection
);
router.delete(
    "/:id/permanent",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteCorrection
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
