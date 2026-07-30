const asyncHandler = require("express-async-handler");
const salesReturnService = require("../services/salesReturnService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.actorId || null;

exports.createReturn = asyncHandler(async (req, res) => {
    const doc = await salesReturnService.createFromSalesOrder(
        req.body,
        getActorId(req)
    );
    return success(res, "Sales return created.", doc, 201);
});

exports.getReturns = asyncHandler(async (req, res) => {
    const result = await salesReturnService.getReturns(req.query);
    return success(res, "Sales returns retrieved.", result);
});

exports.getReturnById = asyncHandler(async (req, res) => {
    const doc = await salesReturnService.getReturnById(req.params.id);
    return success(res, "Sales return retrieved.", doc);
});

exports.receiveReturn = asyncHandler(async (req, res) => {
    const doc = await salesReturnService.receiveReturn(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Return received. Stock restored.", doc);
});

exports.getReturnableFromOrder = asyncHandler(async (req, res) => {
    const data = await salesReturnService.getReturnableFromOrder(
        req.params.salesOrderId
    );
    return success(res, "Returnable lines retrieved.", data);
});

exports.getReturnStats = asyncHandler(async (req, res) => {
    const stats = await salesReturnService.getReturnStats();
    return success(res, "Sales return stats retrieved.", stats);
});

exports.deleteSalesReturn = asyncHandler(async (req, res) => {
    const result = await salesReturnService.deleteSalesReturn(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales return moved to trash.", result);
});

exports.restoreSalesReturn = asyncHandler(async (req, res) => {
    const doc = await salesReturnService.restoreSalesReturn(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Sales return restored from trash.", doc);
});

exports.permanentDeleteSalesReturn = asyncHandler(async (req, res) => {
    const result = await salesReturnService.permanentDeleteSalesReturn(
        req.params.id
    );
    return success(res, "Sales return permanently deleted.", result);
});

exports.bulkDeleteSalesReturns = asyncHandler(async (req, res) => {
    const result = await salesReturnService.bulkDeleteSalesReturns(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Sales returns moved to trash.", result);
});

exports.bulkRestoreSalesReturns = asyncHandler(async (req, res) => {
    const result = await salesReturnService.bulkRestoreSalesReturns(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Sales returns restored from trash.", result);
});

exports.bulkPermanentDeleteSalesReturns = asyncHandler(async (req, res) => {
    const result = await salesReturnService.bulkPermanentDeleteSalesReturns(
        req.body || {}
    );
    return success(res, "Trash sales returns permanently deleted.", result);
});
