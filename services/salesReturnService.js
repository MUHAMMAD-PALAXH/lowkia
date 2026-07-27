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

const NOT_DELETED = { isDeleted: { $ne: true } };

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

    const items = [];
    let subtotal = 0;

    for (const raw of itemsInput) {
        const productId = toObjectId(raw.productId);
        const line = order.items.find(
            (l) =>
                String(l.productId) === String(productId) &&
                (!raw.productVariantId ||
                    String(l.productVariantId) ===
                        String(raw.productVariantId))
        );
        if (!line) {
            throw new AppError("Return line does not match sales order.", 400);
        }

        const returnQuantity = Math.max(Number(raw.returnQuantity) || 0, 0);
        if (returnQuantity <= 0) {
            throw new AppError("returnQuantity must be > 0.", 400);
        }
        if (returnQuantity > Number(line.quantity)) {
            throw new AppError(
                `Return qty exceeds sold qty for ${line.productName}.`,
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
        throw new AppError("Return already received.", 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    const productIds = new Set();

    try {
        for (const line of ret.items) {
            const qty = Number(line.returnQuantity) || 0;
            if (qty <= 0) continue;

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
                        createdBy: actorId || ret.createdBy || new mongoose.Types.ObjectId()
                    }
                ],
                { session }
            );

            if (line.trackingType === "IMEI") {
                for (const imei of line.imeis || []) {
                    const track = await ItemTrack.findOne({ imei }).session(
                        session
                    );
                    if (track) {
                        track.status = "available";
                        track.history = track.history || [];
                        track.history.push({
                            status: "available",
                            date: new Date(),
                            notes: `Returned via ${ret.returnNumber}`
                        });
                        await track.save({ session });
                    }
                }
            }

            productIds.add(String(line.productId));
        }

        ret.status = "Received";
        ret.updatedBy = actorId || null;
        await ret.save({ session });

        if (ret.salesOrderId) {
            await SalesOrder.updateOne(
                { _id: ret.salesOrderId },
                {
                    $set: {
                        hasReturn: true,
                        returnId: ret._id
                    }
                },
                { session }
            );
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
    const filter = { ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    if (query.salesOrderId && toObjectId(query.salesOrderId)) {
        filter.salesOrderId = toObjectId(query.salesOrderId);
    }

    const [items, total] = await Promise.all([
        populateReturn(
            SalesReturn.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        ),
        SalesReturn.countDocuments(filter)
    ]);

    return {
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
};

const getReturnById = async (id) => {
    const doc = await populateReturn(
        SalesReturn.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Sales return not found.", 404);
    return doc;
};

module.exports = {
    createFromSalesOrder,
    receiveReturn,
    getReturns,
    getReturnById
};
