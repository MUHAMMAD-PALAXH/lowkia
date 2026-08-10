const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
    financeOwnerOnly,
} = require("../middleware/financeAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/payrollRunController");
const {
    idValidator,
    payrollIdValidator,
    listRunsValidator,
    listLinesValidator,
    createValidator,
    adjustValidator,
    reasonValidator,
} = require("../validators/payrollRunValidator");

// Base: /api/payroll-runs
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/", listRunsValidator, validate, controller.list);
router.post("/", createValidator, validate, controller.create);

router.get("/lines", listLinesValidator, validate, controller.listLines);
router.get(
    "/lines/:payrollId",
    payrollIdValidator,
    validate,
    controller.getLine
);
router.post(
    "/lines/:payrollId/adjust",
    financeOwnerOnly,
    adjustValidator,
    validate,
    controller.adjustLine
);

router.get("/:id", idValidator, validate, controller.getById);
router.post("/:id/calculate", idValidator, validate, controller.calculate);
router.post("/:id/submit", idValidator, validate, controller.submit);
router.post(
    "/:id/approve",
    financeOwnerOnly,
    idValidator,
    validate,
    controller.approve
);
router.post(
    "/:id/lock",
    financeOwnerOnly,
    idValidator,
    validate,
    controller.lock
);
router.post(
    "/:id/cancel",
    reasonValidator,
    validate,
    controller.cancel
);

module.exports = router;
