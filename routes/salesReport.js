const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
} = require("../middleware/financeAccess");
const { attachBranchScope } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/salesReportController");
const {
    dashboardValidator,
    listTargetsValidator,
    upsertTargetValidator,
    deleteTargetValidator,
} = require("../validators/salesReportValidator");

// Base: /api/sales-reports
router.use(
    protect,
    resolveTenant,
    blockVendorFromFinance,
    financeStaffOnly,
    attachBranchScope
);
router.use(
    require("../middleware/rateLimit").rateLimit({
        windowMs: 60_000,
        max: 60,
        keyPrefix: "sales-report",
    })
);

router.get("/dashboard", dashboardValidator, validate, controller.dashboard);
router.get(
    "/targets",
    listTargetsValidator,
    validate,
    controller.listTargets
);
router.post(
    "/targets",
    upsertTargetValidator,
    validate,
    controller.upsertTarget
);
router.delete(
    "/targets/:id",
    deleteTargetValidator,
    validate,
    controller.deleteTarget
);

module.exports = router;
