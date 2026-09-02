const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const shippingRuleService = require("../services/marketplace/shippingRuleService");

const getActorId = (req) => req.user?._id || null;

exports.listShippingRules = asyncHandler(async (req, res) => {
    const result = await shippingRuleService.listShippingRules(
        req.query,
        req.companyId
    );
    return res.status(200).json({
        success: true,
        message: "Shipping rules retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getShippingRule = asyncHandler(async (req, res) => {
    const data = await shippingRuleService.getShippingRuleById(
        req.params.id,
        req.companyId
    );
    return success(res, "Shipping rule retrieved.", data);
});

exports.createShippingRule = asyncHandler(async (req, res) => {
    const data = await shippingRuleService.createShippingRule(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shipping rule created.", data, 201);
});

exports.updateShippingRule = asyncHandler(async (req, res) => {
    const data = await shippingRuleService.updateShippingRule(
        req.params.id,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shipping rule updated.", data);
});

exports.deleteShippingRule = asyncHandler(async (req, res) => {
    const data = await shippingRuleService.deleteShippingRule(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shipping rule deleted.", data);
});
