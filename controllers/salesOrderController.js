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
    const order = await salesOrderService.getSalesOrderById(req.params.id);
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
    return success(res, "Sales order deleted successfully.", null);
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

exports.completeSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.completeSalesOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales order completed successfully.", order);
});

exports.cancelSalesOrder = asyncHandler(async (req, res) => {
    const order = await salesOrderService.cancelSalesOrder(
        req.params.id,
        getActorId(req),
        req.body?.reason || ""
    );
    return success(res, "Sales order cancelled successfully.", order);
});
