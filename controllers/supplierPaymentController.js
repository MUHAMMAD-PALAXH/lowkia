const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const supplierPaymentService = require("../services/supplierPaymentService");
const purchaseOrderService = require("../services/purchaseOrderService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    note: req.body?.note || req.body?.approvalNote || "",
    reason: req.body?.reason || req.body?.reversalReason || "",
    providerTransactionId: req.body?.providerTransactionId,
});

exports.create = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.createSupplierPayment(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Supplier payment created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await supplierPaymentService.listSupplierPayments(
        req.companyId,
        req.query
    );
    return success(res, "Supplier payments retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.getSupplierPaymentById(
        req.params.id,
        req.companyId
    );
    return success(res, "Supplier payment retrieved.", doc);
});

exports.approve = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.approveSupplierPayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Supplier payment approved.", doc);
});

exports.complete = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.completeSupplierPayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Supplier payment completed.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.cancelSupplierPayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Supplier payment cancelled.", doc);
});

exports.reverse = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.reverseSupplierPayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Supplier payment reversed.", doc);
});

exports.receipt = asyncHandler(async (req, res) => {
    const doc = await supplierPaymentService.getSupplierPaymentReceipt(
        req.params.id,
        req.companyId
    );
    return success(res, "Supplier payment receipt.", doc);
});

/**
 * Legacy PO route bridge — keeps Flutter PO dialog working.
 */
exports.recordOnPurchaseOrder = asyncHandler(async (req, res) => {
    const result = await supplierPaymentService.recordViaLegacyPoSchedule(
        req.params.id,
        req.body || {},
        req.user
    );
    const po = await purchaseOrderService.getPurchaseOrderById(req.params.id);
    return success(res, "Supplier payment recorded.", {
        purchaseOrder: po,
        payment: result.payment,
        message: result.message || null,
    });
});
