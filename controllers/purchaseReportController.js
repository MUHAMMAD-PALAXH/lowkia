const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const purchaseReportService = require("../services/purchaseReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await purchaseReportService.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    return success(res, "Purchase dashboard report.", report);
});
