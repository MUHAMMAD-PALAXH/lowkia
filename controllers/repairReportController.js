const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const service = require("../services/repairReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await service.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    return success(res, "Repair dashboard report.", report);
});
