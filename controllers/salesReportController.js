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
