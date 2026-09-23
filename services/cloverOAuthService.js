/**
 * Clover v2 OAuth (high-trust) — authorize → callback → store encrypted tokens.
 */
const AppError = require("../utils/appError");
const { ensureUserCompany } = require("./companyService");
const {
    getCloverEnv,
    getCloverAuthorizeBaseUrl,
    getCloverOAuthApiBaseUrl,
    getCloverAppId,
    getCloverAppSecret,
    getCloverOAuthRedirectUri,
    getCloverRaid,
    getDefaultPosId,
    isCloverOAuthReady,
} = require("../config/clover");
const {
    encryptSecret,
    signOAuthState,
    verifyOAuthState,
} = require("../utils/secretCrypto");
const CloverConnection = require("../model/cloverConnection");

const NOT_DELETED = { isDeleted: { $ne: true } };

const buildAuthorizeUrl = async (user) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    if (!isCloverOAuthReady()) {
        throw new AppError(
            "Clover OAuth is not configured. Set CLOVER_APP_ID and CLOVER_APP_SECRET on the API.",
            503
        );
    }
    const companyId = await ensureUserCompany(user);
    const clientId = getCloverAppId();
    const redirectUri = getCloverOAuthRedirectUri();
    const state = signOAuthState({
        companyId: String(companyId),
        userId: String(user._id),
        env: getCloverEnv(),
    });

    const url = new URL(
        `${getCloverAuthorizeBaseUrl()}/oauth/v2/authorize`
    );
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    return {
        authorizeUrl: url.toString(),
        redirectUri,
        environment: getCloverEnv(),
        appId: clientId,
        expiresInSec: 600,
    };
};

const exchangeCodeForTokens = async (code) => {
    const clientId = getCloverAppId();
    const clientSecret = getCloverAppSecret();
    if (!clientId || !clientSecret) {
        throw new AppError("Clover app credentials missing on server.", 503);
    }
    const res = await fetch(`${getCloverOAuthApiBaseUrl()}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code: String(code),
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        const msg =
            data.message ||
            data.error_description ||
            data.error ||
            `Clover token exchange failed (${res.status})`;
        throw new AppError(msg, 400);
    }
    return data;
};

/**
 * Browser callback from Clover — no JWT. Company comes from signed state.
 */
const handleOAuthCallback = async (query = {}) => {
    const code = String(query.code || "").trim();
    const merchantId = String(query.merchant_id || query.merchantId || "").trim();
    const stateRaw = String(query.state || "").trim();
    if (!code) throw new AppError("Missing OAuth authorization code.", 400);
    if (!stateRaw) throw new AppError("Missing OAuth state.", 400);

    let state;
    try {
        state = verifyOAuthState(stateRaw);
    } catch (err) {
        throw new AppError(err.message || "Invalid OAuth state.", 400);
    }

    const tokens = await exchangeCodeForTokens(code);
    const companyId = state.companyId;
    if (!companyId) throw new AppError("OAuth state missing company.", 400);

    let conn = await CloverConnection.findOne({ companyId, ...NOT_DELETED });
    if (!conn) {
        conn = new CloverConnection({
            companyId,
            createdBy: state.userId || null,
        });
    }

    conn.environment =
        state.env === "production" ? "production" : getCloverEnv();
    if (merchantId) conn.merchantId = merchantId;
    conn.accessTokenEnc = encryptSecret(tokens.access_token);
    if (tokens.refresh_token) {
        conn.refreshTokenEnc = encryptSecret(tokens.refresh_token);
    }
    if (tokens.access_token_expiration) {
        const expSec = Number(tokens.access_token_expiration);
        if (Number.isFinite(expSec) && expSec > 0) {
            conn.tokenExpiresAt = new Date(expSec * 1000);
        }
    }
    conn.posId = conn.posId || getDefaultPosId();
    conn.raid = conn.raid || getCloverRaid() || "";
    conn.isActive = true;
    conn.connectedAt = new Date();
    conn.updatedBy = state.userId || null;
    await conn.save();

    return {
        ok: true,
        merchantId: conn.merchantId,
        companyId: String(companyId),
        environment: conn.environment,
        hasRefreshToken: Boolean(tokens.refresh_token),
    };
};

module.exports = {
    buildAuthorizeUrl,
    handleOAuthCallback,
    getCloverOAuthRedirectUri,
};
