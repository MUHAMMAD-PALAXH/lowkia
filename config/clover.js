/**
 * Clover REST Pay Display / OAuth env (US).
 * All endpoints overridable for sandbox vs production.
 */
const getCloverEnv = () =>
    String(process.env.CLOVER_ENV || "sandbox").trim().toLowerCase() ===
    "production"
        ? "production"
        : "sandbox";

const getCloverConnectBaseUrl = () => {
    if (process.env.CLOVER_CONNECT_BASE_URL) {
        return String(process.env.CLOVER_CONNECT_BASE_URL).replace(/\/$/, "");
    }
    // Official Connect REST Pay Display bases (NA).
    return getCloverEnv() === "production"
        ? "https://www.clover.com/connect/v1"
        : "https://apisandbox.dev.clover.com/connect/v1";
};

const getCloverOAuthBaseUrl = () => {
    if (process.env.CLOVER_OAUTH_BASE_URL) {
        return String(process.env.CLOVER_OAUTH_BASE_URL).replace(/\/$/, "");
    }
    return getCloverEnv() === "production"
        ? "https://www.clover.com"
        : "https://apisandbox.dev.clover.com";
};

const getCloverAppId = () =>
    process.env.CLOVER_APP_ID || process.env.CLOVER_CLIENT_ID || "";

const getCloverAppSecret = () =>
    process.env.CLOVER_APP_SECRET || process.env.CLOVER_CLIENT_SECRET || "";

/** Remote App ID (RAID) — required for semi-integrations. */
const getCloverRaid = () =>
    process.env.CLOVER_RAID || process.env.CLOVER_REMOTE_APP_ID || "";

const getCloverTokenSecret = () =>
    process.env.CLOVER_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    "lowkia-clover-dev-secret";

const getDefaultPosId = () =>
    process.env.CLOVER_POS_ID || "LOWKIA-ADMIN";

const isCloverConfigured = () =>
    Boolean(getCloverAppId() || process.env.CLOVER_ALLOW_MANUAL_TOKENS === "1");

module.exports = {
    getCloverEnv,
    getCloverConnectBaseUrl,
    getCloverOAuthBaseUrl,
    getCloverAppId,
    getCloverAppSecret,
    getCloverRaid,
    getCloverTokenSecret,
    getDefaultPosId,
    isCloverConfigured,
};
