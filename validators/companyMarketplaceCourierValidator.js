const { body, param, query } = require("express-validator");
const { COURIER_TYPES } = require("../constants/marketplace");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const listCouriersValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("isActive").optional().isIn(["true", "false"]),
    query("courierType").optional().isIn(COURIER_TYPES),
];

const courierIdValidator = [mongoId("courierId")];

const createCourierValidator = [
    body("name").notEmpty().trim().isLength({ min: 1, max: 120 }),
    body("code").optional().isString().trim().isLength({ max: 40 }),
    body("courierType").optional().isIn(COURIER_TYPES),
    body("trackingUrlTemplate").optional().isString().trim().isLength({ max: 500 }),
    body("isActive").optional().isBoolean(),
    body("metadata").optional().isObject(),
];

const updateCourierValidator = [
    mongoId("courierId"),
    body("name").optional().trim().isLength({ min: 1, max: 120 }),
    body("courierType").optional().isIn(COURIER_TYPES),
    body("trackingUrlTemplate").optional().isString().trim().isLength({ max: 500 }),
    body("isActive").optional().isBoolean(),
    body("metadata").optional().isObject(),
];

module.exports = {
    listCouriersValidator,
    courierIdValidator,
    createCourierValidator,
    updateCourierValidator,
};
