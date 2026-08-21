const asyncHandler = require("express-async-handler");
const correctionService = require("../services/attendanceCorrectionService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

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
    const result = await correctionService.getCorrections(
        req.query,
        req.user,
        { selfOnly: true },
        req.companyId
    );
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
    const result = await correctionService.getCorrections(
        req.query,
        req.user,
        { managedBranchIds: req.managedBranchIds ?? null },
        req.companyId
    );
    return success(res, "Correction requests retrieved.", result);
});

exports.getCorrectionById = asyncHandler(async (req, res) => {
    const doc = await correctionService.getCorrectionById(
        req.params.id,
        req.companyId
    );
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

exports.deleteCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.deleteCorrection(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Correction request moved to trash.", doc);
});

exports.restoreCorrection = asyncHandler(async (req, res) => {
    const doc = await correctionService.restoreCorrection(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Correction request restored.", doc);
});

exports.permanentDeleteCorrection = asyncHandler(async (req, res) => {
    const result = await correctionService.permanentDeleteCorrection(
        req.params.id
    );
    return success(res, "Correction request permanently deleted.", result);
});

exports.bulkDeleteCorrections = asyncHandler(async (req, res) => {
    const result = await correctionService.bulkSoftDeleteCorrections(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Correction requests moved to trash.", result);
});

exports.bulkRestoreCorrections = asyncHandler(async (req, res) => {
    const result = await correctionService.bulkRestoreCorrections(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Correction requests restored from trash.", result);
});

exports.bulkPermanentDeleteCorrections = asyncHandler(async (req, res) => {
    const result = await correctionService.bulkPermanentDeleteCorrections(
        req.body || {}
    );
    return success(
        res,
        "Trash correction requests permanently deleted.",
        result
    );
});

exports.getTrashCount = asyncHandler(async (req, res) => {
    const count = await correctionService.trashCount(req.companyId);
    return success(res, "Correction trash count retrieved.", { count });
});
