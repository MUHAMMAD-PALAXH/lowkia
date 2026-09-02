const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const shipmentService = require("../services/marketplace/shipmentService");
const orderService = require("../services/marketplace/companyMarketplaceOrderService");
const bridgeService = require("../services/marketplace/marketplaceSalesOrderBridgeService");
const trackingService = require("../services/marketplace/trackingService");
const {
    updateCompanyOrderStatus,
} = require("../services/marketplace/marketplaceOrderStatusService");

const getActorId = (req) => req.user?._id || null;

exports.listCompanyOrders = asyncHandler(async (req, res) => {
    const result = await orderService.listCompanyOrders(
        req.companyId,
        req.query
    );
    return res.status(200).json({
        success: true,
        message: "Company marketplace orders retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getCompanyOrder = asyncHandler(async (req, res) => {
    const data = await orderService.getCompanyOrderDetail(
        req.params.companyOrderId,
        req.companyId
    );
    return success(res, "Company marketplace order retrieved.", data);
});

exports.getCompanyOrderDashboard = asyncHandler(async (req, res) => {
    const data = await orderService.getCompanyOrderDashboard(req.companyId);
    return success(res, "Marketplace order dashboard retrieved.", data);
});

exports.bridgeToErp = asyncHandler(async (req, res) => {
    const data = await bridgeService.bridgeCompanyOrderToSalesOrder(
        req.params.companyOrderId,
        req.body,
        req.companyId,
        getActorId(req)
    );
    return success(
        res,
        data.alreadyLinked ? "ERP sales order already linked." : "ERP sales order created.",
        data,
        data.alreadyLinked ? 200 : 201
    );
});

exports.listAllShipments = asyncHandler(async (req, res) => {
    const result = await shipmentService.listAllShipmentsForCompany(
        req.companyId,
        req.query
    );
    return res.status(200).json({
        success: true,
        message: "Shipments retrieved.",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.listShipments = asyncHandler(async (req, res) => {
    const data = await shipmentService.listShipmentsForCompanyOrder(
        req.params.companyOrderId,
        req.companyId
    );
    return success(res, "Shipments retrieved.", data);
});

exports.createShipment = asyncHandler(async (req, res) => {
    const data = await shipmentService.createShipment(
        req.params.companyOrderId,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shipment created.", data, 201);
});

exports.getShipment = asyncHandler(async (req, res) => {
    const data = await shipmentService.getShipmentById(
        req.params.shipmentId,
        req.companyId
    );
    return success(res, "Shipment retrieved.", data);
});

exports.updateShipment = asyncHandler(async (req, res) => {
    const data = await shipmentService.updateShipment(
        req.params.shipmentId,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shipment updated.", data);
});

exports.addTrackingEvent = asyncHandler(async (req, res) => {
    const data = await trackingService.addCompanyTrackingEvent(
        req.params.shipmentId,
        req.body,
        req.companyId
    );
    return success(res, "Tracking event added.", data, 201);
});

exports.updateCompanyOrderStatus = asyncHandler(async (req, res) => {
    const result = await updateCompanyOrderStatus(
        req.params.companyOrderId,
        req.body,
        req.companyId
    );
    return success(res, "Company order status updated.", {
        companyOrder: {
            id: result.companyOrder._id,
            orderNumber: result.companyOrder.orderNumber,
            previousStatus: result.previousStatus,
            status: result.companyOrder.status,
            confirmedAt: result.companyOrder.confirmedAt,
            shippedAt: result.companyOrder.shippedAt,
            deliveredAt: result.companyOrder.deliveredAt,
            cancelledAt: result.companyOrder.cancelledAt,
            cancelReason: result.companyOrder.cancelReason,
        },
        masterOrder: {
            id: result.masterOrder._id,
            orderNumber: result.masterOrder.orderNumber,
            status: result.masterOrder.status,
            statusChanged: result.masterStatusChanged,
        },
    });
});
