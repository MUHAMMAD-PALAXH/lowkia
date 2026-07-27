const asyncHandler = require("express-async-handler");
const inventoryService = require("../services/inventoryService");
const { success } = require("../utils/apiResponse");

exports.getInventoryList = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryList(req.query);
    return success(res, "Inventory retrieved successfully.", data);
});

exports.getInventoryStats = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryStats();
    return success(res, "Inventory stats retrieved.", data);
});

exports.getLowStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.getLowStock(req.query);
    return success(res, "Low stock items retrieved.", data);
});

exports.getStockMovements = asyncHandler(async (req, res) => {
    const data = await inventoryService.getStockMovements(req.query);
    return success(res, "Stock movements retrieved.", data);
});

exports.getImeiStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.getImeiStock(req.query);
    return success(res, "IMEI stock retrieved.", data);
});

exports.syncProductStock = asyncHandler(async (req, res) => {
    const data = await inventoryService.syncProductStockSummaries();
    return success(res, "Product stock summaries synced from inventory.", data);
});

exports.getInventoryById = asyncHandler(async (req, res) => {
    const data = await inventoryService.getInventoryById(req.params.id);
    return success(res, "Inventory record retrieved.", data);
});
