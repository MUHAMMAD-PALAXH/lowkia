const mongoose = require("mongoose");
const MarketplaceShipmentTrackingEvent = require("../../model/marketplace/shipmentTrackingEvent");
const MarketplaceShipment = require("../../model/marketplace/shipment");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceShipmentItem = require("../../model/marketplace/shipmentItem");
const AppError = require("../../utils/appError");
const { NOT_DELETED, SHIPMENT_STATUSES } = require("../../constants/marketplace");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const STATUS_TITLES = {
    pending: "Shipment created",
    confirmed: "Shipment confirmed",
    packed: "Order packed",
    ready_to_ship: "Ready to ship",
    shipped: "Shipped",
    in_transit: "In transit",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    failed_delivery: "Delivery failed",
    returned: "Returned",
    cancelled: "Shipment cancelled",
};

const formatTrackingEvent = (event) => ({
    id: event._id,
    status: event.status,
    title: event.title,
    description: event.description || "",
    location: event.location || "",
    eventAt: event.eventAt,
    source: event.source,
});

const appendTrackingEvent = async (
    {
        shipment,
        status,
        title,
        description = "",
        location = "",
        source = "system",
        eventAt = new Date(),
        metadata = null,
    },
    session = null
) => {
    const eventStatus = status || shipment.status;
    const eventTitle = title || STATUS_TITLES[eventStatus] || eventStatus;

    const [event] = await MarketplaceShipmentTrackingEvent.create(
        [
            {
                shipmentId: shipment._id,
                companyOrderId: shipment.companyOrderId,
                companyId: shipment.companyId,
                status: eventStatus,
                title: eventTitle,
                description,
                location,
                eventAt,
                source,
                metadata,
            },
        ],
        session ? { session } : undefined
    );

    return event;
};

const listTrackingEvents = async (shipmentId) => {
    const events = await MarketplaceShipmentTrackingEvent.find({
        shipmentId: toObjectId(shipmentId),
        ...NOT_DELETED,
    })
        .sort({ eventAt: 1, createdAt: 1 })
        .lean();

    return events.map(formatTrackingEvent);
};

const getCustomerShipmentTracking = async (userId, shipmentId) => {
    const id = toObjectId(shipmentId);
    if (!id) throw new AppError("Invalid shipment id.", 400);

    const shipment = await MarketplaceShipment.findOne({
        _id: id,
        userId,
        ...NOT_DELETED,
    }).lean();

    if (!shipment) throw new AppError("Shipment not found.", 404);

    const [companyOrder, items, timeline] = await Promise.all([
        CompanyOrder.findOne({
            _id: shipment.companyOrderId,
            ...NOT_DELETED,
        })
            .select("orderNumber seller status")
            .lean(),
        MarketplaceShipmentItem.find({
            shipmentId: shipment._id,
            ...NOT_DELETED,
        }).lean(),
        listTrackingEvents(shipment._id),
    ]);

    return {
        shipment: {
            id: shipment._id,
            shipmentNumber: shipment.shipmentNumber,
            status: shipment.status,
            courierName: shipment.courierName,
            trackingNumber: shipment.trackingNumber,
            trackingUrl: shipment.trackingUrl,
            estimatedDeliveryAt: shipment.estimatedDeliveryAt,
            shippedAt: shipment.shippedAt,
            deliveredAt: shipment.deliveredAt,
        },
        seller: companyOrder?.seller || null,
        companyOrderNumber: companyOrder?.orderNumber || "",
        items,
        timeline,
    };
};

const addCompanyTrackingEvent = async (
    shipmentId,
    payload = {},
    companyId = null
) => {
    const shipment = await MarketplaceShipment.findOne({
        _id: toObjectId(shipmentId),
        ...NOT_DELETED,
        companyId: toObjectId(companyId),
    });

    if (!shipment) throw new AppError("Shipment not found.", 404);

    const status = payload.status || shipment.status;
    if (!SHIPMENT_STATUSES.includes(status)) {
        throw new AppError("Invalid shipment status.", 400);
    }

    const title = String(payload.title || STATUS_TITLES[status] || status).trim();
    if (!title) throw new AppError("Event title is required.", 400);

    const previousStatus = shipment.status;

    const event = await appendTrackingEvent({
        shipment,
        status,
        title,
        description: payload.description || "",
        location: payload.location || "",
        source: payload.source || "company",
        eventAt: payload.eventAt ? new Date(payload.eventAt) : new Date(),
        metadata: payload.metadata || null,
    });

    if (payload.status && payload.status !== previousStatus) {
        shipment.status = payload.status;
        if (
            ["shipped", "in_transit", "out_for_delivery"].includes(payload.status) &&
            !shipment.shippedAt
        ) {
            shipment.shippedAt = new Date();
        }
        if (payload.status === "delivered" && !shipment.deliveredAt) {
            shipment.deliveredAt = new Date();
        }
        await shipment.save();
    }

    return {
        shipment: {
            id: shipment._id,
            shipmentNumber: shipment.shipmentNumber,
            status: shipment.status,
        },
        event: formatTrackingEvent(event.toObject()),
    };
};

module.exports = {
    STATUS_TITLES,
    appendTrackingEvent,
    listTrackingEvents,
    getCustomerShipmentTracking,
    addCompanyTrackingEvent,
};
