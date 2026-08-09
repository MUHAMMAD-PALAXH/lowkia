const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
    attendanceAdminOnly,
    blockVendor,
    attachBranchScope,
    stripSpoofFields
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
router.use(protect, blockVendor);

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

module.exports = router;
