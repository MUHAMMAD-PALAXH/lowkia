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
