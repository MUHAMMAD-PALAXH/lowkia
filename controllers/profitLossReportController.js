const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const service = require("../services/profitLossReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await service.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    return success(res, "Profit and loss dashboard report.", report);
});
