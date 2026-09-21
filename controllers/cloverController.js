const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const cloverConnectionService = require("../services/cloverConnectionService");

exports.getConnection = asyncHandler(async (req, res) => {
    const doc = await cloverConnectionService.getConnectionPublic(req.user);
    return success(res, "Clover connection retrieved.", doc);
});

exports.upsertConnection = asyncHandler(async (req, res) => {
    const doc = await cloverConnectionService.upsertConnection(
        req.body || {},
        req.user
    );
    return success(res, "Clover connection saved.", doc);
});

exports.addDevice = asyncHandler(async (req, res) => {
    const doc = await cloverConnectionService.addOrUpdateDevice(
        req.body || {},
        req.user
    );
    return success(res, "Clover device saved.", doc);
});

exports.pingDevice = asyncHandler(async (req, res) => {
    const result = await cloverConnectionService.pingDevice(
        req.user,
        req.body?.deviceId || req.query?.deviceId
    );
    return success(res, "Clover device reachable.", result);
});

exports.disconnect = asyncHandler(async (req, res) => {
    const result = await cloverConnectionService.disconnect(req.user);
    return success(res, "Clover disconnected.", result);
});
