const { body, param, query } = require("express-validator");
const { PAYMENT_STATUSES, PAYMENT_PROVIDERS } = require("../config/finance");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid payment id."),
];

const createCheckoutValidator = [
    body("salesOrderId").optional().isMongoId(),
    body("repairTicketId").optional().isMongoId(),
    body().custom((_, { req }) => {
        const so = req.body?.salesOrderId;
        const rt = req.body?.repairTicketId;
        if (!so && !rt) {
            throw new Error("salesOrderId or repairTicketId is required.");
        }
        if (so && rt) {
            throw new Error(
                "Provide either salesOrderId or repairTicketId, not both."
            );
        }
        return true;
    }),
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("paymentMethod").optional().isString().trim(),
    body("method").optional().isString().trim(),
    body("paymentProvider").optional().isIn(PAYMENT_PROVIDERS),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("completeImmediately").optional().isBoolean(),
    body("createEphemeralKey").optional().isBoolean(),
    body("email").optional().isEmail(),
    body("customerName").optional().isString().trim(),
    body("deviceSerial").optional().isString().trim(),
    body("cloverDeviceId").optional().isString().trim(),
    body("channel").optional().isString().trim(),
    body("terminal").optional().isString().trim(),
    body("timeoutSec").optional().isInt({ min: 30, max: 300 }),
    body("companyId")
        .not()
        .exists()
        .withMessage("companyId cannot be set by client."),
];

const listValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("salesOrderId").optional().isMongoId(),
    query("repairTicketId").optional().isMongoId(),
    query("customerId").optional().isMongoId(),
];

const reasonValidator = [
    body("reason").optional().isString().trim(),
    body("note").optional().isString().trim(),
];

const refundValidator = [
    body("amount").optional().isFloat({ gt: 0 }),
    body("amountMinor").optional().isInt({ min: 1 }),
    body("fullRefund").optional().isBoolean(),
    body("deviceSerial").optional().isString().trim(),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("salesReturnId").optional().isMongoId(),
];

module.exports = {
    idValidator,
    createCheckoutValidator,
    listValidator,
    reasonValidator,
    refundValidator,
};
