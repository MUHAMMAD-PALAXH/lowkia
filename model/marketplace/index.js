/**
 * Marketplace model barrel — import from here in services/routes.
 */
module.exports = {
    MarketplaceCart: require("./cart"),
    MarketplaceCartItem: require("./cartItem"),
    CustomerAddress: require("./customerAddress"),
    MasterOrder: require("./masterOrder"),
    CompanyOrder: require("./companyOrder"),
    MarketplaceOrderItem: require("./marketplaceOrderItem"),
    CheckoutPayment: require("./checkoutPayment"),
    MarketplaceRefund: require("./refund"),
    ShippingRule: require("./shippingRule"),
    Courier: require("./courier"),
    MarketplaceShipment: require("./shipment"),
    MarketplaceShipmentItem: require("./shipmentItem"),
    MarketplaceShipmentTrackingEvent: require("./shipmentTrackingEvent"),
    UserNotification: require("./userNotification"),
    sharedSchemas: require("./sharedSchemas"),
};
