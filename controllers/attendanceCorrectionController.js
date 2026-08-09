const asyncHandler = require("express-async-handler");
const correctionService = require("../services/attendanceCorrectionService");
const { success } = require("../utils/apiResponse");

const clientMeta = (req) => ({
    ipAddress:
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.ip ||
        ""
});

exports.createMyCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.createCorrection(
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Correction request submitted.", doc, 201);
});

exports.getMyCorrections = asyncHandler(async (req, res) => {
    const result = await correctionService.getCorrections(req.query, req.user, {
        selfOnly: true
    });
    return success(res, "My correction requests retrieved.", result);
});

exports.cancelMyCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.cancelCorrection(
        req.params.id,
        req.user,
        { asAdmin: false },
        clientMeta(req)
    );
    return success(res, "Correction cancelled.", doc);
});

exports.getCorrections = asyncHandler(async (req, res) => {
    const result = await correctionService.getCorrections(req.query, req.user, {
        managedBranchIds: req.managedBranchIds ?? null
    });
    return success(res, "Correction requests retrieved.", result);
});

exports.getCorrectionById = asyncHandler(async (req, res) => {
    const doc = await correctionService.getCorrectionById(req.params.id);
    return success(res, "Correction request retrieved.", doc);
});

exports.approveCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.approveCorrection(
        req.params.id,
        req.user,
        req.body.reviewNote || req.body.comment || "",
        clientMeta(req)
    );
    return success(res, "Correction approved. Attendance updated.", doc);
});

exports.rejectCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.rejectCorrection(
        req.params.id,
        req.user,
        req.body.reviewNote || req.body.reason || "",
        clientMeta(req)
    );
    return success(res, "Correction rejected.", doc);
});

exports.cancelCorrectionAdmin = asyncHandler(async (req, res) => {
    const doc = await correctionService.cancelCorrection(
        req.params.id,
        req.user,
        { asAdmin: true },
        clientMeta(req)
    );
    return success(res, "Correction cancelled.", doc);
});

exports.adminAdjustAttendance = asyncHandler(async (req, res) => {
    const doc = await correctionService.adminAdjustAttendance(
        req.params.attendanceId,
        req.body,
        req.user,
        clientMeta(req)
    );
    return success(res, "Attendance adjusted.", doc);
});
