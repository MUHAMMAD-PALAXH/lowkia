const { captureMutation } = require("../services/notificationCenterService");

/**
 * Records successful business mutations without coupling every controller to
 * the notification center. It captures only safe routing/entity metadata.
 */
const notificationCapture = (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        return next();
    }

    const originalJson = res.json.bind(res);
    let captured = false;
    res.json = (body) => {
        if (!captured) {
            captured = true;
            setImmediate(() => {
                captureMutation({
                    req,
                    responseBody: body,
                    statusCode: res.statusCode,
                });
            });
        }
        return originalJson(body);
    };
    next();
};

module.exports = notificationCapture;
