const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const salesReportService = require("../services/salesReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await salesReportService.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    return success(res, "Sales dashboard report.", report);
});

exports.listTargets = asyncHandler(async (req, res) => {
    const targets = await salesReportService.listSalesTargets(
        req.companyId,
        req.query
    );
    return success(res, "Sales targets.", targets);
});

exports.upsertTarget = asyncHandler(async (req, res) => {
    const target = await salesReportService.upsertSalesTarget(
        req.companyId,
        req.body,
        req.user?._id || req.user?.id
    );
    return success(res, "Sales target saved.", target);
});

exports.deleteTarget = asyncHandler(async (req, res) => {
    const target = await salesReportService.deleteSalesTarget(
        req.companyId,
        req.params.id
    );
    return success(res, "Sales target deleted.", target);
});
