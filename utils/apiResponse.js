exports.success = (res, message, data = null, status = 200) => {
    return res.status(status).json({
        success: true,
        message,
        data,
        errors: null
    });
};

exports.error = (res, message, status = 400, errors = null) => {
    return res.status(status).json({
        success: false,
        message,
        data: null,
        errors
    });
};
