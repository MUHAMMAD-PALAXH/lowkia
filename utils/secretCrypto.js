/**
 * AES-256-GCM helpers for storing Clover OAuth tokens at rest.
 * Never log plaintext tokens.
 */
const crypto = require("crypto");
const { getCloverTokenSecret } = require("../config/clover");

const KEY_BYTES = 32;
const IV_BYTES = 12;

function deriveKey() {
    return crypto
        .createHash("sha256")
        .update(String(getCloverTokenSecret()), "utf8")
        .digest();
}

function encryptSecret(plain) {
    if (plain == null || plain === "") return "";
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
    const enc = Buffer.concat([
        cipher.update(String(plain), "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(payload) {
    if (!payload) return "";
    const parts = String(payload).split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
        throw new Error("Invalid encrypted secret format.");
    }
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        "utf8"
    );
}

function newIdempotencyKey() {
    // Clover recommends ≥13 alphanumeric chars
    return crypto.randomBytes(16).toString("hex");
}

/** Compact signed state for OAuth (company + user binding). */
function signOAuthState(payload, ttlSec = 600) {
    const body = {
        ...payload,
        exp: Math.floor(Date.now() / 1000) + ttlSec,
    };
    const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const sig = crypto
        .createHmac("sha256", deriveKey())
        .update(data)
        .digest("base64url");
    return `${data}.${sig}`;
}

function verifyOAuthState(token) {
    const raw = String(token || "");
    const [data, sig] = raw.split(".");
    if (!data || !sig) throw new Error("Invalid OAuth state.");
    const expected = crypto
        .createHmac("sha256", deriveKey())
        .update(data)
        .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error("Invalid OAuth state signature.");
    }
    const body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!body?.exp || body.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("OAuth state expired. Start Connect again.");
    }
    return body;
}

module.exports = {
    encryptSecret,
    decryptSecret,
    newIdempotencyKey,
    signOAuthState,
    verifyOAuthState,
    KEY_BYTES,
};
