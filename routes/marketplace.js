const express = require("express");
const router = express.Router();

const captureWebhookBody = (req, res, next) => {
    if (!req.rawBody) {
        req.rawBody = JSON.stringify(req.body || {});
    }
    next();
};

const { protect, optionalProtect } = require("../middleware/userProtect");
const validate = require("../middleware/validate");
const cartController = require("../controllers/marketplaceCartController");
const catalogController = require("../controllers/marketplaceCatalogController");
const {
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
} = require("../validators/marketplaceValidator");
const shippingController = require("../controllers/marketplaceShippingController");
const checkoutController = require("../controllers/marketplaceCheckoutController");
const orderController = require("../controllers/marketplaceOrderController");
const paymentController = require("../controllers/marketplacePaymentController");
const trackingController = require("../controllers/marketplaceTrackingController");
const notificationController = require("../controllers/marketplaceNotificationController");
const refundController = require("../controllers/marketplaceRefundController");

// ─── Catalog (guest browse + optional auth) ─────────────────────────────────
router.get(
    "/products",
    optionalProtect,
    listCatalogValidator,
    validate,
    catalogController.listProducts
);
router.get(
    "/products/:id",
    optionalProtect,
    catalogProductIdValidator,
    validate,
    catalogController.getProduct
);
router.get("/taxonomy", optionalProtect, catalogController.getTaxonomy);
router.get("/sellers", optionalProtect, catalogController.listSellers);
router.get("/posters", optionalProtect, catalogController.listPosters);

router.post(
    "/checkout/guest-place",
    guestPlaceCheckoutValidator,
    validate,
    checkoutController.guestPlaceCheckout
);

// ─── Cart (login required) ──────────────────────────────────────────────────
router.use("/cart", protect);

router.get("/cart", cartController.getCart);
router.post(
    "/cart/items",
    addCartItemValidator,
    validate,
    cartController.addCartItem
);
router.patch(
    "/cart/items/:itemId",
    updateCartItemValidator,
    validate,
    cartController.updateCartItem
);
router.delete(
    "/cart/items/:itemId",
    cartItemIdValidator,
    validate,
    cartController.removeCartItem
);
router.delete("/cart", cartController.clearCart);

// ─── Shipping preview (login required) ──────────────────────────────────────
router.get(
    "/shipping/preview",
    protect,
    shippingPreviewValidator,
    validate,
    shippingController.previewShipping
);

// ─── Checkout preview (login required, no persistence) ────────────────────────
router.post(
    "/checkout/preview",
    protect,
    checkoutPreviewValidator,
    validate,
    checkoutController.previewCheckout
);

router.post(
    "/checkout/place",
    protect,
    checkoutPlaceValidator,
    validate,
    checkoutController.placeCheckout
);

// ─── Customer orders (login required) ───────────────────────────────────────
router.get(
    "/orders",
    protect,
    listOrdersValidator,
    validate,
    orderController.listOrders
);
router.get(
    "/orders/:masterOrderId",
    protect,
    masterOrderIdValidator,
    validate,
    orderController.getOrder
);
router.get(
    "/orders/:masterOrderId/company-orders/:companyOrderId",
    protect,
    companyOrderIdValidator,
    validate,
    orderController.getCompanyOrder
);
router.get(
    "/orders/:masterOrderId/refunds",
    protect,
    masterOrderIdValidator,
    listRefundsValidator,
    validate,
    refundController.listOrderRefunds
);

// ─── Payments (login required except webhook) ─────────────────────────────────
router.post(
    "/payments/initiate",
    protect,
    initiatePaymentValidator,
    validate,
    paymentController.initiatePayment
);
router.post(
    "/payments/confirm",
    protect,
    confirmPaymentValidator,
    validate,
    paymentController.confirmPayment
);
router.get(
    "/payments/:paymentId",
    protect,
    paymentIdValidator,
    validate,
    paymentController.getPayment
);
router.post(
    "/payments/webhook/:provider",
    captureWebhookBody,
    webhookProviderValidator,
    validate,
    paymentController.handleWebhook
);

// ─── Shipment tracking (login required) ───────────────────────────────────────
router.get(
    "/shipments/:shipmentId/tracking",
    protect,
    shipmentIdValidator,
    validate,
    trackingController.getShipmentTracking
);

// ─── Customer notifications (login required) ──────────────────────────────────
router.get(
    "/notifications/unread-count",
    protect,
    notificationController.getUnreadCount
);
router.get(
    "/notifications",
    protect,
    listNotificationsValidator,
    validate,
    notificationController.listNotifications
);
router.patch(
    "/notifications/read-all",
    protect,
    notificationController.markAllRead
);
router.patch(
    "/notifications/:notificationId/read",
    protect,
    notificationIdValidator,
    validate,
    notificationController.markRead
);

router.get(
    "/refunds/:refundId",
    protect,
    refundIdValidator,
    validate,
    refundController.getRefund
);

module.exports = router;
