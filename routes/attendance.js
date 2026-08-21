const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const {
    attendanceAdminOnly,
    blockVendor,
    attachBranchScope,
    stripSpoofFields
} = require("../middleware/hrAccess");
const { punchRateLimit } = require("../middleware/rateLimit");
const validate = require("../middleware/validate");
const controller = require("../controllers/attendanceController");
const {
    idValidator,
    listValidator,
    historyValidator,
    monthlyValidator,
    checkInValidator,
    checkOutValidator,
    startBreakValidator,
    dailyReportValidator,
    monthlyReportValidator,
    branchReportValidator
} = require("../validators/attendanceValidator");
const { query } = require("express-validator");

// Base: /api/attendances
router.use(protect, resolveTenant, requireCompany, blockVendor);

// ---- Employee self ----
router.get("/me/today", controller.getMyToday);
router.get("/me/employee", controller.getMyEmployee);
router.get("/me", historyValidator, validate, controller.getMyHistory);
router.get(
    "/me/monthly-summary",
    monthlyValidator,
    validate,
    controller.getMyMonthlySummary
);

router.post(
    "/check-in",
    punchRateLimit,
    stripSpoofFields,
    checkInValidator,
    validate,
    controller.checkIn
);
router.post(
    "/check-out",
    punchRateLimit,
    stripSpoofFields,
    checkOutValidator,
    validate,
    controller.checkOut
);
router.post(
    "/break/start",
    punchRateLimit,
    stripSpoofFields,
    startBreakValidator,
    validate,
    controller.startBreak
);
router.post(
    "/break/end",
    punchRateLimit,
    stripSpoofFields,
    controller.endBreak
);

// ---- Admin reports / audit (before /:id) ----
router.get(
    "/reports/daily",
    attendanceAdminOnly,
    attachBranchScope,
    dailyReportValidator,
    validate,
    controller.getDailyReport
);
router.get(
    "/reports/monthly",
    attendanceAdminOnly,
    attachBranchScope,
    monthlyReportValidator,
    validate,
    controller.getMonthlyReport
);
router.get(
    "/reports/branch",
    attendanceAdminOnly,
    attachBranchScope,
    branchReportValidator,
    validate,
    controller.getBranchReport
);
router.get(
    "/audit",
    attendanceAdminOnly,
    attachBranchScope,
    [
        query("page").optional().isInt({ min: 1 }),
        query("limit").optional().isInt({ min: 1, max: 100 }),
        query("activityType").optional().isString(),
        query("subModule").optional().isString(),
        query("userId").optional().isMongoId(),
        query("referenceId").optional().isMongoId(),
        query("branchId").optional().isMongoId()
    ],
    validate,
    controller.getAttendanceAudit
);

// ---- Admin list / detail ----
router.get(
    "/",
    attendanceAdminOnly,
    attachBranchScope,
    listValidator,
    validate,
    controller.listAttendance
);
router.get(
    "/:id",
    attendanceAdminOnly,
    attachBranchScope,
    idValidator,
    validate,
    controller.getAttendanceById
);

module.exports = router;
