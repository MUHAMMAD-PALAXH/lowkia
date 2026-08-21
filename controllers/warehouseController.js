const asyncHandler = require("express-async-handler");
const warehouseService = require("../services/warehouseService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.updatedBy || null;

exports.createWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.createWarehouse(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Warehouse created successfully.", warehouse, 201);
});

exports.getWarehouses = asyncHandler(async (req, res) => {
    const result = await warehouseService.getWarehouses(
        req.query,
        req.companyId
    );
    return success(res, "Warehouses retrieved successfully.", result);
});

exports.getActiveWarehouses = asyncHandler(async (req, res) => {
    const warehouses = await warehouseService.getActiveWarehouses(
        req.companyId
    );
    return success(
        res,
        "Active warehouses retrieved successfully.",
        warehouses
    );
});

exports.getWarehouseStats = asyncHandler(async (req, res) => {
    const stats = await warehouseService.getWarehouseStats(req.companyId);
    return success(res, "Warehouse stats retrieved successfully.", stats);
});

exports.getWarehouseById = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.getWarehouseById(
        req.params.id,
        req.companyId
    );
    return success(res, "Warehouse retrieved successfully.", warehouse);
});

exports.updateWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.updateWarehouse(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Warehouse updated successfully.", warehouse);
});

exports.assignBranches = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.assignBranches(
        req.params.id,
        req.body.branchIds || [],
        getActorId(req)
    );
    return success(res, "Branches assigned successfully.", warehouse);
});

exports.deleteWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.deleteWarehouse(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Warehouse moved to trash.", warehouse);
});

exports.restoreWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.restoreWarehouse(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Warehouse restored from trash.", warehouse);
});

exports.permanentDeleteWarehouse = asyncHandler(async (req, res) => {
    const result = await warehouseService.permanentDeleteWarehouse(
        req.params.id
    );
    return success(res, "Warehouse permanently deleted.", result);
});

exports.bulkDeleteWarehouses = asyncHandler(async (req, res) => {
    const result = await warehouseService.bulkDeleteWarehouses(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Warehouses moved to trash.", result);
});

exports.bulkRestoreWarehouses = asyncHandler(async (req, res) => {
    const result = await warehouseService.bulkRestoreWarehouses(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Warehouses restored from trash.", result);
});

exports.bulkPermanentDeleteWarehouses = asyncHandler(async (req, res) => {
    const result = await warehouseService.bulkPermanentDeleteWarehouses(
        req.body || {}
    );
    return success(res, "Trash warehouses permanently deleted.", result);
});

exports.setStatus = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setStatus(
        req.params.id,
        req.body.status,
        getActorId(req)
    );
    return success(res, "Warehouse status updated successfully.", warehouse);
});

exports.activateWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setStatus(
        req.params.id,
        "Active",
        getActorId(req)
    );
    return success(res, "Warehouse activated successfully.", warehouse);
});

exports.deactivateWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setStatus(
        req.params.id,
        "Inactive",
        getActorId(req)
    );
    return success(res, "Warehouse deactivated successfully.", warehouse);
});

exports.setMaintenance = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setStatus(
        req.params.id,
        "Maintenance",
        getActorId(req)
    );
    return success(res, "Warehouse set to maintenance successfully.", warehouse);
});

exports.closeWarehouse = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setStatus(
        req.params.id,
        "Closed",
        getActorId(req)
    );
    return success(res, "Warehouse closed successfully.", warehouse);
});

exports.setDefault = asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.setDefault(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Warehouse set as default successfully.", warehouse);
});
