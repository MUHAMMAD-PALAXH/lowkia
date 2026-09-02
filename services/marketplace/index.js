/**
 * Marketplace service boundaries.
 *
 * cartService              — cart CRUD, stock/availability checks, seller snapshots
 * marketplaceCatalogService — cross-company product listing (read-only)
 * marketplaceProductService  — shared product resolution + stock helpers
 * shippingRuleService      — company shipping rules CRUD + fee calculation
 * checkoutService          — preview, group-by-company, place order (Phase 4–5)
 * marketplaceOrderService  — master/company order reads, status transitions
 * marketplaceOrderStatusService — derived master status + company transitions
 * checkoutPaymentService   — gateway-independent payment lifecycle
 * inventoryReservationService — stock reserve/release via Inventory + StockMovement
 * shipmentService          — shipment CRUD, tracking events
 * marketplaceNotificationService — UserNotification + push (Phase 11)
 * refundService            — partial/full refunds (Phase 12) ✅
 *
 * Auth matrix:
 *   /api/marketplace/*           → userProtect (User JWT), no tenant middleware
 *   /api/marketplace/products/*  → optionalProtect (guest browse)
 *   /api/company/marketplace-*   → protect + resolveTenant + requireCompany
 *   /api/platform/marketplace/*  → global super admin only
 */

module.exports = {
    cartService: require("./cartService"),
    marketplaceCatalogService: require("./marketplaceCatalogService"),
    marketplaceProductService: require("./marketplaceProductService"),
    shippingRuleService: require("./shippingRuleService"),
    checkoutService: require("./checkoutService"),
    marketplaceOrderService: require("./marketplaceOrderService"),
    marketplaceOrderStatusService: require("./marketplaceOrderStatusService"),
    marketplaceNotificationService: require("./marketplaceNotificationService"),
    refundService: require("./refundService"),
    companyMarketplaceOrderService: require("./companyMarketplaceOrderService"),
    marketplaceSalesOrderBridgeService: require("./marketplaceSalesOrderBridgeService"),
    platformMarketplaceService: require("./platformMarketplaceService"),
    marketplaceSecurityService: require("./marketplaceSecurityService"),
    marketplaceAuditService: require("./marketplaceAuditService"),
    checkoutPaymentService: require("./checkoutPaymentService"),
    inventoryReservationService: require("./inventoryReservationService"),
    shipmentService: require("./shipmentService"),
    trackingService: require("./trackingService"),
    courierService: require("./courierService"),
};
