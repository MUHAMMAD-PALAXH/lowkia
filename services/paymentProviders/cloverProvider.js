/**
 * Clover REST Pay Display provider (US Flex via Cloud Pay Display).
 * Server talks to Clover Cloud only — no Flutter SDK / USB.
 */
const {
    getCloverConnectBaseUrl,
    getCloverRaid,
    getDefaultPosId,
    isCloverConfigured,
} = require("../../config/clover");
const {
    PaymentProvider,
    PaymentProviderError,
} = require("./paymentProviderBase");

class CloverPaymentProvider extends PaymentProvider {
    get name() {
        return "CLOVER";
    }

    _headers({
        accessToken,
        deviceId,
        posId,
        idempotencyKey,
        timeoutSec,
    }) {
        if (!accessToken) {
            throw new PaymentProviderError(
                "Clover access token is missing for this company.",
                503
            );
        }
        if (!deviceId) {
            throw new PaymentProviderError(
                "Clover device serial (X-Clover-Device-Id) is required.",
                400
            );
        }
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Clover-Device-Id": String(deviceId),
            "X-POS-Id": String(posId || getDefaultPosId()),
        };
        if (idempotencyKey) {
            headers["Idempotency-Key"] = String(idempotencyKey);
        }
        if (timeoutSec != null) {
            headers["X-Clover-Timeout"] = String(
                Math.max(0, Math.min(300, Number(timeoutSec) || 120))
            );
        }
        const raid = getCloverRaid();
        if (raid) {
            headers["X-Clover-Remote-App-Id"] = raid;
        }
        return headers;
    }

    async _request(method, path, { headers, body, signal } = {}) {
        const base = getCloverConnectBaseUrl();
        const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers,
                body: body == null ? undefined : JSON.stringify(body),
                signal,
            });
        } catch (err) {
            throw new PaymentProviderError(
                err.message || "Clover network request failed.",
                503
            );
        }
        let data = null;
        const text = await res.text();
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (_) {
                data = { raw: text };
            }
        }
        if (!res.ok) {
            const msg =
                data?.message ||
                data?.error?.message ||
                data?.error ||
                `Clover request failed (${res.status}).`;
            throw new PaymentProviderError(String(msg), res.status || 400);
        }
        return data;
    }

    /**
     * Send sale to Flex. Blocks until customer completes / cancels / timeout.
     * input: { accessToken, deviceId, posId, amountMinor, externalPaymentId,
     *          idempotencyKey, timeoutSec, final, capture }
     */
    async createPayment(input = {}) {
        if (!isCloverConfigured() && !input.accessToken) {
            throw new PaymentProviderError(
                "Clover is not configured. Set CLOVER_APP_ID or CLOVER_ALLOW_MANUAL_TOKENS=1.",
                503
            );
        }
        const amount = Math.round(Number(input.amountMinor) || 0);
        if (amount < 1) {
            throw new PaymentProviderError(
                "Clover amount must be at least 1 cent.",
                400
            );
        }
        if (!input.externalPaymentId) {
            throw new PaymentProviderError(
                "externalPaymentId is required for Clover payments.",
                400
            );
        }
        if (!input.idempotencyKey) {
            throw new PaymentProviderError(
                "Idempotency-Key is required for Clover payments.",
                400
            );
        }

        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
            idempotencyKey: input.idempotencyKey,
            timeoutSec: input.timeoutSec != null ? input.timeoutSec : 120,
        });

        const body = {
            amount,
            externalPaymentId: String(input.externalPaymentId).slice(0, 42),
            final: input.final !== false,
            capture: input.capture !== false,
        };

        const data = await this._request("POST", "/payments", {
            headers,
            body,
        });

        const payment = data?.payment || data;
        const result = String(payment?.result || "").toUpperCase();
        const succeeded = result === "SUCCESS" || payment?.paid === true;

        return {
            provider: "CLOVER",
            status: succeeded ? "succeeded" : result || "unknown",
            succeeded,
            amountMinor: Number(payment?.amount) || amount,
            currency: String(input.currency || "USD").toLowerCase(),
            providerPaymentIntentId: String(input.externalPaymentId),
            providerTransactionId: String(payment?.id || ""),
            cloverPaymentId: String(payment?.id || ""),
            cloverOrderId: payment?.order?.id || null,
            cardLast4: payment?.cardTransaction?.last4 || null,
            cardBrand: payment?.cardTransaction?.cardType || null,
            entryType: payment?.cardTransaction?.entryType || null,
            idempotencyKey: input.idempotencyKey,
            raw: {
                id: payment?.id,
                result: payment?.result,
            },
        };
    }

    async authorizePayment(input) {
        return this.createPayment(input);
    }

    async refundPayment(providerPaymentId, input = {}) {
        if (!providerPaymentId) {
            throw new PaymentProviderError(
                "Clover payment id is required for refund.",
                400
            );
        }
        if (!input.idempotencyKey) {
            throw new PaymentProviderError(
                "Idempotency-Key is required for Clover refunds.",
                400
            );
        }
        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
            idempotencyKey: input.idempotencyKey,
            timeoutSec: input.timeoutSec != null ? input.timeoutSec : 120,
        });

        const body =
            input.fullRefund === true || !input.amountMinor
                ? { fullRefund: true }
                : { amount: Math.round(Number(input.amountMinor)) };

        const data = await this._request(
            "POST",
            `/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
            { headers, body }
        );

        const refund = data?.refund || data;
        return {
            provider: "CLOVER",
            status: refund?.id ? "refunded" : "unknown",
            refundId: refund?.id || null,
            amountMinor: Number(refund?.amount) || input.amountMinor || null,
            providerTransactionId: String(providerPaymentId),
            raw: { id: refund?.id },
        };
    }

    async verifyPayment(providerPaymentId, input = {}) {
        return this.getPaymentStatus(providerPaymentId, input);
    }

    /**
     * Recovery: replay same Idempotency-Key + same payment body via createPayment.
     * This method is a thin alias for callers that already have the clover payment id.
     */
    async getPaymentStatus(_providerPaymentId, input = {}) {
        if (input.replayPayment) {
            return this.createPayment(input.replayPayment);
        }
        return {
            provider: "CLOVER",
            status: "unknown",
            succeeded: false,
            message:
                "Use idempotent replay of the original payment request to recover status.",
        };
    }

    async pingDevice(input = {}) {
        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
        });
        await this._request("GET", "/device/ping", { headers });
        return { provider: "CLOVER", ok: true };
    }

    async cancelDevice(input = {}) {
        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
        });
        await this._request("POST", "/device/cancel", { headers, body: {} });
        return { provider: "CLOVER", canceled: true };
    }

    async showWelcome(input = {}) {
        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
        });
        await this._request("POST", "/device/welcome", { headers, body: {} });
        return { provider: "CLOVER", welcome: true };
    }

    async displayMessage(input = {}) {
        const headers = this._headers({
            accessToken: input.accessToken,
            deviceId: input.deviceId,
            posId: input.posId,
        });
        await this._request("POST", "/device/display", {
            headers,
            body: {
                text: String(input.text || "").slice(0, 200),
                beep: input.beep === true,
            },
        });
        return { provider: "CLOVER", displayed: true };
    }
}

module.exports = {
    CloverPaymentProvider,
};
