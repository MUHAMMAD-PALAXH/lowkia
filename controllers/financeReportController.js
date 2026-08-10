const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const financeReportService = require("../services/financeReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getDashboard(
        req.companyId,
        req.query
    );
    return success(res, "Finance dashboard report.", doc);
});

exports.supplierPayables = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getSupplierPayablesReport(
        req.companyId,
        req.query
    );
    return success(res, "Supplier payables report.", doc);
});

exports.supplierPayments = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getSupplierPaymentsReport(
        req.companyId,
        req.query
    );
    return success(res, "Supplier payments report.", doc);
});

exports.payrollRuns = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getPayrollRunsReport(
        req.companyId,
        req.query
    );
    return success(res, "Payroll runs report.", doc);
});

exports.payrollRunSummary = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getPayrollRunSummary(
        req.params.runId,
        req.companyId
    );
    return success(res, "Payroll run summary.", doc);
});

exports.employeeAdvances = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getEmployeeAdvancesReport(
        req.companyId,
        req.query
    );
    return success(res, "Employee advances report.", doc);
});

exports.employeePayments = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getEmployeePaymentsReport(
        req.companyId,
        req.query
    );
    return success(res, "Employee payments report.", doc);
});

exports.payslip = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getPayslipPayload(
        req.params.payrollId,
        req.companyId,
        req.user
    );
    return success(res, "Payslip payload.", doc);
});

exports.supplierReceipt = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getSupplierReceiptPayload(
        req.params.id,
        req.companyId
    );
    return success(res, "Supplier payment receipt payload.", doc);
});

exports.employeeReceipt = asyncHandler(async (req, res) => {
    const doc = await financeReportService.getEmployeeReceiptPayload(
        req.params.id,
        req.companyId,
        req.user
    );
    return success(res, "Employee payment receipt payload.", doc);
});
