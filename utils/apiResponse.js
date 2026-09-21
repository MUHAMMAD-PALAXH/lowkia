const { t, tErrors } = require("./i18n");

exports.success = (res, message, data = null, status = 200) => {
    const locale = res.req ? res.req.locale : "en";
    return res.status(status).json({
        success: true,
        message: t(locale, message),
        data,
        errors: null
    });
};

exports.error = (res, message, status = 400, errors = null) => {
    const locale = res.req ? res.req.locale : "en";
    return res.status(status).json({
        success: false,
        message: t(locale, message),
        data: null,
        errors: errors ? tErrors(locale, errors) : null
    });
};
