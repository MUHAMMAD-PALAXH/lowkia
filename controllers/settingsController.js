const asyncHandler = require("express-async-handler");
const settingsService = require("../services/settingsService");
const { success } = require("../utils/apiResponse");

exports.getSettings = asyncHandler(async (req, res) => {
    const settings = await settingsService.getGlobalSettings(req.companyId);
    return success(res, "Settings retrieved.", settings);
});

exports.updateSettings = asyncHandler(async (req, res) => {
    const settings = await settingsService.updateGlobalSettings(
        req.body,
        req.companyId
    );
    return success(res, "Settings updated.", settings);
});

exports.getTimezone = asyncHandler(async (req, res) => {
    const timezone = await settingsService.getTimezone(req.companyId);
    return success(res, "Timezone retrieved.", { timezone });
});
