const asyncHandler = require("express-async-handler");
const branchService = require("../services/branchService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.updatedBy || null;

exports.createBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.createBranch(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Branch created successfully.", branch, 201);
});

exports.getBranches = asyncHandler(async (req, res) => {
    const result = await branchService.getBranches(req.query, req.companyId);
    return success(res, "Branches retrieved successfully.", result);
});

exports.getActiveBranches = asyncHandler(async (req, res) => {
    const branches = await branchService.getActiveBranches(req.companyId);
    return success(res, "Active branches retrieved successfully.", branches);
});

exports.getBranchStats = asyncHandler(async (req, res) => {
    const stats = await branchService.getBranchStats(req.companyId);
    return success(res, "Branch stats retrieved successfully.", stats);
});

exports.getBranchById = asyncHandler(async (req, res) => {
    const branch = await branchService.getBranchById(
        req.params.id,
        req.companyId
    );
    return success(res, "Branch retrieved successfully.", branch);
});

exports.updateBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.updateBranch(
        req.params.id,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Branch updated successfully.", branch);
});

exports.assignWarehouses = asyncHandler(async (req, res) => {
    const branch = await branchService.assignWarehouses(
        req.params.id,
        req.body.warehouseIds || [],
        getActorId(req)
    );
    return success(res, "Warehouses assigned successfully.", branch);
});

exports.deleteBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.deleteBranch(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Branch moved to trash.", branch);
});

exports.restoreBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.restoreBranch(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Branch restored from trash.", branch);
});

exports.permanentDeleteBranch = asyncHandler(async (req, res) => {
    const result = await branchService.permanentDeleteBranch(req.params.id);
    return success(res, "Branch permanently deleted.", result);
});

exports.bulkDeleteBranches = asyncHandler(async (req, res) => {
    const result = await branchService.bulkDeleteBranches(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Branches moved to trash.", result);
});

exports.bulkRestoreBranches = asyncHandler(async (req, res) => {
    const result = await branchService.bulkRestoreBranches(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Branches restored from trash.", result);
});

exports.bulkPermanentDeleteBranches = asyncHandler(async (req, res) => {
    const result = await branchService.bulkPermanentDeleteBranches(
        req.body || {}
    );
    return success(res, "Trash branches permanently deleted.", result);
});

exports.setStatus = asyncHandler(async (req, res) => {
    const branch = await branchService.setStatus(
        req.params.id,
        req.body.status,
        getActorId(req)
    );
    return success(res, "Branch status updated successfully.", branch);
});

exports.activateBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.setStatus(
        req.params.id,
        "Active",
        getActorId(req)
    );
    return success(res, "Branch activated successfully.", branch);
});

exports.deactivateBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.setStatus(
        req.params.id,
        "Inactive",
        getActorId(req)
    );
    return success(res, "Branch deactivated successfully.", branch);
});

exports.setMaintenance = asyncHandler(async (req, res) => {
    const branch = await branchService.setStatus(
        req.params.id,
        "Maintenance",
        getActorId(req)
    );
    return success(res, "Branch set to maintenance successfully.", branch);
});

exports.closeBranch = asyncHandler(async (req, res) => {
    const branch = await branchService.setStatus(
        req.params.id,
        "Closed",
        getActorId(req)
    );
    return success(res, "Branch closed successfully.", branch);
});

exports.setHeadOffice = asyncHandler(async (req, res) => {
    const branch = await branchService.setHeadOffice(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Branch set as Head Office successfully.", branch);
});
