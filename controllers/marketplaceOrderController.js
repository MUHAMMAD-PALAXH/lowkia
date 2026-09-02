const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const orderService = require("../services/marketplace/marketplaceOrderService");

exports.listOrders = asyncHandler(async (req, res) => {
    const result = await orderService.listMasterOrders(req.user._id, req.query);
    return res.status(200).json({
        success: true,
        message: "Orders retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getOrder = asyncHandler(async (req, res) => {
    const data = await orderService.getMasterOrder(
        req.user._id,
        req.params.masterOrderId
    );
    return success(res, "Order retrieved.", data);
});

exports.getCompanyOrder = asyncHandler(async (req, res) => {
    const data = await orderService.getCompanyOrder(
        req.user._id,
        req.params.masterOrderId,
        req.params.companyOrderId
    );
    return success(res, "Company order retrieved.", data);
});
