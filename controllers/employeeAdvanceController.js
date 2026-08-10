const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const employeeAdvanceService = require("../services/employeeAdvanceService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
});

exports.create = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.createAdvance(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await employeeAdvanceService.listAdvances(
        req.companyId,
        req.query,
        req.user
    );
    return success(res, "Employee advances retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.getAdvanceById(
        req.params.id,
        req.companyId,
        req.user
    );
    return success(res, "Employee advance retrieved.", doc);
});

exports.update = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.updateAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance updated.", doc);
});

exports.submit = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.submitAdvance(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Employee advance submitted.", doc);
});

exports.approve = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.approveAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance approved.", doc);
});

exports.reject = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.rejectAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance rejected.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.cancelAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance cancelled.", doc);
});

exports.disburse = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.disburseAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance disbursed.", doc);
});

exports.recover = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.recoverAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Recovery recorded.", doc);
});

exports.reverse = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.reverseAdvance(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee advance reversed.", doc);
});

exports.employeeOutstanding = asyncHandler(async (req, res) => {
    const doc = await employeeAdvanceService.getEmployeeOutstanding(
        req.params.employeeId,
        req.companyId
    );
    return success(res, "Employee advance outstanding retrieved.", doc);
});
