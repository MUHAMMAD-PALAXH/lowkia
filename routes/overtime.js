const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const {
    attendanceAdminOnly,
    blockVendor,
    attachBranchScope,
    stripSpoofFields,
    ownerOnly
} = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/overtimeController");
const {
    listValidator,
    createOvertimeValidator,
    approveValidator,
    rejectValidator,
    cancelValidator,
    idValidator
} = require("../validators/overtimeValidator");

// Base: /api/overtime-requests
router.use(protect, resolveTenant, requireCompany, blockVendor);

router.get("/me", listValidator, validate, controller.getMyOvertime);
router.post(
    "/me",
    stripSpoofFields,
    createOvertimeValidator,
    validate,
    controller.createMyOvertime
);
router.patch(
    "/me/:id/cancel",
    cancelValidator,
    validate,
    controller.cancelMyOvertime
);

router.get(
    "/",
    attendanceAdminOnly,
    attachBranchScope,
    listValidator,
    validate,
    controller.getOvertimeRequests
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
    controller.bulkDeleteOvertimeRequests
);
router.post(
    "/bulk-restore",
    attendanceAdminOnly,
    attachBranchScope,
    controller.bulkRestoreOvertimeRequests
);
router.post(
    "/bulk-permanent-delete",
    attendanceAdminOnly,
    attachBranchScope,
    ownerOnly,
    controller.bulkPermanentDeleteOvertimeRequests
);

router.get(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.getOvertimeById
);
router.patch(
    "/:id/approve",
    attendanceAdminOnly,
    attachBranchScope,
    approveValidator,
    validate,
    controller.approveOvertime
);
router.patch(
    "/:id/reject",
    attendanceAdminOnly,
    attachBranchScope,
    rejectValidator,
    validate,
    controller.rejectOvertime
);
router.patch(
    "/:id/cancel",
    attendanceAdminOnly,
    attachBranchScope,
    cancelValidator,
    validate,
    controller.cancelOvertimeAdmin
);
router.delete(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.deleteOvertimeRequest
);
router.patch(
    "/:id/restore",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.restoreOvertimeRequest
);
router.delete(
    "/:id/permanent",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteOvertimeRequest
);

module.exports = router;
