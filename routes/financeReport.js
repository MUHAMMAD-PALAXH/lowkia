const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
} = require("../middleware/financeAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/financeReportController");
const {
    idValidator,
    payrollIdValidator,
    runIdValidator,
    commonFilters,
    payablesValidator,
    supplierPaymentsValidator,
    payrollRunsValidator,
    advancesValidator,
    employeePaymentsValidator,
} = require("../validators/financeReportValidator");

// Base: /api/finance-reports
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/dashboard", commonFilters, validate, controller.dashboard);

router.get(
    "/supplier-payables",
    payablesValidator,
    validate,
    controller.supplierPayables
);
router.get(
    "/supplier-payments",
    supplierPaymentsValidator,
    validate,
    controller.supplierPayments
);

router.get(
    "/payroll-runs",
    payrollRunsValidator,
    validate,
    controller.payrollRuns
);
router.get(
    "/payroll-runs/:runId",
    runIdValidator,
    validate,
    controller.payrollRunSummary
);

router.get(
    "/employee-advances",
    advancesValidator,
    validate,
    controller.employeeAdvances
);
router.get(
    "/employee-payments",
    employeePaymentsValidator,
    validate,
    controller.employeePayments
);

// On-demand printable payloads (Flutter builds PDF client-side)
router.get(
    "/payslips/:payrollId",
    payrollIdValidator,
    validate,
    controller.payslip
);
router.get(
    "/receipts/supplier/:id",
    idValidator,
    validate,
    controller.supplierReceipt
);
router.get(
    "/receipts/employee/:id",
    idValidator,
    validate,
    controller.employeeReceipt
);

module.exports = router;
