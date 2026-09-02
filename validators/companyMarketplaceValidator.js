const { body, param, query } = require("express-validator");
const {
    SHIPMENT_STATUSES,
    COMPANY_ORDER_STATUSES,
} = require("../constants/marketplace");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const listCompanyOrdersValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(COMPANY_ORDER_STATUSES)
        .withMessage("Invalid status filter."),
    query("paymentStatus")
        .optional()
        .isIn([
            "pending",
            "processing",
            "successful",
            "failed",
            "cancelled",
            "refunded",
            "partially_refunded",
        ]),
    query("search").optional().isString().trim().isLength({ max: 80 }),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("erpLinked").optional().isIn(["true", "false"]),
];

const companyOrderIdValidator = [mongoId("companyOrderId")];

const createShipmentValidator = [
    mongoId("companyOrderId"),
    body("items").isArray({ min: 1 }).withMessage("items array is required."),
    body("items.*.orderItemId")
        .notEmpty()
        .isMongoId()
        .withMessage("Invalid orderItemId."),
    body("items.*.quantity").isInt({ min: 1 }),
    body("status").optional().isIn(SHIPMENT_STATUSES),
    body("courierId").optional().isMongoId(),
    body("courierName").optional().isString().trim().isLength({ max: 120 }),
    body("trackingNumber").optional().isString().trim().isLength({ max: 120 }),
    body("trackingUrl").optional().isString().trim().isLength({ max: 500 }),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("estimatedDeliveryAt").optional().isISO8601(),
];

const shipmentIdValidator = [mongoId("shipmentId")];

const updateShipmentValidator = [
    mongoId("shipmentId"),
    body("status").optional().isIn(SHIPMENT_STATUSES),
    body("courierId").optional().isMongoId(),
    body("courierName").optional().isString().trim().isLength({ max: 120 }),
    body("trackingNumber").optional().isString().trim().isLength({ max: 120 }),
    body("trackingUrl").optional().isString().trim().isLength({ max: 500 }),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    body("estimatedDeliveryAt").optional().isISO8601(),
];

const addTrackingEventValidator = [
    mongoId("shipmentId"),
    body("status").optional().isIn(SHIPMENT_STATUSES),
    body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("description").optional().isString().trim().isLength({ max: 1000 }),
    body("location").optional().isString().trim().isLength({ max: 200 }),
    body("eventAt").optional().isISO8601(),
    body("source").optional().isIn(["system", "courier", "company", "customer"]),
];

const updateCompanyOrderStatusValidator = [
    mongoId("companyOrderId"),
    body("status")
        .notEmpty()
        .isIn(COMPANY_ORDER_STATUSES)
        .withMessage("Invalid company order status."),
    body("reason").optional().isString().trim().isLength({ max: 1000 }),
    body("cancelReason").optional().isString().trim().isLength({ max: 1000 }),
];

const bridgeErpValidator = [
    mongoId("companyOrderId"),
    body("warehouseId").optional().isMongoId(),
    body("branchId").optional().isMongoId(),
];

const listShipmentsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(SHIPMENT_STATUSES)
        .withMessage("Invalid status filter."),
];

module.exports = {
    listCompanyOrdersValidator,
    companyOrderIdValidator,
    createShipmentValidator,
    shipmentIdValidator,
    updateShipmentValidator,
    addTrackingEventValidator,
    updateCompanyOrderStatusValidator,
    bridgeErpValidator,
    listShipmentsValidator,
};
