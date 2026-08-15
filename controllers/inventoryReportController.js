const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const inventoryReportService = require("../services/inventoryReportService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await inventoryReportService.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds,
        req.user?.role
    );
    return success(res, "Inventory dashboard report.", report);
});
