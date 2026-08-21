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
        actorType: getActor(req).type,
        companyId: req.companyId || null,
    };
    const po = await purchaseOrderService.createPurchaseOrder(
        body,
        getActorId(req)
    );
    return success(res, "Purchase order created successfully.", po, 201);
});

exports.getPurchaseOrders = asyncHandler(async (req, res) => {
    const query = { ...req.query, companyId: req.companyId };
    if (req.linkedSupplier) {
        query.supplierId = String(req.linkedSupplier._id);
    }
    const result = await purchaseOrderService.getPurchaseOrders(query);
    return success(res, "Purchase orders retrieved successfully.", result);
});

exports.getPurchaseOrderStats = asyncHandler(async (req, res) => {
    const query = { ...req.query, companyId: req.companyId };
    if (req.linkedSupplier) {
        query.supplierId = String(req.linkedSupplier._id);
    }
    const stats = await purchaseOrderService.getPurchaseOrderStats(query);
    return success(res, "Purchase order stats retrieved successfully.", stats);
});

exports.getPurchaseOrderById = asyncHandler(async (req, res) => {
    const includeDeleted =
        req.query.deleted === "true" || req.query.trash === "true";
    const po = await purchaseOrderService.getPurchaseOrderById(
        req.params.id,
        {
            includeDeleted
        },
        req.companyId
    );
    return success(res, "Purchase order retrieved successfully.", po);
});

exports.getProductPurchaseContext = asyncHandler(async (req, res) => {
    const data = await purchaseOrderService.getProductPurchaseContext(
        req.params.productId,
        req.companyId
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
        getActorId(req),
        req.body || {}
    );
    return success(res, "Purchase order moved to trash.", result);
});

exports.prepareAndTrashPurchaseOrder = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.prepareAndTrashPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(
        res,
        "Purchase order cancelled, supplier notified, and moved to trash.",
        result
    );
});

exports.restorePurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.restorePurchaseOrder(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Purchase order restored from trash.", po);
});

exports.permanentDeletePurchaseOrder = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.permanentDeletePurchaseOrder(
        req.params.id
    );
    return success(res, "Purchase order permanently deleted.", result);
});

exports.bulkDeletePurchaseOrders = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.bulkDeletePurchaseOrders(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Purchase orders moved to trash.", result);
});

exports.bulkRestorePurchaseOrders = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.bulkRestorePurchaseOrders(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Purchase orders restored from trash.", result);
});

exports.bulkPermanentDeletePurchaseOrders = asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.bulkPermanentDeletePurchaseOrders(
        req.body || {}
    );
    return success(res, "Trash purchase orders permanently deleted.", result);
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
        getActorId(req),
        req.body || {}
    );
    const hasSupplier = !!po.supplierId;
    return success(
        res,
        hasSupplier
            ? "Purchase order sent to supplier — awaiting acceptance."
            : "Purchase order marked as Ordered.",
        po
    );
});

exports.supplierAcceptPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.supplierAcceptPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Purchase order accepted by supplier.", po);
});

exports.supplierRejectPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.supplierRejectPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Purchase order rejected by supplier and cancelled.", po);
});

exports.supplierSendPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.supplierSendPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Supplier shipment recorded successfully.", po);
});

exports.returnDamagedToSupplier = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.returnDamagedToSupplier(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Damaged goods return to supplier recorded.", po);
});

exports.supplierAcknowledgeDamaged = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.supplierAcknowledgeDamaged(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Supplier received damaged return.", po);
});

exports.addAdditionalPhase = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.addAdditionalPhase(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Additional phase added.", po);
});

exports.buyerAcceptDemand = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.buyerAcceptDemand(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "Supplier demand accepted — purchase order is Agreed.", po);
});

exports.buyerRejectDemand = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.buyerRejectDemand(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(
        res,
        "Supplier demand rejected — revise the purchase order and send a new demand.",
        po
    );
});

exports.sendNewDemand = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.sendNewDemand(
        req.params.id,
        getActorId(req),
        req.body || {}
    );
    return success(res, "New demand sent to supplier.", po);
});

exports.cancelPurchaseOrder = asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.cancelPurchaseOrder(
        req.params.id,
        getActorId(req),
        req.body?.reason || ""
    );
    return success(res, "Purchase order cancelled.", po);
});

exports.recordSupplierPayment = asyncHandler(async (req, res) => {
    // Phase 3 finance path (Payment + Payable + optional schedule sync)
    const supplierPaymentController = require("./supplierPaymentController");
    return supplierPaymentController.recordOnPurchaseOrder(req, res);
});

exports.getPurchaseOrderDeleteCheck = asyncHandler(async (req, res) => {
    const data = await purchaseOrderService.getPurchaseOrderDeleteCheck(
        req.params.id
    );
    return success(res, "Purchase order delete check retrieved.", data);
});
