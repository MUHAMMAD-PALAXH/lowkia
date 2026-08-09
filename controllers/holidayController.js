const asyncHandler = require("express-async-handler");
const holidayService = require("../services/holidayService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

exports.createHoliday = asyncHandler(async (req, res) => {
    const doc = await holidayService.createHoliday(req.body, getActorId(req));
    return success(res, "Holiday created.", doc, 201);
});

exports.getHolidays = asyncHandler(async (req, res) => {
    const result = await holidayService.getHolidays(req.query);
    return success(res, "Holidays retrieved.", result);
});

exports.getHolidayById = asyncHandler(async (req, res) => {
    const doc = await holidayService.getHolidayById(req.params.id);
    return success(res, "Holiday retrieved.", doc);
});

exports.updateHoliday = asyncHandler(async (req, res) => {
    const doc = await holidayService.updateHoliday(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Holiday updated.", doc);
});

exports.deleteHoliday = asyncHandler(async (req, res) => {
    const doc = await holidayService.deleteHoliday(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Holiday moved to trash.", doc);
});

exports.restoreHoliday = asyncHandler(async (req, res) => {
    const doc = await holidayService.restoreHoliday(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Holiday restored.", doc);
});

exports.permanentDeleteHoliday = asyncHandler(async (req, res) => {
    const result = await holidayService.permanentDeleteHoliday(req.params.id);
    return success(res, "Holiday permanently deleted.", result);
});
