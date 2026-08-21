const asyncHandler = require("express-async-handler");
const overtimeService = require("../services/overtimeService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

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
        { selfOnly: true },
        req.companyId
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
        { managedBranchIds: req.managedBranchIds ?? null },
        req.companyId
    );
    return success(res, "Overtime requests retrieved.", result);
});

exports.getOvertimeById = asyncHandler(async (req, res) => {
    const doc = await overtimeService.getOvertimeById(
        req.params.id,
        req.companyId
    );
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

exports.deleteOvertimeRequest = asyncHandler(async (req, res) => {
    const doc = await overtimeService.deleteOvertimeRequest(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Overtime request moved to trash.", doc);
});

exports.restoreOvertimeRequest = asyncHandler(async (req, res) => {
    const doc = await overtimeService.restoreOvertimeRequest(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Overtime request restored.", doc);
});

exports.permanentDeleteOvertimeRequest = asyncHandler(async (req, res) => {
    const result = await overtimeService.permanentDeleteOvertimeRequest(
        req.params.id
    );
    return success(res, "Overtime request permanently deleted.", result);
});

exports.bulkDeleteOvertimeRequests = asyncHandler(async (req, res) => {
    const result = await overtimeService.bulkSoftDeleteOvertimeRequests(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Overtime requests moved to trash.", result);
});

exports.bulkRestoreOvertimeRequests = asyncHandler(async (req, res) => {
    const result = await overtimeService.bulkRestoreOvertimeRequests(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Overtime requests restored from trash.", result);
});

exports.bulkPermanentDeleteOvertimeRequests = asyncHandler(async (req, res) => {
    const result = await overtimeService.bulkPermanentDeleteOvertimeRequests(
        req.body || {}
    );
    return success(
        res,
        "Trash overtime requests permanently deleted.",
        result
    );
});

exports.getTrashCount = asyncHandler(async (req, res) => {
    const count = await overtimeService.trashCount(req.companyId);
    return success(res, "Overtime trash count retrieved.", { count });
});
