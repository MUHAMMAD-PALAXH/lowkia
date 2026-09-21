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

module.exports = {
    encryptSecret,
    decryptSecret,
    newIdempotencyKey,
    KEY_BYTES,
};
