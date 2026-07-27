const mongoose = require("mongoose");
const SalesOrder = require("../model/salesOrder");
const Customer = require("../model/customer");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const {
    generateSalesOrderCode,
    generateStockMovementCode
} = require("./codeGenerator");
const productService = require("./productService");
const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };
const EDITABLE_STATUSES = ["Draft", "Pending Approval"];

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveTrackingType = (value) =>
    String(value || "").toUpperCase().includes("IMEI") &&
    !String(value || "").toUpperCase().includes("NON")
        ? "IMEI"
        : "Non-IMEI";

const populateSo = (query) =>
    query
        .populate("branchId", "name code city branchCode")
        .populate("warehouseId", "warehouseCode warehouseName city status")
        .populate(
            "customerId",
            "customerCode name companyName phone email status paymentTerms creditLimit"
        )
        .populate(
            "items.productId",
            "name productCode trackingType productType totalStock availableStock sellingPrice"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString sellingPrice attributes quantity"
        )
        .populate("approvedBy", "name email")
        .populate("createdBy", "name email");

const calculateLines = (items = [], header = {}) => {
    let subtotal = 0;
    const normalized = items.map((raw) => {
        const quantity = Math.max(Number(raw.quantity) || 0, 0);
        const unitPrice = Math.max(Number(raw.unitPrice) || 0, 0);
        const discount = Math.max(Number(raw.discount) || 0, 0);
        const tax = Math.max(Number(raw.tax) || 0, 0);
        const deliveredQuantity = Math.max(Number(raw.deliveredQuantity) || 0, 0);
        const total = quantity * unitPrice - discount + tax;
        subtotal += total;
        return {
            ...raw,
            quantity,
            unitPrice,
            discount,
            tax,
            total,
            deliveredQuantity,
            pendingQuantity: Math.max(quantity - deliveredQuantity, 0)
        };
    });

    const discount = Math.max(Number(header.discount) || 0, 0);
    const tax = Math.max(Number(header.tax) || 0, 0);
    const shippingCost = Math.max(Number(header.shippingCost) || 0, 0);
    const otherCharges = Math.max(Number(header.otherCharges) || 0, 0);
    const paidAmount = Math.max(Number(header.paidAmount) || 0, 0);

    const grandTotal = subtotal - discount + tax + shippingCost + otherCharges;
    const dueAmount = Math.max(grandTotal - paidAmount, 0);

    let paymentStatus = "Pending";
    if (paidAmount <= 0) paymentStatus = "Pending";
    else if (paidAmount < grandTotal) paymentStatus = "Partial";
    else paymentStatus = "Paid";

    return {
        items: normalized,
        subtotal,
        discount,
        tax,
        shippingCost,
        otherCharges,
        paidAmount,
        grandTotal,
        dueAmount,
        paymentStatus
    };
};

const normalizeItems = async (itemsInput = []) => {
    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
        throw new AppError("At least one sales line is required.", 400);
    }

    const items = [];

    for (const raw of itemsInput) {
        const productId = toObjectId(raw.productId);
        if (!productId) {
            throw new AppError("Every sales line requires a product.", 400);
        }

        const product = await Product.findOne({ _id: productId, ...NOT_DELETED });
        if (!product) {
            throw new AppError("One or more products were not found.", 404);
        }

        const productVariantId = toObjectId(raw.productVariantId);
        let variant = null;

        if (product.productType === "Variant" || product.hasVariants) {
            if (!productVariantId) {
                throw new AppError(
                    `Select a variant for "${product.name}".`,
                    400
                );
            }
            variant = await ProductVariant.findOne({
                _id: productVariantId,
                productId,
                isDeleted: { $ne: true }
            });
            if (!variant) {
                throw new AppError(
                    `Variant not found for "${product.name}".`,
                    404
                );
            }
        } else if (productVariantId) {
            variant = await ProductVariant.findOne({
                _id: productVariantId,
                productId,
                isDeleted: { $ne: true }
            });
        }

        const trackingType = resolveTrackingType(
            raw.trackingType || product.trackingType
        );
        const quantity = Math.max(Number(raw.quantity) || 0, 0);
        if (quantity <= 0) {
            throw new AppError(
                `Quantity must be greater than 0 for "${product.name}".`,
                400
            );
        }

        let imeis = Array.isArray(raw.imeis)
            ? raw.imeis.map((e) => String(e).trim()).filter(Boolean)
            : [];
        imeis = [...new Set(imeis)];

        if (trackingType === "IMEI") {
            if (imeis.length === 0) {
                throw new AppError(
                    `IMEI list required for "${product.name}".`,
                    400
                );
            }
            if (imeis.length !== quantity) {
                throw new AppError(
                    `IMEI count (${imeis.length}) must match quantity (${quantity}) for "${product.name}".`,
                    400
                );
            }
        }

        const unitPrice =
            Math.max(Number(raw.unitPrice) || 0, 0) ||
            Number(variant?.sellingPrice) ||
            Number(product.sellingPrice) ||
            0;

        items.push({
            productId,
            productVariantId: variant?._id || null,
            sku: (raw.sku || variant?.sku || "").toString().trim(),
            productName:
                (raw.productName || product.name || "").toString().trim() ||
                product.name,
            quantity,
            deliveredQuantity: 0,
            pendingQuantity: quantity,
            unitId: toObjectId(raw.unitId),
            unitPrice,
            discount: Math.max(Number(raw.discount) || 0, 0),
            tax: Math.max(Number(raw.tax) || 0, 0),
            total: 0,
            remarks: (raw.remarks || "").toString(),
            trackingType,
            imeis: trackingType === "IMEI" ? imeis : []
        });
    }

    return items;
};

const resolveHeaderRefs = async (payload) => {
    const customerId = toObjectId(payload.customerId);
    const warehouseId = toObjectId(payload.warehouseId);
    const branchId = toObjectId(payload.branchId);

    if (!customerId) throw new AppError("Customer is required.", 400);
    if (!warehouseId) throw new AppError("Warehouse is required.", 400);
    if (!branchId) throw new AppError("Branch is required.", 400);

    const [customer, warehouse, branch] = await Promise.all([
        Customer.findOne({ _id: customerId, isDeleted: false }),
        Warehouse.findOne({ _id: warehouseId, ...NOT_DELETED }),
        Branch.findOne({ _id: branchId, ...NOT_DELETED })
    ]);

    if (!customer) throw new AppError("Customer not found.", 404);
    if (customer.status === "Blocked") {
        throw new AppError("Cannot sell to a blocked customer.", 400);
    }
    if (!warehouse) throw new AppError("Warehouse not found.", 404);
    if (!branch) throw new AppError("Branch not found.", 404);

    return { customer, warehouse, branch, customerId, warehouseId, branchId };
};

const findOrderOrFail = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid sales order id.", 400);
    }
    const order = await SalesOrder.findOne({ _id: id, ...NOT_DELETED });
    if (!order) throw new AppError("Sales order not found.", 404);
    return order;
};

const createSalesOrder = async (payload, actorId = null) => {
    const refs = await resolveHeaderRefs(payload);
    const items = await normalizeItems(payload.items);
    const totals = calculateLines(items, payload);
    const orderNumber = await generateSalesOrderCode();

    const order = await SalesOrder.create({
        branchId: refs.branchId,
        warehouseId: refs.warehouseId,
        orderNumber,
        referenceNumber: (payload.referenceNumber || "").toString().trim(),
        orderDate: payload.orderDate ? new Date(payload.orderDate) : new Date(),
        expectedDeliveryDate: payload.expectedDeliveryDate
            ? new Date(payload.expectedDeliveryDate)
            : undefined,
        customerId: refs.customerId,
        customerName: refs.customer.name,
        customerPhone: refs.customer.phone || "",
        customerEmail: refs.customer.email || "",
        items: totals.items,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        shippingCost: totals.shippingCost,
        otherCharges: totals.otherCharges,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paidAmount,
        dueAmount: totals.dueAmount,
        paymentStatus: totals.paymentStatus,
        paymentMethod: payload.paymentMethod || "Cash",
        deliveryAddress:
            payload.deliveryAddress || refs.customer.address || "",
        customerNote: payload.customerNote || "",
        internalNote: payload.internalNote || "",
        status: "Draft",
        createdBy: actorId || null
    });

    return populateSo(SalesOrder.findById(order._id));
};

const getSalesOrders = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.customerId && toObjectId(query.customerId)) {
        filter.customerId = toObjectId(query.customerId);
    }
    if (query.warehouseId && toObjectId(query.warehouseId)) {
        filter.warehouseId = toObjectId(query.warehouseId);
    }
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }
    if (query.search) {
        const search = query.search.trim();
        filter.$or = [
            { orderNumber: { $regex: escapeRegex(search), $options: "i" } },
            { customerName: { $regex: escapeRegex(search), $options: "i" } },
            { referenceNumber: { $regex: escapeRegex(search), $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        populateSo(
            SalesOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        ),
        SalesOrder.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
};

const getSalesOrderById = async (id) => {
    const order = await populateSo(
        SalesOrder.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!order) throw new AppError("Sales order not found.", 404);
    return order;
};

const updateSalesOrder = async (id, payload, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!EDITABLE_STATUSES.includes(order.status)) {
        throw new AppError(
            `Cannot edit a sales order in "${order.status}" status.`,
            400
        );
    }

    if (payload.customerId || payload.warehouseId || payload.branchId) {
        const refs = await resolveHeaderRefs({
            customerId: payload.customerId || order.customerId,
            warehouseId: payload.warehouseId || order.warehouseId,
            branchId: payload.branchId || order.branchId
        });
        order.customerId = refs.customerId;
        order.warehouseId = refs.warehouseId;
        order.branchId = refs.branchId;
        order.customerName = refs.customer.name;
        order.customerPhone = refs.customer.phone || "";
        order.customerEmail = refs.customer.email || "";
    }

    if (payload.items) {
        const items = await normalizeItems(payload.items);
        const totals = calculateLines(items, {
            discount: payload.discount ?? order.discount,
            tax: payload.tax ?? order.tax,
            shippingCost: payload.shippingCost ?? order.shippingCost,
            otherCharges: payload.otherCharges ?? order.otherCharges,
            paidAmount: payload.paidAmount ?? order.paidAmount
        });
        order.items = totals.items;
        order.subtotal = totals.subtotal;
        order.discount = totals.discount;
        order.tax = totals.tax;
        order.shippingCost = totals.shippingCost;
        order.otherCharges = totals.otherCharges;
        order.paidAmount = totals.paidAmount;
        order.grandTotal = totals.grandTotal;
        order.dueAmount = totals.dueAmount;
        order.paymentStatus = totals.paymentStatus;
    } else if (
        payload.discount !== undefined ||
        payload.tax !== undefined ||
        payload.shippingCost !== undefined ||
        payload.otherCharges !== undefined ||
        payload.paidAmount !== undefined
    ) {
        const totals = calculateLines(order.items, {
            discount: payload.discount ?? order.discount,
            tax: payload.tax ?? order.tax,
            shippingCost: payload.shippingCost ?? order.shippingCost,
            otherCharges: payload.otherCharges ?? order.otherCharges,
            paidAmount: payload.paidAmount ?? order.paidAmount
        });
        order.subtotal = totals.subtotal;
        order.discount = totals.discount;
        order.tax = totals.tax;
        order.shippingCost = totals.shippingCost;
        order.otherCharges = totals.otherCharges;
        order.paidAmount = totals.paidAmount;
        order.grandTotal = totals.grandTotal;
        order.dueAmount = totals.dueAmount;
        order.paymentStatus = totals.paymentStatus;
    }

    if (payload.referenceNumber !== undefined) {
        order.referenceNumber = String(payload.referenceNumber || "").trim();
    }
    if (payload.orderDate) order.orderDate = new Date(payload.orderDate);
    if (payload.expectedDeliveryDate) {
        order.expectedDeliveryDate = new Date(payload.expectedDeliveryDate);
    }
    if (payload.paymentMethod) order.paymentMethod = payload.paymentMethod;
    if (payload.deliveryAddress !== undefined) {
        order.deliveryAddress = String(payload.deliveryAddress || "");
    }
    if (payload.customerNote !== undefined) {
        order.customerNote = String(payload.customerNote || "");
    }
    if (payload.internalNote !== undefined) {
        order.internalNote = String(payload.internalNote || "");
    }

    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const deleteSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!EDITABLE_STATUSES.includes(order.status) && order.status !== "Cancelled") {
        throw new AppError(
            `Cannot delete a sales order in "${order.status}" status.`,
            400
        );
    }
    order.isDeleted = true;
    order.deletedAt = new Date();
    order.deletedBy = actorId || null;
    await order.save();
    return order;
};

const submitSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (order.status !== "Draft") {
        throw new AppError("Only Draft orders can be submitted.", 400);
    }
    if (!order.items?.length) {
        throw new AppError("Add at least one line before submit.", 400);
    }
    order.status = "Pending Approval";
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const approveSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!["Draft", "Pending Approval"].includes(order.status)) {
        throw new AppError(
            `Cannot approve a sales order in "${order.status}" status.`,
            400
        );
    }
    order.status = "Approved";
    order.approvedBy = actorId || null;
    order.approvedAt = new Date();
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const cancelSalesOrder = async (id, actorId = null, reason = "") => {
    const order = await findOrderOrFail(id);
    if (["Completed", "Cancelled"].includes(order.status)) {
        throw new AppError(
            `Cannot cancel a sales order in "${order.status}" status.`,
            400
        );
    }
    if (order.stockUpdated) {
        throw new AppError(
            "Stock already deducted. Cancel is blocked — use Sales Return later.",
            400
        );
    }
    order.status = "Cancelled";
    order.cancelledBy = actorId || null;
    order.cancelledAt = new Date();
    if (order.internalNote) {
        order.internalNote = `${order.internalNote}\nCancel: ${reason || ""}`.trim();
    } else if (reason) {
        order.internalNote = `Cancel: ${reason}`;
    }
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const findInventoryRow = async ({
    warehouseId,
    productId,
    productVariantId,
    session
}) => {
    const filter = {
        warehouseId,
        productId,
        isDeleted: { $ne: true }
    };
    if (productVariantId) {
        filter.productVariantId = productVariantId;
    } else {
        filter.$or = [
            { productVariantId: null },
            { productVariantId: { $exists: false } }
        ];
    }

    return Inventory.findOne(filter).session(session || null);
};

const deductInventory = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    sku,
    productName,
    qty,
    unitCost,
    salesOrderId,
    actorId,
    orderCreatedBy,
    session
}) => {
    const inv = await findInventoryRow({
        warehouseId,
        productId,
        productVariantId,
        session
    });

    if (!inv) {
        throw new AppError(
            `No inventory for "${productName}" in this warehouse.`,
            400
        );
    }

    const available = Number(inv.availableStock) || 0;
    const current = Number(inv.currentStock) || 0;
    if (available < qty) {
        throw new AppError(
            `Insufficient stock for "${productName}". Available: ${available}, required: ${qty}.`,
            400
        );
    }

    const previous = current;
    inv.currentStock = Math.max(current - qty, 0);
    inv.availableStock = Math.max(available - qty, 0);
    inv.inventoryValue =
        (Number(inv.averageCost) || unitCost || 0) * inv.currentStock;
    inv.lastMovementDate = new Date();
    await inv.save({ session });

    const movementNumber = await generateStockMovementCode();
    const [movement] = await StockMovement.create(
        [
            {
                movementNumber,
                movementDate: new Date(),
                warehouseId,
                branchId: branchId || null,
                productId,
                productVariantId: productVariantId || null,
                sku: sku || "",
                productName,
                movementType: "Sale",
                movementDirection: "OUT",
                quantity: qty,
                previousStock: previous,
                currentStock: inv.currentStock,
                unitCost: Number(inv.averageCost) || unitCost || 0,
                totalCost:
                    (Number(inv.averageCost) || unitCost || 0) * qty,
                referenceType: "Sales Order",
                salesOrderId,
                remarks: "Stock out from Sales Order confirm",
                createdBy: actorId || orderCreatedBy || new mongoose.Types.ObjectId()
            }
        ],
        { session }
    );

    return { inv, movement };
};

const markImeisSold = async ({
    productId,
    variantId,
    imeis,
    salesOrderId,
    session
}) => {
    for (const imei of imeis) {
        const track = await ItemTrack.findOne({
            productId,
            ...(variantId ? { variantId } : {}),
            imei,
            status: "available"
        }).session(session || null);

        if (!track) {
            throw new AppError(
                `IMEI ${imei} is not available in inventory.`,
                400
            );
        }

        track.status = "sold";
        track.saleInfo = {
            ...(track.saleInfo || {}),
            orderId: salesOrderId,
            soldDate: new Date()
        };
        track.history = track.history || [];
        track.history.push({
            status: "sold",
            date: new Date(),
            notes: "Sold via Sales Order"
        });
        await track.save({ session });
    }
};

/**
 * Confirm = lock order + deduct warehouse stock (ERP stock OUT).
 * Accepts Draft / Pending Approval / Approved.
 */
const confirmSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);

    if (order.stockUpdated) {
        throw new AppError("Stock already deducted for this order.", 400);
    }
    if (["Completed", "Cancelled", "Confirmed", "Processing"].includes(order.status)) {
        if (order.status === "Confirmed" || order.status === "Processing") {
            throw new AppError("Sales order is already confirmed.", 400);
        }
        throw new AppError(
            `Cannot confirm a sales order in "${order.status}" status.`,
            400
        );
    }
    if (!order.items?.length) {
        throw new AppError("Sales order has no lines.", 400);
    }
    if (!order.warehouseId) {
        throw new AppError("Warehouse is required to confirm sale.", 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    const movementIds = [];
    const productIds = new Set();

    try {
        for (const line of order.items) {
            const qty = Number(line.quantity) || 0;
            if (qty <= 0) continue;

            const trackingType = resolveTrackingType(line.trackingType);

            if (trackingType === "IMEI") {
                await markImeisSold({
                    productId: line.productId,
                    variantId: line.productVariantId,
                    imeis: line.imeis || [],
                    salesOrderId: order._id,
                    session
                });
            }

            const result = await deductInventory({
                warehouseId: order.warehouseId,
                branchId: order.branchId,
                productId: line.productId,
                productVariantId: line.productVariantId,
                sku: line.sku,
                productName: line.productName,
                qty,
                unitCost: line.unitPrice,
                salesOrderId: order._id,
                actorId,
                orderCreatedBy: order.createdBy,
                session
            });

            if (result.movement?._id) {
                movementIds.push(result.movement._id);
            }
            if (line.productId) {
                productIds.add(String(line.productId));
            }

            line.deliveredQuantity = qty;
            line.pendingQuantity = 0;
        }

        order.status = "Confirmed";
        order.deliveryStatus = "Processing";
        order.stockUpdated = true;
        order.stockUpdatedAt = new Date();
        order.stockMovementIds = movementIds;
        order.updatedBy = actorId || null;
        if (!order.approvedAt) {
            order.approvedBy = actorId || null;
            order.approvedAt = new Date();
        }

        await order.save({ session });
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
        } catch (e) {
            console.warn(
                "[SO] refreshStockSummary failed:",
                pid,
                e?.message || e
            );
        }
    }

    // Update customer sales totals (best effort)
    try {
        const customer = await Customer.findById(order.customerId);
        if (customer && typeof customer.updateBalance === "function") {
            await customer.updateBalance(order.grandTotal, order.paidAmount || 0);
        }
    } catch (_) {
        /* ignore */
    }

    return populateSo(SalesOrder.findById(order._id));
};

const completeSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!["Confirmed", "Processing"].includes(order.status)) {
        throw new AppError(
            `Only Confirmed/Processing orders can be completed.`,
            400
        );
    }
    if (!order.stockUpdated) {
        throw new AppError("Confirm the order (stock out) before complete.", 400);
    }
    order.status = "Completed";
    order.deliveryStatus = "Delivered";
    order.deliveryDate = new Date();
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const getSalesOrderStats = async () => {
    const [rows] = await SalesOrder.aggregate([
        { $match: NOT_DELETED },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                draft: {
                    $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] }
                },
                pending: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "Pending Approval"] }, 1, 0]
                    }
                },
                approved: {
                    $sum: { $cond: [{ $eq: ["$status", "Approved"] }, 1, 0] }
                },
                confirmed: {
                    $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] }
                },
                completed: {
                    $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] }
                },
                cancelled: {
                    $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] }
                },
                salesValue: { $sum: "$grandTotal" },
                dueAmount: { $sum: "$dueAmount" }
            }
        }
    ]);

    return (
        rows || {
            total: 0,
            draft: 0,
            pending: 0,
            approved: 0,
            confirmed: 0,
            completed: 0,
            cancelled: 0,
            salesValue: 0,
            dueAmount: 0
        }
    );
};

module.exports = {
    createSalesOrder,
    getSalesOrders,
    getSalesOrderById,
    updateSalesOrder,
    deleteSalesOrder,
    submitSalesOrder,
    approveSalesOrder,
    confirmSalesOrder,
    completeSalesOrder,
    cancelSalesOrder,
    getSalesOrderStats
};
