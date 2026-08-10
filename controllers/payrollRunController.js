const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const payrollRunService = require("../services/payrollRunService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
});

exports.create = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.createRun(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Payroll run created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await payrollRunService.listRuns(req.companyId, req.query);
    return success(res, "Payroll runs retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.getRunById(
        req.params.id,
        req.companyId,
        { includeLines: req.query.includeLines !== "false" }
    );
    return success(res, "Payroll run retrieved.", doc);
});

exports.calculate = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.calculateRun(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Payroll run calculated.", doc);
});

exports.submit = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.submitForApproval(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Payroll run submitted for approval.", doc);
});

exports.approve = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.approveRun(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Payroll run approved.", doc);
});

exports.lock = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.lockRun(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Payroll run locked.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.cancelRun(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Payroll run cancelled.", doc);
});

exports.listLines = asyncHandler(async (req, res) => {
    const result = await payrollRunService.listLines(req.companyId, req.query);
    return success(res, "Payroll lines retrieved.", result);
});

exports.getLine = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.getLineById(
        req.params.payrollId,
        req.companyId
    );
    return success(res, "Payroll line retrieved.", doc);
});

exports.adjustLine = asyncHandler(async (req, res) => {
    const doc = await payrollRunService.adjustLine(
        req.params.payrollId,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Payroll line adjusted.", doc);
});
