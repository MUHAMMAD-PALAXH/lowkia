const { body } = require("express-validator");

const upsertValidator = [
    body("merchantId").isString().trim().notEmpty().withMessage("merchantId is required."),
    body("accessToken").optional().isString().trim(),
    body("refreshToken").optional().isString().trim(),
    body("merchantName").optional().isString().trim(),
    body("posId").optional().isString().trim(),
    body("raid").optional().isString().trim(),
    body("environment").optional().isIn(["sandbox", "production"]),
    body("devices").optional().isArray(),
];

const deviceValidator = [
    body("serialNumber")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("serialNumber is required."),
    body("name").optional().isString().trim(),
    body("isDefault").optional().isBoolean(),
    body("isActive").optional().isBoolean(),
];

module.exports = {
    upsertValidator,
    deviceValidator,
};
