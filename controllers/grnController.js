const asyncHandler = require("express-async-handler");
const grnService = require("../services/grnService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.actorId || null;

const getActor = (req) => ({
    id: getActorId(req),
    name: req.body?.actorName || req.user?.name || "Owner",
    type: req.body?.actorType || req.body?.uploadedByType || "Owner"
});

exports.listReceivablePurchaseOrders = asyncHandler(async (req, res) => {
    const data = await grnService.listReceivablePurchaseOrders(req.query);
    return success(res, "Receivable purchase orders retrieved.", data);
});

exports.getGrnStats = asyncHandler(async (req, res) => {
    const stats = await grnService.getGrnStats();
    return success(res, "GRN stats retrieved.", stats);
});

exports.getGrns = asyncHandler(async (req, res) => {
    const result = await grnService.getGrns(req.query);
    return success(res, "GRNs retrieved successfully.", result);
});

exports.getGrnById = asyncHandler(async (req, res) => {
    const grn = await grnService.getGrnById(req.params.id, req.query);
    return success(res, "GRN retrieved successfully.", grn);
});

exports.getGrnDeleteCheck = asyncHandler(async (req, res) => {
    const data = await grnService.getGrnDeleteCheck(req.params.id);
    return success(res, "GRN delete check retrieved.", data);
});

exports.createGrnFromPurchaseOrder = asyncHandler(async (req, res) => {
    const body = {
        ...req.body,
        actorType: getActor(req).type
    };
    const grn = await grnService.createGrnFromPurchaseOrder(
        body,
        getActorId(req)
    );
    return success(res, "GRN created from purchase order.", grn, 201);
});

exports.updateGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.updateGrn(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "GRN updated successfully.", grn);
});

exports.scanImei = asyncHandler(async (req, res) => {
    const grn = await grnService.scanImei(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "IMEI scanned.", grn);
});

exports.bulkAddImeis = asyncHandler(async (req, res) => {
    const grn = await grnService.bulkAddImeis(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "IMEIs added.", grn);
});

exports.removeImei = asyncHandler(async (req, res) => {
    const grn = await grnService.removeImei(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "IMEI removed.", grn);
});

exports.submitGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.submitGrn(req.params.id, getActorId(req), {
        actorType: getActor(req).type
    });
    return success(res, "GRN submitted.", grn);
});

exports.approveGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.approveGrn(req.params.id, getActor(req));
    return success(res, "GRN approved and stock updated.", grn);
});

exports.rejectGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.rejectGrn(
        req.params.id,
        req.body?.reason || req.body?.rejectionReason || "",
        getActor(req)
    );
    return success(res, "GRN rejected.", grn);
});

exports.completeGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.completeGrn(req.params.id, getActorId(req), {
        actorType: getActor(req).type
    });
    return success(res, "GRN completed. Stock updated.", grn);
});

exports.cancelGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.cancelGrn(
        req.params.id,
        getActorId(req),
        req.body?.reason || ""
    );
    return success(res, "GRN cancelled.", grn);
});

exports.deleteGrn = asyncHandler(async (req, res) => {
    const result = await grnService.deleteGrn(req.params.id, getActorId(req));
    return success(res, "GRN moved to trash.", result);
});

exports.restoreGrn = asyncHandler(async (req, res) => {
    const grn = await grnService.restoreGrn(req.params.id, getActorId(req));
    return success(res, "GRN restored from trash.", grn);
});

exports.permanentDeleteGrn = asyncHandler(async (req, res) => {
    const result = await grnService.permanentDeleteGrn(req.params.id);
    return success(res, "GRN permanently deleted.", result);
});

exports.bulkDeleteGrns = asyncHandler(async (req, res) => {
    const result = await grnService.bulkDeleteGrns(
        req.body || {},
        getActorId(req)
    );
    return success(res, "GRNs moved to trash.", result);
});

exports.bulkRestoreGrns = asyncHandler(async (req, res) => {
    const result = await grnService.bulkRestoreGrns(
        req.body || {},
        getActorId(req)
    );
    return success(res, "GRNs restored from trash.", result);
});

exports.bulkPermanentDeleteGrns = asyncHandler(async (req, res) => {
    const result = await grnService.bulkPermanentDeleteGrns(req.body || {});
    return success(res, "Trash GRNs permanently deleted.", result);
});
