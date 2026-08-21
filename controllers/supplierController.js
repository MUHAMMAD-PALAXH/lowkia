const asyncHandler = require("express-async-handler");
const supplierService = require("../services/supplierService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => {
    return req.user?._id || req.body?.createdBy || req.body?.updatedBy || null;
};

// ==========================================================
// Create
// POST /api/suppliers
// ==========================================================

exports.createSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.createSupplier(
        req.body,
        getActorId(req),
        req.companyId
    );

    return success(res, "Supplier created successfully.", supplier, 201);
});

// ==========================================================
// List
// GET /api/suppliers
// ==========================================================

exports.getSuppliers = asyncHandler(async (req, res) => {
    const result = await supplierService.getSuppliers(req.query, req.companyId);
    return success(res, "Suppliers retrieved successfully.", result);
});

// ==========================================================
// Active list (for dropdowns)
// GET /api/suppliers/active
// ==========================================================

exports.getActiveSuppliers = asyncHandler(async (req, res) => {
    const suppliers = await supplierService.getActiveSuppliers(req.companyId);
    return success(res, "Active suppliers retrieved successfully.", suppliers);
});

// ==========================================================
// Stats
// GET /api/suppliers/stats
// ==========================================================

exports.getSupplierStats = asyncHandler(async (req, res) => {
    const stats = await supplierService.getSupplierStats(req.companyId);
    return success(res, "Supplier stats retrieved successfully.", stats);
});

// ==========================================================
// Reports
// ==========================================================

exports.getPurchaseReport = asyncHandler(async (req, res) => {
    const report = await supplierService.getPurchaseReport();
    return success(res, "Supplier purchase report retrieved successfully.", report);
});

exports.getDueReport = asyncHandler(async (req, res) => {
    const report = await supplierService.getDueReport();
    return success(res, "Supplier due report retrieved successfully.", report);
});

// ==========================================================
// Get by id
// GET /api/suppliers/:id
// ==========================================================

exports.getSupplierById = asyncHandler(async (req, res) => {
    const supplier = await supplierService.getSupplierById(
        req.params.id,
        req.companyId
    );
    return success(res, "Supplier retrieved successfully.", supplier);
});

exports.getSupplierDetails = asyncHandler(async (req, res) => {
    const data = await supplierService.getSupplierDetails(
        req.params.id,
        req.query,
        req.companyId
    );
    return success(res, "Supplier details retrieved successfully.", data);
});

// ==========================================================
// Update
// PUT /api/suppliers/:id
// ==========================================================

exports.updateSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.updateSupplier(
        req.params.id,
        req.body,
        getActorId(req)
    );

    return success(res, "Supplier updated successfully.", supplier);
});

// ==========================================================
// Soft Delete
// DELETE /api/suppliers/:id
// ==========================================================

exports.deleteSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.deleteSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier moved to trash.", supplier);
});

// ==========================================================
// Restore / Permanent Delete / Bulk
// ==========================================================

exports.restoreSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.restoreSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier restored from trash.", supplier);
});

exports.permanentDeleteSupplier = asyncHandler(async (req, res) => {
    const result = await supplierService.permanentDeleteSupplier(
        req.params.id
    );

    return success(res, "Supplier permanently deleted.", result);
});

exports.bulkDeleteSuppliers = asyncHandler(async (req, res) => {
    const result = await supplierService.bulkDeleteSuppliers(
        req.body || {},
        getActorId(req)
    );

    return success(res, "Suppliers moved to trash.", result);
});

exports.bulkRestoreSuppliers = asyncHandler(async (req, res) => {
    const result = await supplierService.bulkRestoreSuppliers(
        req.body || {},
        getActorId(req)
    );

    return success(res, "Suppliers restored from trash.", result);
});

exports.bulkPermanentDeleteSuppliers = asyncHandler(async (req, res) => {
    const result = await supplierService.bulkPermanentDeleteSuppliers(
        req.body || {}
    );

    return success(res, "Trash suppliers permanently deleted.", result);
});

// ==========================================================
// Approve / Status / Rating
// ==========================================================

exports.approveSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.approveSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier approved successfully.", supplier);
});

exports.blockSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.blockSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier blocked successfully.", supplier);
});

exports.activateSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.activateSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier activated successfully.", supplier);
});

exports.deactivateSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.deactivateSupplier(
        req.params.id,
        getActorId(req)
    );

    return success(res, "Supplier deactivated successfully.", supplier);
});

exports.rateSupplier = asyncHandler(async (req, res) => {
    const supplier = await supplierService.rateSupplier(
        req.params.id,
        Number(req.body.score),
        getActorId(req)
    );

    return success(res, "Supplier rated successfully.", supplier);
});
