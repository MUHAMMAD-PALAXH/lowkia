const { validationResult } = require("express-validator");
const { error } = require("../utils/apiResponse");

const validate = (req, res, next) => {
    const result = validationResult(req);

    if (!result.isEmpty()) {
        const errors = {};

        result.array().forEach((item) => {
            if (!errors[item.path]) {
                errors[item.path] = item.msg;
            }
        });

        return error(res, "Validation failed.", 422, errors);
    }

    next();
};

module.exports = validate;
