const asyncHandler = require("express-async-handler");
const leaveService = require("../services/leaveService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

exports.createMyLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.createLeaveRequest(
        req.user,
        req.body,
        {},
        req.companyId
    );
    return success(res, "Leave request submitted.", doc, 201);
});

exports.createLeaveAdmin = asyncHandler(async (req, res) => {
    const doc = await leaveService.createLeaveRequest(
        req.user,
        req.body,
        { asAdmin: true },
        req.companyId
    );
    return success(res, "Leave request created.", doc, 201);
});

exports.getMyLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.getLeaves(
        req.query,
        req.user,
        { selfOnly: true },
        req.companyId
    );
    return success(res, "My leave requests retrieved.", result);
});

exports.getLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.getLeaves(
        req.query,
        req.user,
        { managedBranchIds: req.managedBranchIds ?? null },
        req.companyId
    );
    return success(res, "Leave requests retrieved.", result);
});

exports.getLeaveById = asyncHandler(async (req, res) => {
    const doc = await leaveService.getLeaveById(req.params.id, req.companyId);
    return success(res, "Leave request retrieved.", doc);
});

exports.approveLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.approveLeave(
        req.params.id,
        req.user,
        req.body.comment || "",
        req.companyId
    );
    return success(res, "Leave approved. Attendance markers synced.", doc);
});

exports.rejectLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.rejectLeave(
        req.params.id,
        req.user,
        req.body.reason || "",
        req.companyId
    );
    return success(res, "Leave rejected.", doc);
});

exports.cancelMyLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.cancelLeave(
        req.params.id,
        req.user,
        req.body.reason || "",
        { asAdmin: false },
        req.companyId
    );
    return success(res, "Leave cancelled.", doc);
});

exports.cancelLeaveAdmin = asyncHandler(async (req, res) => {
    const doc = await leaveService.cancelLeave(
        req.params.id,
        req.user,
        req.body.reason || "",
        { asAdmin: true },
        req.companyId
    );
    return success(res, "Leave cancelled.", doc);
});

exports.deleteLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.deleteLeave(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Leave request moved to trash.", doc);
});

exports.restoreLeave = asyncHandler(async (req, res) => {
    const doc = await leaveService.restoreLeave(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Leave request restored.", doc);
});

exports.permanentDeleteLeave = asyncHandler(async (req, res) => {
    const result = await leaveService.permanentDeleteLeave(
        req.params.id,
        req.companyId
    );
    return success(res, "Leave request permanently deleted.", result);
});

exports.bulkDeleteLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.bulkSoftDeleteLeaves(
        req.body || {},
        getActorId(req),
        req.companyId
    );
    return success(res, "Leave requests moved to trash.", result);
});

exports.bulkRestoreLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.bulkRestoreLeaves(
        req.body || {},
        getActorId(req),
        req.companyId
    );
    return success(res, "Leave requests restored from trash.", result);
});

exports.bulkPermanentDeleteLeaves = asyncHandler(async (req, res) => {
    const result = await leaveService.bulkPermanentDeleteLeaves(
        req.body || {},
        req.companyId
    );
    return success(res, "Trash leave requests permanently deleted.", result);
});

exports.getTrashCount = asyncHandler(async (req, res) => {
    const count = await leaveService.trashCount(req.companyId);
    return success(res, "Leave trash count retrieved.", { count });
});
