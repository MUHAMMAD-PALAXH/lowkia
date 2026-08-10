const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const customerPaymentService = require("../services/customerPaymentService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    reason: req.body?.reason || "",
    note: req.body?.note || "",
});

exports.providerInfo = asyncHandler(async (_req, res) => {
    return success(
        res,
        "Customer payment provider info.",
        customerPaymentService.getProviderInfo()
    );
});

exports.createCheckout = asyncHandler(async (req, res) => {
    const doc = await customerPaymentService.createCheckout(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Customer checkout created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await customerPaymentService.listCustomerPayments(
        req.companyId,
        req.query
    );
    return success(res, "Customer payments retrieved.", result);
});

exports.getStatus = asyncHandler(async (req, res) => {
    const doc = await customerPaymentService.getCheckoutStatus(
        req.params.id,
        req.companyId
    );
    return success(res, "Customer checkout status.", doc);
});

exports.complete = asyncHandler(async (req, res) => {
    const doc = await customerPaymentService.completeCheckout(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Customer payment completed.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await customerPaymentService.cancelCheckout(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Customer checkout cancelled.", doc);
});
