const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const shippingRuleService = require("../services/marketplace/shippingRuleService");

exports.previewShipping = asyncHandler(async (req, res) => {
    const address = {
        city: req.query.city || req.body?.city || "",
        district: req.query.district || req.body?.district || "",
    };

    const data = await shippingRuleService.previewCartShipping(
        req.user._id,
        address
    );
    return success(res, "Shipping preview calculated.", data);
});
