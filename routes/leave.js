const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const {
    attendanceAdminOnly,
    blockVendor,
    attachBranchScope,
    ownerOnly
} = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/leaveController");
const {
    listValidator,
    createLeaveValidator,
    rejectValidator,
    approveValidator,
    cancelValidator,
    idValidator
} = require("../validators/leaveValidator");

// Base: /api/leaves
router.use(protect, resolveTenant, requireCompany, blockVendor);

// Employee self
router.get("/me", listValidator, validate, controller.getMyLeaves);
router.post(
    "/me",
    createLeaveValidator,
    validate,
    controller.createMyLeave
);
router.patch(
    "/me/:id/cancel",
    cancelValidator,
    validate,
    controller.cancelMyLeave
);

// Admin
router.get(
    "/",
    attendanceAdminOnly,
    attachBranchScope,
    listValidator,
    validate,
    controller.getLeaves
);
router.post(
    "/",
    attendanceAdminOnly,
    attachBranchScope,
    createLeaveValidator,
    validate,
    controller.createLeaveAdmin
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
    controller.bulkDeleteLeaves
);
router.post(
    "/bulk-restore",
    attendanceAdminOnly,
    attachBranchScope,
    controller.bulkRestoreLeaves
);
router.post(
    "/bulk-permanent-delete",
    attendanceAdminOnly,
    attachBranchScope,
    ownerOnly,
    controller.bulkPermanentDeleteLeaves
);

router.get(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.getLeaveById
);
router.patch(
    "/:id/approve",
    attendanceAdminOnly,
    attachBranchScope,
    approveValidator,
    validate,
    controller.approveLeave
);
router.patch(
    "/:id/reject",
    attendanceAdminOnly,
    attachBranchScope,
    rejectValidator,
    validate,
    controller.rejectLeave
);
router.patch(
    "/:id/cancel",
    attendanceAdminOnly,
    attachBranchScope,
    cancelValidator,
    validate,
    controller.cancelLeaveAdmin
);
router.delete(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.deleteLeave
);
router.patch(
    "/:id/restore",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.restoreLeave
);
router.delete(
    "/:id/permanent",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteLeave
);

module.exports = router;
