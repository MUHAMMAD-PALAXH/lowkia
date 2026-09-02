const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const paymentService = require("../services/marketplace/checkoutPaymentService");

exports.initiatePayment = asyncHandler(async (req, res) => {
    const data = await paymentService.initiatePayment(req.user._id, req.body);
    return success(res, "Payment initiated.", data, 201);
});

exports.confirmPayment = asyncHandler(async (req, res) => {
    const data = await paymentService.confirmPayment(req.user._id, req.body, {
        actor: req.user,
        ipAddress: req.ip,
    });
    return success(res, "Payment confirmed.", data);
});

exports.getPayment = asyncHandler(async (req, res) => {
    const data = await paymentService.getPaymentById(
        req.user._id,
        req.params.paymentId
    );
    return success(res, "Payment retrieved.", data);
});

exports.handleWebhook = asyncHandler(async (req, res) => {
    const data = await paymentService.handleProviderWebhook(
        req.params.provider,
        req.body,
        {
            headers: req.headers,
            rawBody: req.rawBody || JSON.stringify(req.body || {}),
            ipAddress: req.ip,
        }
    );
    return success(res, "Webhook processed.", data);
});
