const asyncHandler = require("express-async-handler");
const purchaseOrderService = require("../services/purchaseOrderService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.actorId || null;

const getActor = (req) => ({
    id: getActorId(req),
    name: req.body?.actorName || req.user?.name || "Owner",
    type: req.body?.actorType || req.body?.uploadedByType || "Owner"
});

exports.createPurchaseOrder = asyncHandler(async (req, res) => {
    const body = {
        ...req.body,
        actorType: getActor(req).type
    };
    const po = await purchaseOrderService.createPurchaseOrder(
        body,
        getActorId(req)
    );
    return success(res, "Purchase order created successfully.", po, 201);
});

exports.getPurchaseOrders = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.getPurchaseOrders(req.query);
    return success(res, "Purchase orders retrieved successfully.", result);
});

exports.getPurchaseOrderStats = asyncHandler(async (req, res) => {
    const stats = await purchaseOrderService.getPurchaseOrderStats();
    return success(res, "Purchase order stats retrieved successfully.", stats);
});

exports.getPurchaseOrderById = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.getPurchaseOrderById(req.params.id);
    return success(res, "Purchase order retrieved successfully.", po);
});

exports.getProductPurchaseContext = asyncHandler(async (req, res) => {
    const data = await purchaseOrderService.getProductPurchaseContext(
        req.params.productId
    );
    return success(res, "Product purchase context retrieved.", data);
});

exports.updatePurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.updatePurchaseOrder(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Purchase order updated successfully.", po);
});

exports.deletePurchaseOrder = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.deletePurchaseOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Purchase order deleted successfully.", result);
});

exports.submitPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.submitPurchaseOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Purchase order submitted.", po);
});

exports.approvePurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.approvePurchaseOrder(
        req.params.id,
        getActor(req)
    );
    return success(res, "Purchase order approved.", po);
});

exports.rejectPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.rejectPurchaseOrder(
        req.params.id,
        req.body?.reason || req.body?.rejectionReason || "",
        getActor(req)
    );
    return success(res, "Purchase order rejected.", po);
});

exports.markOrdered = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.markOrdered(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Purchase order marked as Ordered (sent to supplier).", po);
});

exports.cancelPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.cancelPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body?.reason || ""
    );
    return success(res, "Purchase order cancelled.", po);
});
