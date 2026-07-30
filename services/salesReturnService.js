const mongoose = require("mongoose");
const SalesReturn = require("../model/salesReturn");
const SalesOrder = require("../model/salesOrder");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const {
    generateSalesReturnCode,
    generateStockMovementCode
} = require("./codeGenerator");
const productService = require("./productService");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };
const STOCK_RESTORED_STATUSES = ["Received", "Refunded"];

const trash = createTrashOps(SalesReturn, {
    label: "Sales Return",
    nameField: "returnNumber",
    statusField: "status",
    restoreStatus: "Draft",
    beforeSoftDelete: async (doc) => {
        if (STOCK_RESTORED_STATUSES.includes(doc.status)) {
            throw new AppError(
                "This sales return already restored stock (Received/Refunded). Only Draft or unreceived returns can move to trash.",
                400
            );
        }
    },
    scopeStatusMap: {
        draft: "Draft",
        pendingapproval: "Pending Approval",
        approved: "Approved",
        received: "Received",
        refunded: "Refunded",
        rejected: "Rejected",
        cancelled: "Cancelled"
    }
});

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const populateReturn = (query) =>
    query
        .populate("branchId", "name branchCode")
        .populate("warehouseId", "warehouseCode warehouseName")
        .populate("customerId", "customerCode name phone")
        .populate("salesOrderId", "orderNumber status grandTotal");

const ACTIVE_RETURN_STATUSES = [
    "Draft",
    "Pending Approval",
    "Approved",
    "Received",
    "Refunded"
];

const lineKey = (productId, productVariantId) =>
    `${String(productId)}::${productVariantId ? String(productVariantId) : "null"}`;

/**
 * Sum qty + IMEIs already claimed by prior returns (any active status).
 * Prevents the same sold stock from being returned more than once.
 */
const getPriorReturnUsage = async (salesOrderId, excludeReturnId = null) => {
    const filter = {
        salesOrderId,
        ...NOT_DELETED,
        status: { $in: ACTIVE_RETURN_STATUSES }
    };
    if (excludeReturnId) {
        filter._id = { $ne: excludeReturnId };
    }

    const prior = await SalesReturn.find(filter).select("items status").lean();
    const qtyByLine = new Map();
    const returnedImeis = new Set();

    for (const doc of prior) {
        for (const item of doc.items || []) {
            const key = lineKey(item.productId, item.productVariantId);
            qtyByLine.set(
                key,
                (qtyByLine.get(key) || 0) + (Number(item.returnQuantity) || 0)
            );
            for (const imei of item.imeis || []) {
                const v = String(imei).trim();
                if (v) returnedImeis.add(v);
            }
        }
    }

    return { qtyByLine, returnedImeis };
};

const createFromSalesOrder = async (payload, actorId = null) => {
    const salesOrderId = toObjectId(payload.salesOrderId);
    if (!salesOrderId) throw new AppError("salesOrderId is required.", 400);

    const order = await SalesOrder.findOne({
        _id: salesOrderId,
        ...NOT_DELETED
    });
    if (!order) throw new AppError("Sales order not found.", 404);
    if (!order.stockUpdated) {
        throw new AppError(
            "Cannot return an order that never deducted stock.",
            400
        );
    }

    const itemsInput = Array.isArray(payload.items) ? payload.items : [];
    if (!itemsInput.length) {
        throw new AppError("At least one return line is required.", 400);
    }

    const { qtyByLine, returnedImeis } = await getPriorReturnUsage(salesOrderId);

    // Fast path: if every line is already fully returned, block entirely
    const anyReturnable = order.items.some((l) => {
        const key = lineKey(l.productId, l.productVariantId);
        const already =
            Math.max(
                Number(l.returnedQuantity) || 0,
                qtyByLine.get(key) || 0
            );
        return Number(l.quantity) - already > 0;
    });
    if (!anyReturnable) {
        throw new AppError(
            "This sales order is already fully returned. Stock cannot be returned again.",
            400
        );
    }

    const items = [];
    let subtotal = 0;

    for (const raw of itemsInput) {
        const productId = toObjectId(raw.productId);
        const productVariantId = toObjectId(raw.productVariantId);
        const line = order.items.find(
            (l) =>
                String(l.productId) === String(productId) &&
                (!productVariantId ||
                    String(l.productVariantId) === String(productVariantId))
        );
        if (!line) {
            throw new AppError("Return line does not match sales order.", 400);
        }

        const key = lineKey(line.productId, line.productVariantId);
        const alreadyReturned = Math.max(
            Number(line.returnedQuantity) || 0,
            qtyByLine.get(key) || 0
        );
        const remaining = Math.max(Number(line.quantity) - alreadyReturned, 0);

        const returnQuantity = Math.max(Number(raw.returnQuantity) || 0, 0);
        if (returnQuantity <= 0) {
            throw new AppError("returnQuantity must be > 0.", 400);
        }
        if (remaining <= 0) {
            throw new AppError(
                `"${line.productName}" was already fully returned. Cannot return again.`,
                400
            );
        }
        if (returnQuantity > remaining) {
            throw new AppError(
                `Only ${remaining} unit(s) left to return for "${line.productName}" (sold ${line.quantity}, already returned ${alreadyReturned}).`,
                400
            );
        }

        const trackingType =
            String(line.trackingType || "").toUpperCase().includes("IMEI") &&
            !String(line.trackingType || "").toUpperCase().includes("NON")
                ? "IMEI"
                : "Non-IMEI";

        let imeis = Array.isArray(raw.imeis)
            ? raw.imeis.map((e) => String(e).trim()).filter(Boolean)
            : [];
        if (trackingType === "IMEI") {
            if (imeis.length !== returnQuantity) {
                throw new AppError(
                    `IMEI count must match return qty for ${line.productName}.`,
                    400
                );
            }
            for (const imei of imeis) {
                if (!(line.imeis || []).includes(imei)) {
                    throw new AppError(
                        `IMEI ${imei} was not on this sales order.`,
                        400
                    );
                }
                if (returnedImeis.has(imei)) {
                    throw new AppError(
                        `IMEI ${imei} was already returned. Cannot return the same unit twice.`,
                        400
                    );
                }
            }
        }

        const unitPrice = Number(raw.unitPrice) || Number(line.unitPrice) || 0;
        const total = returnQuantity * unitPrice;
        subtotal += total;

        items.push({
            productId: line.productId,
            productVariantId: line.productVariantId || null,
            sku: line.sku || "",
            productName: line.productName,
            invoiceQuantity: line.quantity,
            returnQuantity,
            unitPrice,
            total,
            returnReason: raw.returnReason || payload.returnReason || "Other",
            condition: raw.condition || "Good",
            trackingType,
            imeis: trackingType === "IMEI" ? imeis : []
        });
    }

    const returnNumber = await generateSalesReturnCode();
    const doc = await SalesReturn.create({
        branchId: order.branchId,
        warehouseId: order.warehouseId,
        returnNumber,
        returnDate: new Date(),
        salesOrderId: order._id,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone || "",
        items,
        subtotal,
        refundAmount: subtotal,
        returnReason: payload.returnReason || "Customer Changed Mind",
        status: "Draft",
        createdBy: actorId || null
    });

    return populateReturn(SalesReturn.findById(doc._id));
};

const receiveReturn = async (id, actorId = null) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid return id.", 400);
    }
    const ret = await SalesReturn.findOne({ _id: id, ...NOT_DELETED });
    if (!ret) throw new AppError("Sales return not found.", 404);
    if (["Received", "Refunded"].includes(ret.status)) {
        throw new AppError(
            "This return was already received. Stock was restored once — cannot receive again.",
            400
        );
    }

    // Re-check remaining qty against other returns before posting stock
    if (ret.salesOrderId) {
        const { qtyByLine, returnedImeis } = await getPriorReturnUsage(
            ret.salesOrderId,
            ret._id
        );
        const order = await SalesOrder.findById(ret.salesOrderId);
        if (order) {
            for (const line of ret.items) {
                const key = lineKey(line.productId, line.productVariantId);
                const soLine = order.items.find(
                    (l) =>
                        String(l.productId) === String(line.productId) &&
                        String(l.productVariantId || "") ===
                            String(line.productVariantId || "")
                );
                const already = Math.max(
                    Number(soLine?.returnedQuantity) || 0,
                    qtyByLine.get(key) || 0
                );
                const sold = Number(soLine?.quantity) || 0;
                const remaining = Math.max(sold - already, 0);
                const qty = Number(line.returnQuantity) || 0;
                if (qty > remaining) {
                    throw new AppError(
                        `"${line.productName}" has only ${remaining} unit(s) left to return. Another return may already cover this stock.`,
                        400
                    );
                }
                for (const imei of line.imeis || []) {
                    if (returnedImeis.has(String(imei).trim())) {
                        throw new AppError(
                            `IMEI ${imei} was already returned on another return document.`,
                            400
                        );
                    }
                }
            }
        }
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    const productIds = new Set();

    try {
        for (const line of ret.items) {
            const qty = Number(line.returnQuantity) || 0;
            if (qty <= 0) continue;

            // IMEI: only restore units that are still marked sold
            if (line.trackingType === "IMEI") {
                for (const imei of line.imeis || []) {
                    const track = await ItemTrack.findOne({ imei }).session(
                        session
                    );
                    if (!track) {
                        throw new AppError(`IMEI ${imei} not found.`, 404);
                    }
                    if (track.status !== "sold") {
                        throw new AppError(
                            `IMEI ${imei} is already "${track.status}". It cannot be returned to stock again.`,
                            400
                        );
                    }
                    track.status = "available";
                    track.warrantyExpiry = undefined;
                    track.saleInfo = {
                        ...(track.saleInfo || {}),
                        orderId: undefined,
                        soldDate: undefined,
                        customerPhone: undefined
                    };
                    track.history = track.history || [];
                    track.history.push({
                        status: "available",
                        date: new Date(),
                        notes: `Returned via ${ret.returnNumber} — warranty cleared until next sale`
                    });
                    await track.save({ session });
                }
            }

            const filter = {
                warehouseId: ret.warehouseId,
                productId: line.productId,
                isDeleted: { $ne: true }
            };
            if (line.productVariantId) {
                filter.productVariantId = line.productVariantId;
            } else {
                filter.$or = [
                    { productVariantId: null },
                    { productVariantId: { $exists: false } }
                ];
            }

            let inv = await Inventory.findOne(filter).session(session);
            if (!inv) {
                const [created] = await Inventory.create(
                    [
                        {
                            warehouseId: ret.warehouseId,
                            branchId: ret.branchId,
                            productId: line.productId,
                            productVariantId: line.productVariantId || null,
                            sku: line.sku || "",
                            productName: line.productName,
                            currentStock: 0,
                            availableStock: 0,
                            reservedStock: 0,
                            averageCost: line.unitPrice || 0
                        }
                    ],
                    { session }
                );
                inv = created;
            }

            const previous = Number(inv.currentStock) || 0;
            inv.currentStock = previous + qty;
            inv.availableStock = (Number(inv.availableStock) || 0) + qty;
            inv.inventoryValue =
                (Number(inv.averageCost) || line.unitPrice || 0) *
                inv.currentStock;
            await inv.save({ session });

            const movementNumber = await generateStockMovementCode();
            await StockMovement.create(
                [
                    {
                        movementNumber,
                        movementDate: new Date(),
                        warehouseId: ret.warehouseId,
                        branchId: ret.branchId,
                        productId: line.productId,
                        productVariantId: line.productVariantId || null,
                        sku: line.sku || "",
                        productName: line.productName,
                        movementType: "Sales Return",
                        movementDirection: "IN",
                        quantity: qty,
                        previousStock: previous,
                        currentStock: inv.currentStock,
                        unitCost: Number(inv.averageCost) || line.unitPrice || 0,
                        totalCost:
                            (Number(inv.averageCost) || line.unitPrice || 0) *
                            qty,
                        referenceType: "Sales Return",
                        salesReturnId: ret._id,
                        remarks: "Stock in from sales return",
                        createdBy:
                            actorId ||
                            ret.createdBy ||
                            new mongoose.Types.ObjectId()
                    }
                ],
                { session }
            );

            productIds.add(String(line.productId));
        }

        ret.status = "Received";
        ret.updatedBy = actorId || null;
        await ret.save({ session });

        if (ret.salesOrderId) {
            const order = await SalesOrder.findById(ret.salesOrderId).session(
                session
            );
            if (order) {
                for (const line of ret.items) {
                    const soLine = order.items.find(
                        (l) =>
                            String(l.productId) === String(line.productId) &&
                            String(l.productVariantId || "") ===
                                String(line.productVariantId || "")
                    );
                    if (soLine) {
                        soLine.returnedQuantity =
                            (Number(soLine.returnedQuantity) || 0) +
                            (Number(line.returnQuantity) || 0);
                    }
                }
                const fullyReturned = order.items.every(
                    (l) =>
                        (Number(l.returnedQuantity) || 0) >=
                        (Number(l.quantity) || 0)
                );
                order.hasReturn = true;
                order.returnId = ret._id;
                if (fullyReturned) {
                    order.internalNote = [
                        order.internalNote || "",
                        `Fully returned via ${ret.returnNumber}`
                    ]
                        .filter(Boolean)
                        .join("\n");
                }
                order.markModified("items");
                await order.save({ session });
            }
        }

        await session.commitTransaction();
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }

    for (const pid of productIds) {
        try {
            await productService.refreshStockSummary(pid);
        } catch (_) {
            /* ignore */
        }
    }

    return populateReturn(SalesReturn.findById(ret._id));
};

const getReturns = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    if (query.salesOrderId && toObjectId(query.salesOrderId)) {
        filter.salesOrderId = toObjectId(query.salesOrderId);
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populateReturn(
            SalesReturn.find(filter).sort(sort).skip(skip).limit(limit)
        ),
        SalesReturn.countDocuments(filter)
    ]);

    return {
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
        trash: trashMode
    };
};

const getReturnById = async (id) => {
    const doc = await populateReturn(
        SalesReturn.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Sales return not found.", 404);
    return doc;
};

/**
 * Lines still returnable on a sales order (qty + IMEIs left).
 */
const getReturnableFromOrder = async (salesOrderId) => {
    const id = toObjectId(salesOrderId);
    if (!id) throw new AppError("salesOrderId is required.", 400);

    const order = await SalesOrder.findOne({ _id: id, ...NOT_DELETED }).lean();
    if (!order) throw new AppError("Sales order not found.", 404);
    if (!order.stockUpdated) {
        throw new AppError(
            "Cannot return an order that never deducted stock.",
            400
        );
    }

    const { qtyByLine, returnedImeis } = await getPriorReturnUsage(id);

    const lines = [];
    for (const l of order.items || []) {
        const key = lineKey(l.productId, l.productVariantId);
        const already = Math.max(
            Number(l.returnedQuantity) || 0,
            qtyByLine.get(key) || 0
        );
        const remaining = Math.max(Number(l.quantity) - already, 0);
        if (remaining <= 0) continue;

        const trackingType =
            String(l.trackingType || "").toUpperCase().includes("IMEI") &&
            !String(l.trackingType || "").toUpperCase().includes("NON")
                ? "IMEI"
                : "Non-IMEI";

        const availableImeis = (l.imeis || [])
            .map((e) => String(e).trim())
            .filter((e) => e && !returnedImeis.has(e));

        lines.push({
            productId: l.productId,
            productVariantId: l.productVariantId || null,
            sku: l.sku || "",
            productName: l.productName,
            trackingType,
            soldQuantity: Number(l.quantity) || 0,
            alreadyReturned: already,
            returnableQuantity: remaining,
            unitPrice: Number(l.unitPrice) || 0,
            availableImeis:
                trackingType === "IMEI" ? availableImeis.slice(0, remaining) : []
        });
    }

    return {
        salesOrderId: order._id,
        orderNumber: order.orderNumber,
        customerName: order.customerName || "",
        stockUpdated: order.stockUpdated,
        fullyReturned: lines.length === 0,
        lines
    };
};

const getReturnStats = async () => {
    const [rows, trashCount] = await Promise.all([
        SalesReturn.aggregate([
            { $match: { ...NOT_DELETED } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    amount: { $sum: "$refundAmount" }
                }
            }
        ]),
        trash.trashCount()
    ]);

    const stats = {
        total: 0,
        draft: 0,
        pendingApproval: 0,
        approved: 0,
        received: 0,
        refunded: 0,
        rejected: 0,
        cancelled: 0,
        totalAmount: 0,
        trashCount
    };

    rows.forEach((row) => {
        stats.total += row.count;
        stats.totalAmount += row.amount || 0;
        switch (row._id) {
            case "Draft":
                stats.draft = row.count;
                break;
            case "Pending Approval":
                stats.pendingApproval = row.count;
                break;
            case "Approved":
                stats.approved = row.count;
                break;
            case "Received":
                stats.received = row.count;
                break;
            case "Refunded":
                stats.refunded = row.count;
                break;
            case "Rejected":
                stats.rejected = row.count;
                break;
            case "Cancelled":
                stats.cancelled = row.count;
                break;
            default:
                break;
        }
    });

    return stats;
};

const deleteSalesReturn = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreSalesReturn = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteSalesReturn = (id) => trash.permanentDelete(id);
const bulkDeleteSalesReturns = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreSalesReturns = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteSalesReturns = (payload) =>
    trash.bulkPermanentDelete(payload);

module.exports = {
    createFromSalesOrder,
    receiveReturn,
    getReturns,
    getReturnById,
    getReturnableFromOrder,
    getReturnStats,
    deleteSalesReturn,
    restoreSalesReturn,
    permanentDeleteSalesReturn,
    bulkDeleteSalesReturns,
    bulkRestoreSalesReturns,
    bulkPermanentDeleteSalesReturns
};
