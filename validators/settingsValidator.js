const { body } = require("express-validator");

const updateSettingsValidator = [
    body("timezone")
        .optional()
        .isString()
        .trim()
        .notEmpty()
        .withMessage("timezone cannot be empty."),
    body("defaultAttendancePolicyId")
        .optional({ nullable: true })
        .isMongoId()
        .withMessage("Invalid defaultAttendancePolicyId."),
    body("salesTargets").optional().isObject()
];

module.exports = { updateSettingsValidator };
