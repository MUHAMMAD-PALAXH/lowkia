const asyncHandler = require("express-async-handler");
const overtimeService = require("../services/overtimeService");
const { success } = require("../utils/apiResponse");

const clientMeta = (req) => ({
    ipAddress:
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.ip ||
        ""
});

exports.createMyOvertime = asyncHandler(async (req, res) => {
    const doc = await overtimeService.createOvertimeRequest(
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Overtime request submitted.", doc, 201);
});

exports.getMyOvertime = asyncHandler(async (req, res) => {
    const result = await overtimeService.getOvertimeRequests(
        req.query,
        req.user,
        { selfOnly: true }
    );
    return success(res, "My overtime requests retrieved.", result);
});

exports.cancelMyOvertime = asyncHandler(async (req, res) => {
    const doc = await overtimeService.cancelOvertime(
        req.params.id,
        req.user,
        { asAdmin: false },
        clientMeta(req)
    );
    return success(res, "Overtime request cancelled.", doc);
});

exports.getOvertimeRequests = asyncHandler(async (req, res) => {
    const result = await overtimeService.getOvertimeRequests(
        req.query,
        req.user,
        { managedBranchIds: req.managedBranchIds ?? null }
    );
    return success(res, "Overtime requests retrieved.", result);
});

exports.getOvertimeById = asyncHandler(async (req, res) => {
    const doc = await overtimeService.getOvertimeById(req.params.id);
    return success(res, "Overtime request retrieved.", doc);
});

exports.approveOvertime = asyncHandler(async (req, res) => {
    const doc = await overtimeService.approveOvertime(
        req.params.id,
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Overtime approved.", doc);
});

exports.rejectOvertime = asyncHandler(async (req, res) => {
    const doc = await overtimeService.rejectOvertime(
        req.params.id,
        req.user,
        req.body.reviewNote || req.body.reason || "",
        clientMeta(req)
    );
    return success(res, "Overtime rejected.", doc);
});

exports.cancelOvertimeAdmin = asyncHandler(async (req, res) => {
    const doc = await overtimeService.cancelOvertime(
        req.params.id,
        req.user,
        { asAdmin: true },
        clientMeta(req)
    );
    return success(res, "Overtime request cancelled.", doc);
});
