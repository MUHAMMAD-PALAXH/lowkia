const asyncHandler = require("express-async-handler");
const leaveService = require("../services/leaveService");
const { success } = require("../utils/apiResponse");

exports.createMyLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.createLeaveRequest(req.user, req.body);
    return success(res, "Leave request submitted.", doc, 201);
});

exports.createLeaveAdmin = asyncHandler(async (req, res) => {
    const doc = await leaveService.createLeaveRequest(req.user, req.body, {
        asAdmin: true
    });
    return success(res, "Leave request created.", doc, 201);
});

exports.getMyLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.getLeaves(req.query, req.user, {
        selfOnly: true
    });
    return success(res, "My leave requests retrieved.", result);
});

exports.getLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.getLeaves(req.query, req.user, {
        managedBranchIds: req.managedBranchIds ?? null
    });
    return success(res, "Leave requests retrieved.", result);
});

exports.getLeaveById = asyncHandler(async (req, res) => {
    const doc = await leaveService.getLeaveById(req.params.id);
    return success(res, "Leave request retrieved.", doc);
});

exports.approveLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.approveLeave(
        req.params.id,
        req.user,
        req.body.comment || ""
    );
    return success(res, "Leave approved. Attendance markers synced.", doc);
});

exports.rejectLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.rejectLeave(
        req.params.id,
        req.user,
        req.body.reason || ""
    );
    return success(res, "Leave rejected.", doc);
});

exports.cancelMyLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.cancelLeave(
        req.params.id,
        req.user,
        req.body.reason || "",
        { asAdmin: false }
    );
    return success(res, "Leave cancelled.", doc);
});

exports.cancelLeaveAdmin = asyncHandler(async (req, res) => {
    const doc = await leaveService.cancelLeave(
        req.params.id,
        req.user,
        req.body.reason || "",
        { asAdmin: true }
    );
    return success(res, "Leave cancelled.", doc);
});
