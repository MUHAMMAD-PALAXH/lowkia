/**
 * Clover REST Pay Display / OAuth env (US).
 * Default = production (real merchant / live cards).
 * Set CLOVER_ENV=sandbox only for test merchants.
 * All endpoints overridable for sandbox vs production.
 */
const getCloverEnv = () =>
    String(process.env.CLOVER_ENV || "production").trim().toLowerCase() ===
    "sandbox"
        ? "sandbox"
        : "production";

/** Prefer explicit request/connection value; else CLOVER_ENV. */
const resolveCloverEnvironment = (value) => {
    const v = String(value || "").trim().toLowerCase();
    if (v === "production" || v === "sandbox") return v;
    return getCloverEnv();
};

const getCloverConnectBaseUrl = () => {
    if (process.env.CLOVER_CONNECT_BASE_URL) {
        return String(process.env.CLOVER_CONNECT_BASE_URL).replace(/\/$/, "");
    }
    // Official Connect REST Pay Display bases (NA).
    return getCloverEnv() === "production"
        ? "https://www.clover.com/connect/v1"
        : "https://apisandbox.dev.clover.com/connect/v1";
};

/** Host used for /oauth/v2/authorize (browser redirect). */
const getCloverAuthorizeBaseUrl = () => {
    if (process.env.CLOVER_AUTHORIZE_BASE_URL) {
        return String(process.env.CLOVER_AUTHORIZE_BASE_URL).replace(/\/$/, "");
    }
    return getCloverEnv() === "production"
        ? "https://www.clover.com"
        : "https://sandbox.dev.clover.com";
};

/** Host used for /oauth/v2/token and /oauth/v2/refresh (API). */
const getCloverOAuthApiBaseUrl = () => {
    if (process.env.CLOVER_OAUTH_BASE_URL) {
        return String(process.env.CLOVER_OAUTH_BASE_URL).replace(/\/$/, "");
    }
    return getCloverEnv() === "production"
        ? "https://api.clover.com"
        : "https://apisandbox.dev.clover.com";
};

/** @deprecated use getCloverOAuthApiBaseUrl — kept for older imports */
const getCloverOAuthBaseUrl = () => getCloverOAuthApiBaseUrl();

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

/** Public API origin used as OAuth redirect (must match Clover Site URL). */
const getPublicApiBaseUrl = () => {
    const raw =
        process.env.CLOVER_REDIRECT_BASE_URL ||
        process.env.PUBLIC_API_URL ||
        process.env.API_PUBLIC_URL ||
        "https://lowkia.onrender.com";
    return String(raw).replace(/\/$/, "");
};

const getCloverOAuthRedirectUri = () => {
    if (process.env.CLOVER_REDIRECT_URI) {
        return String(process.env.CLOVER_REDIRECT_URI).trim();
    }
    return `${getPublicApiBaseUrl()}/api/clover/oauth/callback`;
};

const isCloverConfigured = () =>
    Boolean(getCloverAppId() || process.env.CLOVER_ALLOW_MANUAL_TOKENS === "1");

const isCloverOAuthReady = () =>
    Boolean(getCloverAppId() && getCloverAppSecret());

module.exports = {
    getCloverEnv,
    resolveCloverEnvironment,
    getCloverConnectBaseUrl,
    getCloverAuthorizeBaseUrl,
    getCloverOAuthApiBaseUrl,
    getCloverOAuthBaseUrl,
    getCloverAppId,
    getCloverAppSecret,
    getCloverRaid,
    getCloverTokenSecret,
    getDefaultPosId,
    getPublicApiBaseUrl,
    getCloverOAuthRedirectUri,
    isCloverConfigured,
    isCloverOAuthReady,
};
