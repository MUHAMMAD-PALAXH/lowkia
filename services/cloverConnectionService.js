const CloverConnection = require("../model/cloverConnection");
const AppError = require("../utils/appError");
const { ensureUserCompany } = require("./companyService");
const { encryptSecret, decryptSecret } = require("../utils/secretCrypto");
const {
    getCloverEnv,
    getDefaultPosId,
    getCloverRaid,
} = require("../config/clover");
const { getPaymentProvider, PaymentProviderError } = require("./paymentProviders");

const NOT_DELETED = { isDeleted: { $ne: true } };

const sanitize = (doc) => {
    if (!doc) return null;
    const plain = doc.toObject ? doc.toObject() : { ...doc };
    delete plain.accessTokenEnc;
    delete plain.refreshTokenEnc;
    return {
        ...plain,
        connected: Boolean(doc.accessTokenEnc) && doc.isActive !== false,
        hasAccessToken: Boolean(doc.accessTokenEnc),
        hasRefreshToken: Boolean(doc.refreshTokenEnc),
        tokenExpiresAt: doc.tokenExpiresAt || null,
    };
};

const getConnectionOrNull = async (companyId) => {
    return CloverConnection.findOne({ companyId, ...NOT_DELETED });
};

const getConnectionOrFail = async (companyId) => {
    const conn = await getConnectionOrNull(companyId);
    if (!conn || !conn.isActive) {
        throw new AppError(
            "Clover is not connected for this company. Configure Clover in settings.",
            404
        );
    }
    if (!conn.accessTokenEnc) {
        throw new AppError(
            "Clover access token is missing. Reconnect Clover.",
            503
        );
    }
    return conn;
};

const resolveAccessToken = (conn) => {
    try {
        return decryptSecret(conn.accessTokenEnc);
    } catch (_) {
        throw new AppError(
            "Could not decrypt Clover access token. Check CLOVER_TOKEN_SECRET.",
            500
        );
    }
};

const resolveDevice = (conn, deviceId) => {
    const devices = Array.isArray(conn.devices) ? conn.devices : [];
    const active = devices.filter((d) => d.isActive !== false);
    if (!active.length) {
        throw new AppError(
            "No active Clover Flex device configured for this company.",
            400
        );
    }
    if (deviceId) {
        const found = active.find(
            (d) => String(d.serialNumber) === String(deviceId)
        );
        if (!found) {
            throw new AppError("Clover device not found for this company.", 404);
        }
        return found;
    }
    return active.find((d) => d.isDefault) || active[0];
};

/**
 * Upsert company Clover connection (manual token path for sandbox / Phase 1).
 */
const upsertConnection = async (payload = {}, user) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);

    const merchantId = String(payload.merchantId || "").trim();
    if (!merchantId) throw new AppError("merchantId is required.", 400);

    const accessToken = String(payload.accessToken || "").trim();
    const refreshToken = String(payload.refreshToken || "").trim();

    let conn = await getConnectionOrNull(companyId);
    if (!conn) {
        conn = new CloverConnection({
            companyId,
            createdBy: user._id,
        });
    }

    conn.environment =
        payload.environment === "production" ? "production" : getCloverEnv();
    conn.merchantId = merchantId;
    conn.merchantName = String(payload.merchantName || "").trim();
    conn.posId = String(payload.posId || getDefaultPosId()).trim();
    conn.raid = String(payload.raid || getCloverRaid() || "").trim();
    conn.isActive = payload.isActive !== false;
    conn.updatedBy = user._id;
    conn.connectedAt = new Date();

    if (accessToken) {
        conn.accessTokenEnc = encryptSecret(accessToken);
    }
    if (refreshToken) {
        conn.refreshTokenEnc = encryptSecret(refreshToken);
    }
    if (payload.tokenExpiresAt) {
        const exp = new Date(payload.tokenExpiresAt);
        if (!Number.isNaN(exp.getTime())) conn.tokenExpiresAt = exp;
    }

    if (Array.isArray(payload.devices)) {
        conn.devices = payload.devices
            .map((d) => ({
                serialNumber: String(d.serialNumber || "").trim(),
                name: String(d.name || "").trim(),
                isActive: d.isActive !== false,
                isDefault: d.isDefault === true,
            }))
            .filter((d) => d.serialNumber);
        // Ensure one default
        if (conn.devices.length && !conn.devices.some((d) => d.isDefault)) {
            conn.devices[0].isDefault = true;
        }
    }

    if (!conn.accessTokenEnc) {
        throw new AppError("accessToken is required on first connect.", 400);
    }

    await conn.save();
    return sanitize(conn);
};

const getConnectionPublic = async (user) => {
    const companyId = await ensureUserCompany(user);
    const conn = await getConnectionOrNull(companyId);
    if (!conn) return null;
    return sanitize(conn);
};

const addOrUpdateDevice = async (payload = {}, user) => {
    const companyId = await ensureUserCompany(user);
    const conn = await getConnectionOrFail(companyId);
    const serialNumber = String(payload.serialNumber || "").trim();
    if (!serialNumber) throw new AppError("serialNumber is required.", 400);

    const devices = Array.isArray(conn.devices) ? [...conn.devices] : [];
    const idx = devices.findIndex(
        (d) => String(d.serialNumber) === serialNumber
    );
    const next = {
        serialNumber,
        name: String(payload.name || "").trim(),
        isActive: payload.isActive !== false,
        isDefault: payload.isDefault === true,
    };
    if (next.isDefault) {
        for (const d of devices) d.isDefault = false;
    }
    if (idx >= 0) {
        devices[idx] = { ...devices[idx].toObject?.() || devices[idx], ...next };
    } else {
        devices.push(next);
    }
    if (!devices.some((d) => d.isDefault)) devices[0].isDefault = true;

    conn.devices = devices;
    conn.updatedBy = user._id;
    await conn.save();
    return sanitize(conn);
};

const pingDevice = async (user, deviceId) => {
    const companyId = await ensureUserCompany(user);
    const conn = await getConnectionOrFail(companyId);
    const device = resolveDevice(conn, deviceId);
    const clover = getPaymentProvider("CLOVER");
    try {
        await clover.pingDevice({
            accessToken: resolveAccessToken(conn),
            deviceId: device.serialNumber,
            posId: conn.posId,
        });
        device.lastSeenAt = new Date();
        device.lastError = "";
        conn.lastUsedAt = new Date();
        await conn.save();
        return { ok: true, deviceId: device.serialNumber };
    } catch (err) {
        device.lastError = err.message || String(err);
        await conn.save();
        if (err instanceof PaymentProviderError) {
            throw new AppError(err.message, err.statusCode || 400);
        }
        throw err;
    }
};

/**
 * Resolve decrypted token + device for a company charge (Sales Order path).
 */
const resolveDeviceForCharge = async (companyId, deviceSerial = null) => {
    const connection = await getConnectionOrFail(companyId);
    const device = resolveDevice(connection, deviceSerial);
    const accessToken = resolveAccessToken(connection);
    return {
        connection,
        device,
        accessToken,
        posId: connection.posId || getDefaultPosId(),
        merchantId: connection.merchantId,
    };
};

const disconnect = async (user) => {
    const companyId = await ensureUserCompany(user);
    const conn = await getConnectionOrNull(companyId);
    if (!conn) return { disconnected: true };
    conn.isActive = false;
    conn.accessTokenEnc = "";
    conn.refreshTokenEnc = "";
    conn.updatedBy = user._id;
    conn.deletedAt = null;
    await conn.save();
    return { disconnected: true };
};

module.exports = {
    sanitize,
    getConnectionOrNull,
    getConnectionOrFail,
    resolveAccessToken,
    resolveDevice,
    resolveDeviceForCharge,
    upsertConnection,
    getConnectionPublic,
    addOrUpdateDevice,
    pingDevice,
    disconnect,
};
