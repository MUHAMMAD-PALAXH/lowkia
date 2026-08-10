const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const supplierPayableService = require("../services/supplierPayableService");

const getActorId = (req) => req.user?._id || null;

exports.listPayables = asyncHandler(async (req, res) => {
    const result = await supplierPayableService.listPayables(
        req.companyId,
        req.query
    );
    return success(res, "Supplier payables retrieved.", result);
});

exports.getPayableById = asyncHandler(async (req, res) => {
    const doc = await supplierPayableService.getPayableById(
        req.params.id,
        req.companyId
    );
    return success(res, "Supplier payable retrieved.", doc);
});

exports.getByPurchaseOrder = asyncHandler(async (req, res) => {
    let doc = await supplierPayableService.getPayableByPurchaseOrder(
        req.params.purchaseOrderId,
        req.companyId
    );
    if (!doc) {
        doc = await supplierPayableService.syncFromPurchaseOrder(
            req.params.purchaseOrderId,
            { actorId: getActorId(req), companyId: req.companyId }
        );
    }
    return success(res, "Supplier payable retrieved.", doc);
});

exports.syncFromPurchaseOrder = asyncHandler(async (req, res) => {
    const doc = await supplierPayableService.syncFromPurchaseOrder(
        req.params.purchaseOrderId,
        { actorId: getActorId(req), companyId: req.companyId }
    );
    return success(res, "Supplier payable synced.", doc);
});

exports.getSupplierOutstanding = asyncHandler(async (req, res) => {
    const doc = await supplierPayableService.getSupplierOutstanding(
        req.params.supplierId,
        req.companyId
    );
    return success(res, "Supplier outstanding retrieved.", doc);
});

exports.listBySupplier = asyncHandler(async (req, res) => {
    const result = await supplierPayableService.listPayables(req.companyId, {
        ...req.query,
        supplierId: req.params.supplierId,
    });
    return success(res, "Supplier payables retrieved.", result);
});
