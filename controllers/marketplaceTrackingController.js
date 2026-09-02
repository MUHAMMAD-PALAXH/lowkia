const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const trackingService = require("../services/marketplace/trackingService");

exports.getShipmentTracking = asyncHandler(async (req, res) => {
    const data = await trackingService.getCustomerShipmentTracking(
        req.user._id,
        req.params.shipmentId
    );
    return success(res, "Shipment tracking retrieved.", data);
});
