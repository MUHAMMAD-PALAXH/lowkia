const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const service = require("../services/bookkeepingService");

exports.dashboard = asyncHandler(async (req, res) => {
    const report = await service.getDashboard(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    return success(res, "Bookkeeping dashboard retrieved.", report);
});

exports.listEntries = asyncHandler(async (req, res) => {
    const data = await service.listEntries(req.companyId, req.query, req.managedBranchIds);
    return success(res, "Bookkeeping entries retrieved.", data);
});

exports.getEntry = asyncHandler(async (req, res) => {
    const data = await service.getEntry(req.companyId, req.params.id, req.managedBranchIds);
    return success(res, "Bookkeeping entry retrieved.", data);
});

exports.summary = asyncHandler(async (req, res) => {
    const data = await service.getLedgerSummary(req.companyId, req.query, req.managedBranchIds);
    return success(res, "Bookkeeping summary retrieved.", data);
});

exports.report = asyncHandler(async (req, res) => {
    const data = await service.getLedgerReport(req.companyId, req.query, req.managedBranchIds);
    return success(res, "Bookkeeping report retrieved.", data);
});

exports.exportEntries = asyncHandler(async (req, res) => {
    const { buffer, filename, contentType, truncated } = await service.exportLedger(
        req.companyId,
        req.query,
        req.managedBranchIds
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    if (truncated) res.setHeader("X-Export-Truncated", "true");
    return res.send(buffer);
});
