const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const platformMarketplaceService = require("../services/marketplace/platformMarketplaceService");

exports.getDashboard = asyncHandler(async (req, res) => {
    const data = await platformMarketplaceService.getPlatformDashboard();
    return success(res, "Marketplace dashboard retrieved.", data);
});

exports.listOrders = asyncHandler(async (req, res) => {
    const result = await platformMarketplaceService.listPlatformOrders(req.query);
    return res.status(200).json({
        success: true,
        message: "Marketplace orders retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getOrder = asyncHandler(async (req, res) => {
    const data = await platformMarketplaceService.getPlatformOrder(
        req.params.masterOrderId
    );
    return success(res, "Marketplace order retrieved.", data);
});

exports.listPayments = asyncHandler(async (req, res) => {
    const result = await platformMarketplaceService.listPlatformPayments(req.query);
    return res.status(200).json({
        success: true,
        message: "Marketplace payments retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getPayment = asyncHandler(async (req, res) => {
    const data = await platformMarketplaceService.getPlatformPayment(
        req.params.paymentId
    );
    return success(res, "Marketplace payment retrieved.", data);
});

exports.listRefunds = asyncHandler(async (req, res) => {
    const result = await platformMarketplaceService.listPlatformRefunds(req.query);
    return res.status(200).json({
        success: true,
        message: "Marketplace refunds retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});
