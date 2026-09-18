const asyncHandler = require("express-async-handler");
const inventoryService = require("../services/inventoryService");
const { success } = require("../utils/apiResponse");

exports.getInventoryList = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryList(
        req.query,
        req.companyId
    );
    return success(res, "Inventory retrieved successfully.", data);
});

exports.exportInventoryExcel = asyncHandler(async (req, res) => {
    const { buffer, filename } = await inventoryService.exportInventoryExcel(
        req.query,
        req.companyId,
        req.user
    );
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);
});

exports.getInventoryStats = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryStats(
        req.query,
        req.companyId
    );
    return success(res, "Inventory stats retrieved.", data);
});

exports.getLowStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.getLowStock(req.query, req.companyId);
    return success(res, "Low stock items retrieved.", data);
});

exports.getStockMovements = asyncHandler(async (req, res) => {
    const data = await inventoryService.getStockMovements(
        req.query,
        req.companyId
    );
    return success(res, "Stock movements retrieved.", data);
});

exports.getImeiStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.getImeiStock(req.query, req.companyId);
    return success(res, "IMEI stock retrieved.", data);
});

exports.syncProductStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.syncProductStockSummaries(req.companyId);
    return success(res, "Product stock summaries synced from inventory.", data);
});

exports.clearProductStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.clearProductStock(
        req.body.productId,
        req.body.actorId || req.user?._id || null,
        req.companyId
    );
    return success(res, "Product stock cleared successfully.", data);
});

exports.getInventoryById = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryById(
        req.params.id,
        req.companyId
    );
    return success(res, "Inventory record retrieved.", data);
});
