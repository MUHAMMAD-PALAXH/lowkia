const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const refundService = require("../services/marketplace/refundService");

exports.listOrderRefunds = asyncHandler(async (req, res) => {
    const result = await refundService.listMasterOrderRefundsForUser(
        req.user._id,
        req.params.masterOrderId,
        req.query
    );
    return res.status(200).json({
        success: true,
        message: "Refunds retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getRefund = asyncHandler(async (req, res) => {
    const data = await refundService.getRefundForUser(
        req.user._id,
        req.params.refundId
    );
    return success(res, "Refund retrieved.", data);
});
