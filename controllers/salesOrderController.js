const asyncHandler = require("express-async-handler");
const salesOrderService = require("../services/salesOrderService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id ||
    req.body?.createdBy ||
    req.body?.actorId ||
    req.body?.updatedBy ||
    null;

exports.createSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.createSalesOrder(
        req.body,
        getActorId(req)
    );
    return success(res, "Sales order created successfully.", order, 201);
});

exports.getSalesOrders = asyncHandler(async (req, res) => {
    const result = await salesOrderService.getSalesOrders(req.query);
    return success(res, "Sales orders retrieved successfully.", result);
});

exports.getSalesOrderStats = asyncHandler(async (req, res) => {
    const stats = await salesOrderService.getSalesOrderStats();
    return success(res, "Sales order stats retrieved successfully.", stats);
});

exports.getSalesOrderById = asyncHandler(async (req, res) => {
    const includeDeleted =
        req.query.deleted === "true" || req.query.trash === "true";
    const order = await salesOrderService.getSalesOrderById(req.params.id, {
        includeDeleted
    });
    return success(res, "Sales order retrieved successfully.", order);
});

exports.updateSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.updateSalesOrder(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Sales order updated successfully.", order);
});

exports.deleteSalesOrder = asyncHandler(async (req, res) => {
    await salesOrderService.deleteSalesOrder(req.params.id, getActorId(req));
    return success(res, "Sales order moved to trash.", null);
});

exports.restoreSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.restoreSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order restored from trash.", order);
});

exports.permanentDeleteSalesOrder = asyncHandler(async (req, res) => {
    const result = await salesOrderService.permanentDeleteSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order permanently deleted.", result);
});

exports.bulkDeleteSalesOrders = asyncHandler(async (req, res) => {
    const result = await salesOrderService.bulkDeleteSalesOrders(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Sales orders moved to trash.", result);
});

exports.bulkRestoreSalesOrders = asyncHandler(async (req, res) => {
    const result = await salesOrderService.bulkRestoreSalesOrders(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Sales orders restored from trash.", result);
});

exports.bulkPermanentDeleteSalesOrders = asyncHandler(async (req, res) => {
    const result = await salesOrderService.bulkPermanentDeleteSalesOrders(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Trash items permanently deleted.", result);
});

exports.submitSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.submitSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order submitted successfully.", order);
});

exports.approveSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.approveSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order approved successfully.", order);
});

exports.confirmSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.confirmSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(
        res,
        "Sales order confirmed. Stock deducted from inventory.",
        order
    );
});

exports.completeSale = asyncHandler(async (req, res) => {
    const order = await salesOrderService.completeSale(
        req.params.id,
        req.body || {},
        getActorId(req)
    );
    return success(
        res,
        "Sale completed. Stock / IMEI updated when paid or delivered.",
        order
    );
});

exports.markPaid = asyncHandler(async (req, res) => {
    const order = await salesOrderService.markPaid(
        req.params.id,
        req.body || {},
        getActorId(req)
    );
    return success(res, "Payment recorded.", order);
});

exports.deliverSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.deliverSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Order delivered. Stock updated if needed.", order);
});

exports.completeSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.completeSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order completed successfully.", order);
});

exports.lookupByBarcode = asyncHandler(async (req, res) => {
    const data = await salesOrderService.lookupByBarcode(
        req.params.code,
        req.query.warehouseId
    );
    return success(res, "Product found for barcode.", data);
});

exports.lookupByImei = asyncHandler(async (req, res) => {
    const data = await salesOrderService.lookupByImei(
        req.params.imei,
        req.query.warehouseId
    );
    return success(res, "IMEI found.", data);
});

exports.getBranchCatalog = asyncHandler(async (req, res) => {
    const data = await salesOrderService.getBranchCatalog(req.query);
    return success(res, "Branch catalog retrieved.", data);
});

exports.cancelSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.cancelSalesOrder(
        req.params.id,
        getActorId(req),
        req.body?.reason || ""
    );
    return success(res, "Sales order cancelled successfully.", order);
});
