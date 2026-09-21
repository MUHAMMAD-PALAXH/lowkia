/**
 * Shared payment provider base (no provider implementations).
 */
class PaymentProviderError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "PaymentProviderError";
        this.statusCode = statusCode;
    }
}

class PaymentProvider {
    get name() {
        return "NONE";
    }

    async createPayment(_input) {
        throw new PaymentProviderError(
            `${this.name} createPayment is not implemented.`,
            501
        );
    }

    async authorizePayment(_input) {
        throw new PaymentProviderError(
            `${this.name} authorizePayment is not implemented.`,
            501
        );
    }

    async capturePayment(_providerPaymentId, _input = {}) {
        throw new PaymentProviderError(
            `${this.name} capturePayment is not implemented.`,
            501
        );
    }

    async refundPayment(_providerPaymentId, _input = {}) {
        throw new PaymentProviderError(
            `${this.name} refundPayment is not implemented.`,
            501
        );
    }

    async verifyPayment(_providerPaymentId) {
        throw new PaymentProviderError(
            `${this.name} verifyPayment is not implemented.`,
            501
        );
    }

    async getPaymentStatus(_providerPaymentId) {
        throw new PaymentProviderError(
            `${this.name} getPaymentStatus is not implemented.`,
            501
        );
    }
}

module.exports = {
    PaymentProvider,
    PaymentProviderError,
};
