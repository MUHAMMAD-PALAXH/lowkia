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
const controller = require("../controllers/bookkeepingController");
const {
    dashboardValidator,
    ledgerQueryValidator,
    entryIdValidator,
} = require("../validators/bookkeepingValidator");

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
        keyPrefix: "bookkeeping",
    })
);

router.get("/dashboard", dashboardValidator, validate, controller.dashboard);

// Business ledger — read-only; rows are posted by backend business hooks only.
router.get("/entries", ledgerQueryValidator, validate, controller.listEntries);
router.get("/summary", ledgerQueryValidator, validate, controller.summary);
router.get("/reports", ledgerQueryValidator, validate, controller.report);
router.get("/export", ledgerQueryValidator, validate, controller.exportEntries);
router.get("/entries/:id", entryIdValidator, validate, controller.getEntry);

module.exports = router;
