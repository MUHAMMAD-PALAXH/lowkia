const asyncHandler = require("express-async-handler");
const attendanceService = require("../services/attendanceService");
const { success } = require("../utils/apiResponse");

const clientMeta = (req) => ({
    ipAddress:
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.ip ||
        "",
    platform: req.headers["x-client-platform"] || "",
    deviceId: req.headers["x-device-id"] || "",
    userAgent: req.headers["user-agent"] || ""
});

exports.getMyToday = asyncHandler(async (req, res) => {
    const data = await attendanceService.getMyToday(req.user);
    return success(res, "Today's attendance retrieved.", data);
});

exports.checkIn = asyncHandler(async (req, res) => {
    const doc = await attendanceService.checkIn(
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Checked in successfully.", doc, 201);
});

exports.checkOut = asyncHandler(async (req, res) => {
    const doc = await attendanceService.checkOut(
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Checked out successfully.", doc);
});

exports.startBreak = asyncHandler(async (req, res) => {
    const doc = await attendanceService.startBreak(
        req.user,
        req.body,
        clientMeta(req)
    );
    return success(res, "Break started.", doc);
});

exports.endBreak = asyncHandler(async (req, res) => {
    const doc = await attendanceService.endBreak(req.user, clientMeta(req));
    return success(res, "Break ended.", doc);
});

exports.getMyHistory = asyncHandler(async (req, res) => {
    const data = await attendanceService.getMyHistory(req.user, req.query);
    return success(res, "Attendance history retrieved.", data);
});

exports.getMyMonthlySummary = asyncHandler(async (req, res) => {
    const data = await attendanceService.getMyMonthlySummary(
        req.user,
        req.query
    );
    return success(res, "Monthly attendance summary retrieved.", data);
});

exports.listAttendance = asyncHandler(async (req, res) => {
    const data = await attendanceService.listAttendance(
        req.query,
        req.managedBranchIds ?? null
    );
    return success(res, "Attendance list retrieved.", data);
});

exports.getAttendanceById = asyncHandler(async (req, res) => {
    const doc = await attendanceService.getAttendanceById(
        req.params.id,
        req.managedBranchIds ?? null
    );
    return success(res, "Attendance retrieved.", doc);
});

exports.getDailyReport = asyncHandler(async (req, res) => {
    const reportService = require("../services/attendanceReportService");
    const data = await reportService.getDailyReport(
        req.query,
        req.managedBranchIds ?? null
    );
    return success(res, "Daily attendance report retrieved.", data);
});

exports.getMonthlyReport = asyncHandler(async (req, res) => {
    const reportService = require("../services/attendanceReportService");
    const data = await reportService.getMonthlyReport(
        req.query,
        req.managedBranchIds ?? null
    );
    return success(res, "Monthly attendance report retrieved.", data);
});

exports.getBranchReport = asyncHandler(async (req, res) => {
    const reportService = require("../services/attendanceReportService");
    const data = await reportService.getBranchReport(
        req.query,
        req.managedBranchIds ?? null
    );
    return success(res, "Branch attendance report retrieved.", data);
});

exports.getAttendanceAudit = asyncHandler(async (req, res) => {
    const { listAttendanceAudit } = require("../services/activityLogService");
    const data = await listAttendanceAudit(
        req.query,
        req.managedBranchIds ?? null
    );
    return success(res, "Attendance audit log retrieved.", data);
});
