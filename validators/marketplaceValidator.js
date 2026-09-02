const { body, param, query } = require("express-validator");
const { MARKETPLACE_LIMITS } = require("../constants/marketplace");

const mongoId = (field, loc = "param") => {
    const chain =
        loc === "body"
            ? body(field)
            : loc === "query"
              ? query(field)
              : param(field);
    return chain.isMongoId().withMessage(`Invalid ${field}.`);
};

const addCartItemValidator = [
    body("productId").notEmpty().isMongoId().withMessage("Invalid productId."),
    body("productVariantId")
        .optional({ values: "null" })
        .isMongoId()
        .withMessage("Invalid productVariantId."),
    body("quantity")
        .optional()
        .isInt({ min: 1, max: MARKETPLACE_LIMITS.cartMaxQtyPerLine })
        .withMessage(
            `Quantity must be between 1 and ${MARKETPLACE_LIMITS.cartMaxQtyPerLine}.`
        ),
];

const updateCartItemValidator = [
    mongoId("itemId"),
    body("quantity")
        .notEmpty()
        .isInt({ min: 1, max: MARKETPLACE_LIMITS.cartMaxQtyPerLine })
        .withMessage(
            `Quantity must be between 1 and ${MARKETPLACE_LIMITS.cartMaxQtyPerLine}.`
        ),
];

const cartItemIdValidator = [mongoId("itemId")];

const listCatalogValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("search").optional().isString().trim().isLength({ max: 200 }),
    query("companyId").optional().isMongoId(),
    query("proCategoryId").optional().isMongoId(),
    query("proSubCategoryId").optional().isMongoId(),
    query("proBrandId").optional().isMongoId(),
    query("minPrice").optional().isFloat({ min: 0 }),
    query("maxPrice").optional().isFloat({ min: 0 }),
    query("sortBy").optional().isIn(["price", "createdAt"]),
    query("order").optional().isIn(["asc", "desc"]),
];

const catalogProductIdValidator = [mongoId("id")];

const shippingPreviewValidator = [
    query("city").optional().isString().trim().isLength({ max: 120 }),
    query("district").optional().isString().trim().isLength({ max: 120 }),
    body("city").optional().isString().trim().isLength({ max: 120 }),
    body("district").optional().isString().trim().isLength({ max: 120 }),
];

const checkoutPreviewValidator = [
    body("customerAddressId").optional().isMongoId(),
    body("shippingAddress").optional().isObject(),
    body("shippingAddress.recipientName")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 120 }),
    body("shippingAddress.phone")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 40 }),
    body("shippingAddress.addressLine")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: MARKETPLACE_LIMITS.addressLineMax }),
    body("shippingAddress.area").optional().isString().trim().isLength({ max: 120 }),
    body("shippingAddress.city")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 120 }),
    body("shippingAddress.district").optional().isString().trim().isLength({ max: 120 }),
    body("shippingAddress.postalCode").optional().isString().trim().isLength({ max: 20 }),
    body("shippingAddress.country").optional().isString().trim().isLength({ min: 2, max: 2 }),
    body("shippingAddress.deliveryInstructions")
        .optional()
        .isString()
        .trim()
        .isLength({ max: MARKETPLACE_LIMITS.deliveryInstructionsMax }),
    body("customerNote")
        .optional()
        .isString()
        .trim()
        .isLength({ max: MARKETPLACE_LIMITS.noteMax }),
];

const checkoutPlaceValidator = [
    ...checkoutPreviewValidator,
    body("idempotencyKey")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 8, max: 120 }),
];

const guestPlaceCheckoutValidator = [
    body("guest.email").notEmpty().isEmail().withMessage("Valid guest email is required."),
    body("guest.firstName").optional().isString().trim().isLength({ max: 120 }),
    body("guest.lastName").optional().isString().trim().isLength({ max: 120 }),
    body("guest.phone").optional().isString().trim().isLength({ max: 40 }),
    body("items").isArray({ min: 1 }).withMessage("At least one item is required."),
    body("items.*.productId").isMongoId(),
    body("items.*.productVariantId").optional({ values: "null" }).isMongoId(),
    body("items.*.quantity").optional().isInt({ min: 1 }),
    body("shippingAddress").isObject(),
    body("shippingAddress.recipientName").notEmpty().isString().trim(),
    body("shippingAddress.phone").notEmpty().isString().trim(),
    body("shippingAddress.addressLine").notEmpty().isString().trim(),
    body("shippingAddress.city").notEmpty().isString().trim(),
    body("idempotencyKey").optional().isString().trim().isLength({ min: 8, max: 120 }),
    body("customerNote")
        .optional()
        .isString()
        .trim()
        .isLength({ max: MARKETPLACE_LIMITS.noteMax }),
];

const listOrdersValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("status")
        .optional()
        .isIn([
            "pending",
            "confirmed",
            "processing",
            "partially_shipped",
            "shipped",
            "partially_delivered",
            "delivered",
            "cancelled",
            "partially_cancelled",
            "refunded",
            "partially_refunded",
        ]),
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
    query("search").optional().isString().trim().isLength({ max: 40 }),
];

const masterOrderIdValidator = [mongoId("masterOrderId")];

const companyOrderIdValidator = [
    mongoId("masterOrderId"),
    mongoId("companyOrderId"),
];

const initiatePaymentValidator = [
    body("masterOrderId").notEmpty().isMongoId().withMessage("Invalid masterOrderId."),
    body("paymentMethod")
        .notEmpty()
        .isIn(["cod", "card", "mobile_wallet", "bank_transfer", "gateway", "other"])
        .withMessage("Invalid paymentMethod."),
    body("paymentProvider")
        .optional()
        .isIn(["manual", "stripe", "sslcommerz", "bkash", "nagad", "other"]),
    body("idempotencyKey")
        .optional()
        .isString()
        .trim()
        .isLength({ min: 8, max: 120 }),
    body("metadata").optional().isObject(),
];

const confirmPaymentValidator = [
    body("paymentId").optional().isMongoId(),
    body("masterOrderId").optional().isMongoId(),
];

const paymentIdValidator = [mongoId("paymentId")];

const shipmentIdValidator = [mongoId("shipmentId")];

const webhookProviderValidator = [
    param("provider")
        .isIn(["manual", "stripe", "sslcommerz", "bkash", "nagad", "other"])
        .withMessage("Invalid provider."),
    body("status").optional().isString().trim(),
    body("paymentId").optional().isMongoId(),
    body("providerTransactionId").optional().isString().trim(),
    body("providerPaymentIntentId").optional().isString().trim(),
    body("paymentIntentId").optional().isString().trim(),
    body("transactionId").optional().isString().trim(),
    body("failureReason").optional().isString().trim(),
];

const listNotificationsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("isRead").optional().isIn(["true", "false"]),
    query("category").optional().isIn(["order", "payment", "shipment"]),
];

const notificationIdValidator = [mongoId("notificationId")];

const refundIdValidator = [mongoId("refundId")];

const listRefundsValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
        .optional()
        .isIn(["pending", "processing", "completed", "failed", "cancelled"]),
];

module.exports = {
    addCartItemValidator,
    updateCartItemValidator,
    cartItemIdValidator,
    listCatalogValidator,
    catalogProductIdValidator,
    shippingPreviewValidator,
    checkoutPreviewValidator,
    checkoutPlaceValidator,
    guestPlaceCheckoutValidator,
    listOrdersValidator,
    masterOrderIdValidator,
    companyOrderIdValidator,
    initiatePaymentValidator,
    confirmPaymentValidator,
    paymentIdValidator,
    shipmentIdValidator,
    webhookProviderValidator,
    listNotificationsValidator,
    notificationIdValidator,
    listRefundsValidator,
    refundIdValidator,
};
