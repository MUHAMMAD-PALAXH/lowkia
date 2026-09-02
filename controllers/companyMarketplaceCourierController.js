const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const courierService = require("../services/marketplace/courierService");

const getActorId = (req) => req.user?._id || null;

exports.listCouriers = asyncHandler(async (req, res) => {
    const result = await courierService.listCouriers(req.companyId, req.query);
    return res.status(200).json({
        success: true,
        message: "Couriers retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getCourier = asyncHandler(async (req, res) => {
    const data = await courierService.getCourierById(
        req.params.courierId,
        req.companyId
    );
    return success(res, "Courier retrieved.", data);
});

exports.createCourier = asyncHandler(async (req, res) => {
    const data = await courierService.createCourier(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Courier created.", data, 201);
});

exports.updateCourier = asyncHandler(async (req, res) => {
    const data = await courierService.updateCourier(
        req.params.courierId,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Courier updated.", data);
});

exports.deleteCourier = asyncHandler(async (req, res) => {
    const data = await courierService.deleteCourier(
        req.params.courierId,
        getActorId(req),
        req.companyId
    );
    return success(res, "Courier deleted.", data);
});
