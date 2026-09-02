const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const MarketplaceShipment = require("../../model/marketplace/shipment");
const MarketplaceShipmentItem = require("../../model/marketplace/shipmentItem");
const Courier = require("../../model/marketplace/courier");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    SHIPMENT_STATUSES,
    MARKETPLACE_LIMITS,
} = require("../../constants/marketplace");
const { companyFilter } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../companyService");
const { generateMarketplaceShipmentCode } = require("../codeGenerator");
const {
    fulfillReservedInventoryLine,
    syncProductsForLines,
} = require("./inventoryReservationService");
const { appendTrackingEvent, STATUS_TITLES } = require("./trackingService");
const {
    transitionCompanyOrderStatus,
    syncMasterOrderStatus,
} = require("./marketplaceOrderStatusService");
const {
    emitStatusNotificationsFromTransition,
    notifyShipmentCreated,
    notifyShipmentStatusChange,
} = require("./marketplaceNotificationService");
const { auditMarketplaceAction } = require("./marketplaceAuditService");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");
const {
    loadCompanyOrderForTenant,
    getShippedQtyMap,
} = require("./companyMarketplaceOrderService");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const SHIPPABLE_COMPANY_ORDER_STATUSES = new Set([
    "confirmed",
    "processing",
    "packed",
    "partially_shipped",
]);

const formatShipment = (shipment, items = []) => ({
    id: shipment._id,
    shipmentNumber: shipment.shipmentNumber,
    masterOrderId: shipment.masterOrderId,
    companyOrderId: shipment.companyOrderId,
    companyId: shipment.companyId,
    status: shipment.status,
    courierId: shipment.courierId,
    courierName: shipment.courierName,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    estimatedDeliveryAt: shipment.estimatedDeliveryAt,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    note: shipment.note,
    items,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
});

const resolveCourier = async (companyId, courierId, courierName = "") => {
    const id = toObjectId(courierId);
    if (!id) {
        return {
            courierId: null,
            courierName: String(courierName || "").trim(),
            trackingUrlTemplate: "",
        };
    }

    const courier = await Courier.findOne({
        _id: id,
        isActive: true,
        isDeleted: { $ne: true },
        $or: [{ companyId: null }, { companyId: toObjectId(companyId) }],
    }).lean();

    if (!courier) throw new AppError("Courier not found.", 404);

    return {
        courierId: courier._id,
        courierName: courier.name,
        trackingUrlTemplate: courier.trackingUrlTemplate || "",
    };
};

const buildTrackingUrl = (template, trackingNumber) => {
    const number = String(trackingNumber || "").trim();
    const tpl = String(template || "").trim();
    if (!number || !tpl) return "";
    return tpl.replace(/\{trackingNumber\}/gi, encodeURIComponent(number));
};

const syncCompanyOrderShipmentStatus = async (companyOrder, session) => {
    const orderItems = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const shippedMap = await getShippedQtyMap(companyOrder._id);
    let allFullyShipped = orderItems.length > 0;
    let anyShipped = false;

    for (const item of orderItems) {
        const shipped = shippedMap.get(String(item._id)) || 0;
        if (shipped > 0) anyShipped = true;
        if (shipped < item.quantity) allFullyShipped = false;
    }

    let nextStatus = companyOrder.status;
    if (allFullyShipped && anyShipped) {
        nextStatus = "shipped";
    } else if (anyShipped) {
        nextStatus = "partially_shipped";
    } else if (companyOrder.status === "partially_shipped") {
        nextStatus = "confirmed";
    }

    let transitionResult = null;
    if (nextStatus !== companyOrder.status) {
        transitionResult = await transitionCompanyOrderStatus(
            companyOrder,
            nextStatus,
            {
                session,
                allowSystem: true,
            }
        );
    }

    return { companyOrder, transitionResult };
};

const listShipmentsForCompanyOrder = async (companyOrderId, companyId) => {
    await loadCompanyOrderForTenant(companyOrderId, companyId);

    const shipments = await MarketplaceShipment.find({
        companyOrderId: toObjectId(companyOrderId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    })
        .sort({ createdAt: -1 })
        .lean();

    const shipmentIds = shipments.map((s) => s._id);
    const items = await MarketplaceShipmentItem.find({
        shipmentId: { $in: shipmentIds },
        ...NOT_DELETED,
    }).lean();

    const itemsByShipment = new Map();
    for (const item of items) {
        const key = String(item.shipmentId);
        if (!itemsByShipment.has(key)) itemsByShipment.set(key, []);
        itemsByShipment.get(key).push(item);
    }

    return shipments.map((shipment) =>
        formatShipment(shipment, itemsByShipment.get(String(shipment._id)) || [])
    );
};

const listAllShipmentsForCompany = async (companyId, query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "company",
    });

    const filter = {
        ...companyFilter(companyId),
        ...NOT_DELETED,
    };
    if (query.status) filter.status = query.status;

    const [shipments, total] = await Promise.all([
        MarketplaceShipment.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MarketplaceShipment.countDocuments(filter),
    ]);

    const shipmentIds = shipments.map((row) => row._id);
    const items = shipmentIds.length
        ? await MarketplaceShipmentItem.find({
              shipmentId: { $in: shipmentIds },
              ...NOT_DELETED,
          }).lean()
        : [];

    const itemsByShipment = new Map();
    for (const item of items) {
        const key = String(item.shipmentId);
        if (!itemsByShipment.has(key)) itemsByShipment.set(key, []);
        itemsByShipment.get(key).push(item);
    }

    return {
        data: shipments.map((shipment) =>
            formatShipment(
                shipment,
                itemsByShipment.get(String(shipment._id)) || []
            )
        ),
        pagination: buildPagination(total),
    };
};

const createShipment = async (companyOrderId, payload = {}, actorId = null, companyId = null) => {
    const companyOrder = await loadCompanyOrderForTenant(companyOrderId, companyId);

    if (!SHIPPABLE_COMPANY_ORDER_STATUSES.has(companyOrder.status)) {
        throw new AppError(
            `Cannot ship company order in "${companyOrder.status}" status.`,
            400
        );
    }

    if (!companyOrder.inventoryReservedAt) {
        throw new AppError(
            "Inventory is not reserved for this order yet.",
            400
        );
    }

    const masterOrder = await MasterOrder.findOne({
        _id: companyOrder.masterOrderId,
        ...NOT_DELETED,
    });

    if (!masterOrder || masterOrder.paymentStatus !== "successful") {
        throw new AppError("Order payment must be successful before shipping.", 400);
    }

    const lines = Array.isArray(payload.items) ? payload.items : [];
    if (!lines.length) {
        throw new AppError("At least one shipment line is required.", 400);
    }

    const orderItems = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    });

    const orderItemMap = new Map(
        orderItems.map((item) => [String(item._id), item])
    );
    const shippedMap = await getShippedQtyMap(companyOrder._id);

    const normalizedLines = [];
    for (const raw of lines) {
        const orderItemId = toObjectId(raw.orderItemId);
        const orderItem = orderItemMap.get(String(orderItemId));
        if (!orderItem) {
            throw new AppError("Invalid order item for this company order.", 400);
        }

        const qty = Number(raw.quantity);
        if (!Number.isInteger(qty) || qty < 1) {
            throw new AppError("Shipment line quantity must be at least 1.", 400);
        }

        const alreadyShipped = shippedMap.get(String(orderItem._id)) || 0;
        const remaining = orderItem.quantity - alreadyShipped;
        if (qty > remaining) {
            throw new AppError(
                `Shipment quantity exceeds remaining for "${orderItem.product.productName}".`,
                400
            );
        }

        normalizedLines.push({ orderItem, quantity: qty });
    }

    const status = payload.status || "packed";
    if (!SHIPMENT_STATUSES.includes(status)) {
        throw new AppError("Invalid shipment status.", 400);
    }

    const note = String(payload.note || "").trim();
    if (note.length > MARKETPLACE_LIMITS.noteMax) {
        throw new AppError("Shipment note is too long.", 400);
    }

    const courier = await resolveCourier(
        companyId,
        payload.courierId,
        payload.courierName
    );
    const trackingNumber = String(payload.trackingNumber || "").trim();
    const trackingUrl =
        String(payload.trackingUrl || "").trim() ||
        buildTrackingUrl(courier.trackingUrlTemplate, trackingNumber);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const shipmentNumber = await generateMarketplaceShipmentCode({ session });
        const shippedAt = ["shipped", "in_transit", "out_for_delivery"].includes(
            status
        )
            ? new Date()
            : null;

        const [shipment] = await MarketplaceShipment.create(
            [
                {
                    shipmentNumber,
                    masterOrderId: companyOrder.masterOrderId,
                    companyOrderId: companyOrder._id,
                    companyId: companyOrder.companyId,
                    userId: companyOrder.userId,
                    status,
                    courierId: courier.courierId,
                    courierName: courier.courierName,
                    trackingNumber,
                    trackingUrl,
                    estimatedDeliveryAt:
                        payload.estimatedDeliveryAt || companyOrder.estimatedDeliveryAt,
                    shippedAt,
                    note,
                    packedBy: actorId,
                },
            ],
            { session }
        );

        const shipmentItems = [];
        for (const line of normalizedLines) {
            await fulfillReservedInventoryLine({
                companyId: companyOrder.companyId,
                companyOrderId: companyOrder._id,
                companyOrderNumber: companyOrder.orderNumber,
                productId: line.orderItem.product.productId,
                productVariantId: line.orderItem.product.productVariantId,
                productName: line.orderItem.product.productName,
                sku: line.orderItem.product.sku,
                qty: line.quantity,
                session,
            });

            const [item] = await MarketplaceShipmentItem.create(
                [
                    {
                        shipmentId: shipment._id,
                        companyOrderId: companyOrder._id,
                        companyId: companyOrder.companyId,
                        orderItemId: line.orderItem._id,
                        productId: line.orderItem.product.productId,
                        productVariantId:
                            line.orderItem.product.productVariantId || null,
                        productName: line.orderItem.product.productName,
                        sku: line.orderItem.product.sku || "",
                        quantity: line.quantity,
                    },
                ],
                { session }
            );
            shipmentItems.push(item);
        }

        const { transitionResult } = await syncCompanyOrderShipmentStatus(
            companyOrder,
            session
        );
        await syncMasterOrderStatus(companyOrder.masterOrderId, { session });

        await appendTrackingEvent(
            {
                shipment,
                status: shipment.status,
                title: STATUS_TITLES[shipment.status] || "Shipment created",
                description: note || "Shipment created by company",
                source: "company",
            },
            session
        );

        await session.commitTransaction();
        await syncProductsForLines(
            normalizedLines.map((line) => ({ product: line.orderItem.product }))
        );

        void emitStatusNotificationsFromTransition(transitionResult);
        void notifyShipmentCreated({ shipment, companyOrder });
        void auditMarketplaceAction({
            actor: { _id: actorId, role: "admin", companyId },
            companyId,
            activityType: "Create",
            subModule: "MarketplaceShipment",
            description: `Marketplace shipment ${shipment.shipmentNumber} created.`,
            referenceType: "MarketplaceShipment",
            referenceId: shipment._id,
            newData: {
                shipmentNumber: shipment.shipmentNumber,
                status: shipment.status,
                trackingNumber: shipment.trackingNumber,
            },
            securityLevel: "High",
        });

        return formatShipment(shipment.toObject(), shipmentItems);
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

const getShipmentById = async (shipmentId, companyId) => {
    const shipment = await MarketplaceShipment.findOne({
        _id: toObjectId(shipmentId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    }).lean();

    if (!shipment) throw new AppError("Shipment not found.", 404);

    const items = await MarketplaceShipmentItem.find({
        shipmentId: shipment._id,
        ...NOT_DELETED,
    }).lean();

    return formatShipment(shipment, items);
};

const updateShipment = async (
    shipmentId,
    payload = {},
    actorId = null,
    companyId = null
) => {
    const shipment = await MarketplaceShipment.findOne({
        _id: toObjectId(shipmentId),
        ...companyFilter(companyId),
        ...NOT_DELETED,
    });

    if (!shipment) throw new AppError("Shipment not found.", 404);
    assertDocumentCompany(shipment, companyId, "Shipment");

    const previousStatus = shipment.status;

    if (payload.status !== undefined) {
        if (!SHIPMENT_STATUSES.includes(payload.status)) {
            throw new AppError("Invalid shipment status.", 400);
        }
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
    }

    if (payload.courierId !== undefined) {
        const courier = await resolveCourier(
            companyId,
            payload.courierId,
            payload.courierName
        );
        shipment.courierId = courier.courierId;
        shipment.courierName = courier.courierName;
    } else if (payload.courierName !== undefined) {
        shipment.courierName = String(payload.courierName || "").trim();
    }

    if (payload.trackingNumber !== undefined) {
        shipment.trackingNumber = String(payload.trackingNumber || "").trim();
    }

    if (payload.trackingUrl !== undefined) {
        shipment.trackingUrl = String(payload.trackingUrl || "").trim();
    } else if (payload.trackingNumber !== undefined && shipment.courierId) {
        const courier = await Courier.findById(shipment.courierId).lean();
        shipment.trackingUrl = buildTrackingUrl(
            courier?.trackingUrlTemplate,
            shipment.trackingNumber
        );
    }

    if (payload.note !== undefined) {
        const note = String(payload.note || "").trim();
        if (note.length > MARKETPLACE_LIMITS.noteMax) {
            throw new AppError("Shipment note is too long.", 400);
        }
        shipment.note = note;
    }

    if (payload.estimatedDeliveryAt !== undefined) {
        shipment.estimatedDeliveryAt = payload.estimatedDeliveryAt
            ? new Date(payload.estimatedDeliveryAt)
            : null;
    }

    await shipment.save();

    if (payload.status !== undefined && payload.status !== previousStatus) {
        await appendTrackingEvent({
            shipment,
            status: shipment.status,
            title: STATUS_TITLES[shipment.status] || shipment.status,
            description: payload.note || "",
            source: "company",
        });
    } else if (payload.trackingNumber !== undefined && payload.trackingNumber) {
        await appendTrackingEvent({
            shipment,
            status: shipment.status,
            title: "Tracking updated",
            description: `Tracking number: ${shipment.trackingNumber}`,
            source: "company",
        });
    }

    const companyOrder = await CompanyOrder.findById(shipment.companyOrderId);
    let transitionResult = null;
    if (companyOrder && payload.status === "delivered") {
        const shippedMap = await getShippedQtyMap(companyOrder._id);
        const orderItems = await MarketplaceOrderItem.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        });
        const allDelivered = orderItems.every(
            (item) => (shippedMap.get(String(item._id)) || 0) >= item.quantity
        );
        const nextStatus = allDelivered ? "delivered" : "partially_delivered";
        if (nextStatus !== companyOrder.status) {
            transitionResult = await transitionCompanyOrderStatus(
                companyOrder,
                nextStatus,
                { allowSystem: true }
            );
        } else {
            await syncMasterOrderStatus(companyOrder.masterOrderId);
        }
    }

    if (payload.status !== undefined && payload.status !== previousStatus) {
        void notifyShipmentStatusChange({
            shipment,
            companyOrder,
            previousStatus,
            nextStatus: shipment.status,
        });
    }
    void emitStatusNotificationsFromTransition(transitionResult);

    return getShipmentById(shipment._id, companyId);
};

module.exports = {
    listShipmentsForCompanyOrder,
    listAllShipmentsForCompany,
    createShipment,
    getShipmentById,
    updateShipment,
};
