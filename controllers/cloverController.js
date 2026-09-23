const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const cloverConnectionService = require("../services/cloverConnectionService");
const cloverOAuthService = require("../services/cloverOAuthService");

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

/** Owner starts Clover OAuth — returns authorizeUrl to open in browser. */
exports.startOAuth = asyncHandler(async (req, res) => {
    const doc = await cloverOAuthService.buildAuthorizeUrl(req.user);
    return success(res, "Clover OAuth URL ready.", doc);
});

/**
 * Clover browser redirect target (no auth middleware).
 * Exchanges code → tokens and shows a simple success page.
 */
exports.oauthCallback = asyncHandler(async (req, res) => {
    try {
        const result = await cloverOAuthService.handleOAuthCallback(
            req.query || {}
        );
        const merchant = String(result.merchantId || "—").replace(
            /[<>&"]/g,
            ""
        );
        const env = String(result.environment || "").replace(/[<>&"]/g, "");
        res.status(200).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Clover connected</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1419;color:#e8eef5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1a2330;border:1px solid #2b3a4d;border-radius:16px;padding:28px 32px;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#9fb0c3;line-height:1.5;margin:0 0 12px}
code{background:#0f1419;padding:2px 6px;border-radius:6px;font-size:12px}
</style></head><body><div class="card">
<h1>Clover connected</h1>
<p>Merchant <code>${merchant}</code> is linked to Lowkia (${env}).</p>
<p>Close this tab and return to Admin → Finance → Clover Flex to add your Flex serial and Ping.</p>
</div></body></html>`);
    } catch (err) {
        const message = String(err.message || "OAuth failed").replace(
            /[<>&]/g,
            ""
        );
        res.status(err.statusCode || 400).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Clover connect failed</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1419;color:#e8eef5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1a2330;border:1px solid #5c2a2a;border-radius:16px;padding:28px 32px;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 8px;color:#ff8f8f}p{color:#9fb0c3;line-height:1.5}
</style></head><body><div class="card">
<h1>Connect failed</h1>
<p>${message}</p>
<p>Close this tab and try Connect with Clover again from Lowkia Admin.</p>
</div></body></html>`);
    }
});
