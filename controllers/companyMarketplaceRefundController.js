const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const refundService = require("../services/marketplace/refundService");

const getActorId = (req) => req.user?._id || null;

exports.createRefund = asyncHandler(async (req, res) => {
    const data = await refundService.createCompanyRefund(
        req.params.companyOrderId,
        req.body,
        req.companyId,
        getActorId(req)
    );
    return success(res, "Refund created.", data, 201);
});

exports.listRefunds = asyncHandler(async (req, res) => {
    const result = await refundService.listCompanyRefunds(
        req.params.companyOrderId,
        req.companyId,
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

exports.listAllRefunds = asyncHandler(async (req, res) => {
    const result = await refundService.listAllRefundsForCompany(
        req.companyId,
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
    const data = await refundService.getRefundByIdForCompany(
        req.params.refundId,
        req.companyId
    );
    return success(res, "Refund retrieved.", data);
});

exports.completeRefund = asyncHandler(async (req, res) => {
    const data = await refundService.completeRefund(
        req.params.refundId,
        req.body,
        req.companyId,
        getActorId(req)
    );
    return success(res, "Refund completed.", data);
});

exports.cancelRefund = asyncHandler(async (req, res) => {
    const data = await refundService.cancelRefund(
        req.params.refundId,
        req.companyId
    );
    return success(res, "Refund cancelled.", data);
});
