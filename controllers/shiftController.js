const asyncHandler = require("express-async-handler");
const shiftService = require("../services/shiftService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

exports.createShift = asyncHandler(async (req, res) => {
    const doc = await shiftService.createShift(req.body, getActorId(req));
    return success(res, "Shift created.", doc, 201);
});

exports.getShifts = asyncHandler(async (req, res) => {
    const result = await shiftService.getShifts(req.query);
    return success(res, "Shifts retrieved.", result);
});

exports.getActiveShifts = asyncHandler(async (req, res) => {
    const items = await shiftService.getActiveShifts();
    return success(res, "Active shifts retrieved.", items);
});

exports.getShiftById = asyncHandler(async (req, res) => {
    const doc = await shiftService.getShiftById(req.params.id);
    return success(res, "Shift retrieved.", doc);
});

exports.updateShift = asyncHandler(async (req, res) => {
    const doc = await shiftService.updateShift(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Shift updated.", doc);
});

exports.deleteShift = asyncHandler(async (req, res) => {
    const doc = await shiftService.deleteShift(req.params.id, getActorId(req));
    return success(res, "Shift moved to trash.", doc);
});

exports.restoreShift = asyncHandler(async (req, res) => {
    const doc = await shiftService.restoreShift(req.params.id, getActorId(req));
    return success(res, "Shift restored.", doc);
});

exports.permanentDeleteShift = asyncHandler(async (req, res) => {
    const result = await shiftService.permanentDeleteShift(req.params.id);
    return success(res, "Shift permanently deleted.", result);
});
