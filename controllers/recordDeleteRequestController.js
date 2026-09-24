const asyncHandler = require("express-async-handler");
const service = require("../services/recordDeleteRequestService");
const { success } = require("../utils/apiResponse");

exports.create = asyncHandler(async (req, res) => {
    const doc = await service.createRequest(
        {
            entityType: req.body?.entityType,
            entityId: req.body?.entityId,
            reason: req.body?.reason,
        },
        req.user,
        req.companyId
    );
    return success(res, "Delete request submitted.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await service.listRequests(req.query, req.user, req.companyId);
    return success(res, "Delete requests retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await service.getRequestById(
        req.params.id,
        req.user,
        req.companyId
    );
    return success(res, "Delete request retrieved.", doc);
});

exports.approve = asyncHandler(async (req, res) => {
    const doc = await service.approveRequest(
        req.params.id,
        req.user,
        req.companyId,
        req.body?.note
    );
    return success(res, "Delete request approved. Record permanently deleted.", doc);
});

exports.reject = asyncHandler(async (req, res) => {
    const doc = await service.rejectRequest(
        req.params.id,
        req.user,
        req.companyId,
        req.body?.note
    );
    return success(res, "Delete request rejected.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await service.cancelRequest(
        req.params.id,
        req.user,
        req.companyId
    );
    return success(res, "Delete request cancelled.", doc);
});
