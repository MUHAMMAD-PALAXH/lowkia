const asyncHandler = require("express-async-handler");
const attendancePolicyService = require("../services/attendancePolicyService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

exports.createPolicy = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.createPolicy(
        req.body,
        getActorId(req)
    );
    return success(res, "Attendance policy created.", doc, 201);
});

exports.getPolicies = asyncHandler(async (req, res) => {
    const result = await attendancePolicyService.getPolicies(req.query);
    return success(res, "Attendance policies retrieved.", result);
});

exports.getDefaultPolicy = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.getActiveOrDefault();
    return success(res, "Default attendance policy retrieved.", doc);
});

exports.getPolicyById = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.getPolicyById(req.params.id);
    return success(res, "Attendance policy retrieved.", doc);
});

exports.updatePolicy = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.updatePolicy(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Attendance policy updated.", doc);
});

exports.setDefault = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.setDefault(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Default attendance policy set.", doc);
});

exports.deletePolicy = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.deletePolicy(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Attendance policy moved to trash.", doc);
});

exports.restorePolicy = asyncHandler(async (req, res) => {
    const doc = await attendancePolicyService.restorePolicy(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Attendance policy restored.", doc);
});

exports.permanentDeletePolicy = asyncHandler(async (req, res) => {
    const result = await attendancePolicyService.permanentDeletePolicy(
        req.params.id
    );
    return success(res, "Attendance policy permanently deleted.", result);
});
