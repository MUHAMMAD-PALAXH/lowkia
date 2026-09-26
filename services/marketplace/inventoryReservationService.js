const mongoose = require("mongoose");
const Inventory = require("../../model/inventory");
const StockMovement = require("../../model/StockMovement");
const Product = require("../../model/product");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const AppError = require("../../utils/appError");
const { NOT_DELETED } = require("../../constants/marketplace");
const { generateStockMovementCode } = require("../codeGenerator");
const { applyStockStatus } = require("../inventoryService");
const productService = require("../productService");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

/** Sellable qty — heal rows where availableStock drifted below current−reserved. */
const effectiveAvailable = (inv) => {
    const avail = Math.max(Number(inv?.availableStock) || 0, 0);
    const current = Math.max(Number(inv?.currentStock) || 0, 0);
    const reserved = Math.max(Number(inv?.reservedStock) || 0, 0);
    const derived = Math.max(current - reserved, 0);
    return Math.max(avail, derived);
};

/** Tenant match: stamped company OR legacy unscoped inventory for this product. */
const companyScope = (companyId) => {
    const cid = toObjectId(companyId);
    return {
        $or: [
            ...(cid ? [{ companyId: cid }] : []),
            { companyId: null },
            { companyId: { $exists: false } },
        ],
    };
};

const buildInventoryFilter = ({
    companyId,
    productId,
    productVariantId,
    variantMode = "exact",
}) => {
    const filter = {
        productId: toObjectId(productId),
        isDeleted: { $ne: true },
        ...companyScope(companyId),
    };

    const variantId = toObjectId(productVariantId);
    if (variantMode === "exact" && variantId) {
        filter.productVariantId = variantId;
    } else if (variantMode === "null") {
        filter.$and = [
            ...(filter.$and || []),
            {
                $or: [
                    { productVariantId: null },
                    { productVariantId: { $exists: false } },
                ],
            },
        ];
    }
    // variantMode === "any" → no productVariantId constraint
    return filter;
};

const pickInventoryRow = async ({
    companyId,
    productId,
    productVariantId,
    qty,
    session,
    variantMode,
}) => {
    const rows = await Inventory.find(
        buildInventoryFilter({
            companyId,
            productId,
            productVariantId,
            variantMode,
        })
    )
        .sort({ availableStock: -1, currentStock: -1 })
        .session(session || null);

    return (
        rows.find((row) => effectiveAvailable(row) >= qty) || null
    );
};

const findInventoryWithStock = async ({
    companyId,
    productId,
    productVariantId,
    qty,
    session,
}) => {
    const variantId = toObjectId(productVariantId);

    // 1) Exact variant (or null-variant when no id)
    let inv = await pickInventoryRow({
        companyId,
        productId,
        productVariantId,
        qty,
        session,
        variantMode: variantId ? "exact" : "null",
    });
    if (inv) return inv;

    // 2) Simple/legacy stock under null variant while line carries a default id
    if (variantId) {
        inv = await pickInventoryRow({
            companyId,
            productId,
            productVariantId,
            qty,
            session,
            variantMode: "null",
        });
        if (inv) return inv;
    }

    // 3) Any warehouse row for this product (matches Admin total stock view)
    return pickInventoryRow({
        companyId,
        productId,
        productVariantId,
        qty,
        session,
        variantMode: "any",
    });
};

/** Sum available stock across warehouses for a product/variant. */
const sumAvailableStock = async ({
    companyId,
    productId,
    productVariantId,
    session,
}) => {
    const variantId = toObjectId(productVariantId);
    let rows = await Inventory.find(
        buildInventoryFilter({
            companyId,
            productId,
            productVariantId,
            variantMode: variantId ? "exact" : "null",
        })
    )
        .session(session || null)
        .lean();

    let total = rows.reduce((sum, row) => sum + effectiveAvailable(row), 0);
    if (total > 0) return total;

    if (variantId) {
        rows = await Inventory.find(
            buildInventoryFilter({
                companyId,
                productId,
                productVariantId,
                variantMode: "null",
            })
        )
            .session(session || null)
            .lean();
        total = rows.reduce((sum, row) => sum + effectiveAvailable(row), 0);
        if (total > 0) return total;
    }

    rows = await Inventory.find(
        buildInventoryFilter({
            companyId,
            productId,
            productVariantId,
            variantMode: "any",
        })
    )
        .session(session || null)
        .lean();

    return rows.reduce((sum, row) => sum + effectiveAvailable(row), 0);
};

const reserveInventoryLine = async ({
    companyId,
    companyOrderId,
    companyOrderNumber,
    productId,
    productVariantId,
    productName,
    sku,
    qty,
    session,
    createdBy = null,
}) => {
    const quantity = Math.max(Number(qty) || 0, 0);
    if (!quantity) return null;

    const actorId = toObjectId(createdBy);
    if (!actorId) {
        throw new AppError(
            "Inventory reservation requires a createdBy actor.",
            500
        );
    }

    let inv = await findInventoryWithStock({
        companyId,
        productId,
        productVariantId,
        qty: quantity,
        session,
    });

    if (!inv) {
        const product = await Product.findOne({
            _id: toObjectId(productId),
            companyId: toObjectId(companyId),
            isDeleted: { $ne: true },
        }).session(session || null);

        if (product?.allowBackorder) {
            return {
                productId,
                productVariantId,
                quantity,
                backordered: true,
                warehouseId: null,
            };
        }

        const availableTotal = await sumAvailableStock({
            companyId,
            productId,
            productVariantId,
            session,
        });

        throw new AppError(
            `Insufficient stock for "${productName}". Available: ${availableTotal}, required: ${quantity}.`,
            400
        );
    }

    if (!inv.warehouseId) {
        throw new AppError(
            `Inventory for "${productName}" is missing a warehouse.`,
            400
        );
    }

    const available = effectiveAvailable(inv);
    const reserved = Number(inv.reservedStock) || 0;
    const current = Number(inv.currentStock) || 0;

    if (available < quantity) {
        throw new AppError(
            `Insufficient stock for "${productName}". Available: ${available}, required: ${quantity}.`,
            400
        );
    }

    // Heal drifted availableStock and stamp legacy tenant before reserving.
    if (!inv.companyId && companyId) {
        inv.companyId = toObjectId(companyId);
    }
    inv.availableStock = Math.max(available - quantity, 0);
    inv.reservedStock = reserved + quantity;
    inv.lastMovementDate = new Date();
    applyStockStatus(inv);
    await inv.save({ session });

    const movementNumber = await generateStockMovementCode({ session });
    await StockMovement.create(
        [
            {
                movementNumber,
                movementDate: new Date(),
                companyId: toObjectId(companyId),
                warehouseId: inv.warehouseId,
                branchId: inv.branchId || null,
                productId: toObjectId(productId),
                productVariantId: toObjectId(productVariantId) || null,
                sku: sku || "",
                productName,
                movementType: "Adjustment",
                movementDirection: "OUT",
                quantity,
                previousStock: current,
                currentStock: current,
                unitCost: Number(inv.averageCost) || 0,
                totalCost: (Number(inv.averageCost) || 0) * quantity,
                referenceType: "Marketplace Order",
                referenceId: toObjectId(companyOrderId),
                remarks: `Marketplace reservation for ${companyOrderNumber} (available→reserved)`,
                createdBy: actorId,
            },
        ],
        { session }
    );

    return {
        productId,
        productVariantId,
        quantity,
        warehouseId: inv.warehouseId,
        inventoryId: inv._id,
        backordered: false,
    };
};

const releaseInventoryLine = async ({
    companyId,
    companyOrderId,
    companyOrderNumber,
    productId,
    productVariantId,
    productName,
    sku,
    qty,
    session,
    createdBy = null,
}) => {
    const quantity = Math.max(Number(qty) || 0, 0);
    if (!quantity) return null;

    const actorId = toObjectId(createdBy);
    if (!actorId) {
        throw new AppError(
            "Inventory release requires a createdBy actor.",
            500
        );
    }

    const filter = {
        companyId: toObjectId(companyId),
        productId: toObjectId(productId),
        isDeleted: { $ne: true },
        reservedStock: { $gte: quantity },
    };
    const variantId = toObjectId(productVariantId);
    if (variantId) filter.productVariantId = variantId;

    const inv = await Inventory.findOne(filter)
        .sort({ reservedStock: -1 })
        .session(session || null);

    if (!inv) {
        throw new AppError(
            `Cannot release reservation for "${productName}" — reserved stock not found.`,
            400
        );
    }

    if (!inv.warehouseId) {
        throw new AppError(
            `Inventory for "${productName}" is missing a warehouse.`,
            400
        );
    }

    const available = Number(inv.availableStock) || 0;
    const reserved = Number(inv.reservedStock) || 0;
    const current = Number(inv.currentStock) || 0;

    inv.availableStock = available + quantity;
    inv.reservedStock = Math.max(reserved - quantity, 0);
    inv.lastMovementDate = new Date();
    applyStockStatus(inv);
    await inv.save({ session });

    const movementNumber = await generateStockMovementCode({ session });
    await StockMovement.create(
        [
            {
                movementNumber,
                movementDate: new Date(),
                companyId: toObjectId(companyId),
                warehouseId: inv.warehouseId,
                branchId: inv.branchId || null,
                productId: toObjectId(productId),
                productVariantId: toObjectId(productVariantId) || null,
                sku: sku || "",
                productName,
                movementType: "Adjustment",
                movementDirection: "IN",
                quantity,
                previousStock: current,
                currentStock: current,
                unitCost: Number(inv.averageCost) || 0,
                totalCost: (Number(inv.averageCost) || 0) * quantity,
                referenceType: "Marketplace Order",
                referenceId: toObjectId(companyOrderId),
                remarks: `Marketplace reservation release for ${companyOrderNumber} (reserved→available)`,
                createdBy: actorId,
            },
        ],
        { session }
    );

    return {
        productId,
        productVariantId,
        quantity,
        warehouseId: inv.warehouseId,
        inventoryId: inv._id,
    };
};

const syncProductsForLines = async (lines = []) => {
    const productIds = [
        ...new Set(lines.map((line) => String(line.product?.productId)).filter(Boolean)),
    ];

    for (const productId of productIds) {
        await productService.refreshStockSummary(productId);
    }
};

const reserveCompanyOrderInventory = async (companyOrder, session) => {
    if (companyOrder.inventoryReservedAt) {
        return { companyOrderId: companyOrder._id, alreadyReserved: true, lines: [] };
    }

    const items = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const reservedLines = [];
    for (const item of items) {
        const result = await reserveInventoryLine({
            companyId: companyOrder.companyId,
            companyOrderId: companyOrder._id,
            companyOrderNumber: companyOrder.orderNumber,
            productId: item.product.productId,
            productVariantId: item.product.productVariantId,
            productName: item.product.productName,
            sku: item.product.sku,
            qty: item.quantity,
            session,
            createdBy: companyOrder.userId,
        });
        if (result) reservedLines.push(result);
    }

    companyOrder.inventoryReservedAt = new Date();
    await companyOrder.save({ session });

    return {
        companyOrderId: companyOrder._id,
        orderNumber: companyOrder.orderNumber,
        lines: reservedLines,
    };
};

const releaseCompanyOrderInventory = async (companyOrder, session) => {
    if (!companyOrder.inventoryReservedAt) {
        return { companyOrderId: companyOrder._id, released: false, lines: [] };
    }

    const items = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const releasedLines = [];
    for (const item of items) {
        const result = await releaseInventoryLine({
            companyId: companyOrder.companyId,
            companyOrderId: companyOrder._id,
            companyOrderNumber: companyOrder.orderNumber,
            productId: item.product.productId,
            productVariantId: item.product.productVariantId,
            productName: item.product.productName,
            sku: item.product.sku,
            qty: item.quantity,
            session,
            createdBy: companyOrder.userId,
        });
        if (result) releasedLines.push(result);
    }

    companyOrder.inventoryReservedAt = null;
    await companyOrder.save({ session });

    return {
        companyOrderId: companyOrder._id,
        orderNumber: companyOrder.orderNumber,
        lines: releasedLines,
    };
};

const reserveMasterOrderInventory = async (masterOrderId, session) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        ...NOT_DELETED,
    }).session(session || null);

    if (!masterOrder) {
        throw new AppError("Master order not found for inventory reservation.", 404);
    }

    if (masterOrder.inventoryReservedAt) {
        return { masterOrderId: masterOrder._id, alreadyReserved: true, companies: [] };
    }

    const companyOrders = await CompanyOrder.find({
        masterOrderId: masterOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const companies = [];
    const allLines = [];

    for (const companyOrder of companyOrders) {
        const result = await reserveCompanyOrderInventory(companyOrder, session);
        companies.push(result);
        allLines.push(...(result.lines || []));
    }

    masterOrder.inventoryReservedAt = new Date();
    await masterOrder.save({ session });

    return {
        masterOrderId: masterOrder._id,
        orderNumber: masterOrder.orderNumber,
        companies,
        lines: allLines,
    };
};

const releaseMasterOrderInventory = async (masterOrderId, session) => {
    const masterOrder = await MasterOrder.findOne({
        _id: toObjectId(masterOrderId),
        ...NOT_DELETED,
    }).session(session || null);

    if (!masterOrder) {
        throw new AppError("Master order not found for inventory release.", 404);
    }

    if (!masterOrder.inventoryReservedAt) {
        return { masterOrderId: masterOrder._id, released: false, companies: [] };
    }

    const companyOrders = await CompanyOrder.find({
        masterOrderId: masterOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const companies = [];
    for (const companyOrder of companyOrders) {
        companies.push(await releaseCompanyOrderInventory(companyOrder, session));
    }

    masterOrder.inventoryReservedAt = null;
    await masterOrder.save({ session });

    return {
        masterOrderId: masterOrder._id,
        orderNumber: masterOrder.orderNumber,
        companies,
    };
};

const fulfillReservedInventoryLine = async ({
    companyId,
    companyOrderId,
    companyOrderNumber,
    productId,
    productVariantId,
    productName,
    sku,
    qty,
    session,
    createdBy = null,
}) => {
    const quantity = Math.max(Number(qty) || 0, 0);
    if (!quantity) return null;

    const actorId = toObjectId(createdBy);
    if (!actorId) {
        throw new AppError(
            "Inventory fulfillment requires a createdBy actor.",
            500
        );
    }

    const filter = {
        companyId: toObjectId(companyId),
        productId: toObjectId(productId),
        isDeleted: { $ne: true },
        reservedStock: { $gte: quantity },
    };
    const variantId = toObjectId(productVariantId);
    if (variantId) filter.productVariantId = variantId;

    const inv = await Inventory.findOne(filter)
        .sort({ reservedStock: -1 })
        .session(session || null);

    if (!inv) {
        throw new AppError(
            `Cannot fulfill shipment for "${productName}" — reserved stock not found.`,
            400
        );
    }

    if (!inv.warehouseId) {
        throw new AppError(
            `Inventory for "${productName}" is missing a warehouse.`,
            400
        );
    }

    const reserved = Number(inv.reservedStock) || 0;
    const current = Number(inv.currentStock) || 0;

    if (reserved < quantity || current < quantity) {
        throw new AppError(
            `Cannot fulfill shipment for "${productName}". Reserved: ${reserved}, current: ${current}, required: ${quantity}.`,
            400
        );
    }

    inv.reservedStock = Math.max(reserved - quantity, 0);
    inv.currentStock = Math.max(current - quantity, 0);
    inv.inventoryValue = (Number(inv.averageCost) || 0) * inv.currentStock;
    inv.lastMovementDate = new Date();
    applyStockStatus(inv);
    await inv.save({ session });

    const movementNumber = await generateStockMovementCode({ session });
    await StockMovement.create(
        [
            {
                movementNumber,
                movementDate: new Date(),
                companyId: toObjectId(companyId),
                warehouseId: inv.warehouseId,
                branchId: inv.branchId || null,
                productId: toObjectId(productId),
                productVariantId: toObjectId(productVariantId) || null,
                sku: sku || "",
                productName,
                movementType: "Sale",
                movementDirection: "OUT",
                quantity,
                previousStock: current,
                currentStock: inv.currentStock,
                unitCost: Number(inv.averageCost) || 0,
                totalCost: (Number(inv.averageCost) || 0) * quantity,
                referenceType: "Marketplace Order",
                referenceId: toObjectId(companyOrderId),
                remarks: `Marketplace shipment for ${companyOrderNumber} (reserved→out)`,
                createdBy: actorId,
            },
        ],
        { session }
    );

    return {
        productId,
        productVariantId,
        quantity,
        warehouseId: inv.warehouseId,
        inventoryId: inv._id,
    };
};

const releaseOrderItemReservation = async ({
    companyOrder,
    orderItem,
    qty,
    session,
}) => {
    const quantity = Math.max(Number(qty) || 0, 0);
    if (!quantity) return null;

    const result = await releaseInventoryLine({
        companyId: companyOrder.companyId,
        companyOrderId: companyOrder._id,
        companyOrderNumber: companyOrder.orderNumber,
        productId: orderItem.product.productId,
        productVariantId: orderItem.product.productVariantId,
        productName: orderItem.product.productName,
        sku: orderItem.product.sku,
        qty: quantity,
        session,
        createdBy: companyOrder.userId,
    });

    orderItem.refundedQuantity = (Number(orderItem.refundedQuantity) || 0) + quantity;
    await orderItem.save({ session });

    return result;
};

const releaseUnshippedCompanyInventory = async ({
    companyOrder,
    shippedQtyMap,
    lineQuantities = null,
    session,
}) => {
    const items = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const releasedLines = [];
    for (const item of items) {
        const shipped = shippedQtyMap.get(String(item._id)) || 0;
        const requested =
            lineQuantities?.get(String(item._id)) ??
            Math.max(0, item.quantity - shipped - (Number(item.refundedQuantity) || 0));

        if (requested <= 0) continue;

        const released = await releaseOrderItemReservation({
            companyOrder,
            orderItem: item,
            qty: requested,
            session,
        });
        if (released) releasedLines.push(released);
    }

    const remainingItems = await MarketplaceOrderItem.find({
        companyOrderId: companyOrder._id,
        ...NOT_DELETED,
    }).session(session || null);

    const hasOpenReservation = remainingItems.some((item) => {
        const shipped = shippedQtyMap.get(String(item._id)) || 0;
        return item.quantity - shipped - (Number(item.refundedQuantity) || 0) > 0;
    });

    if (!hasOpenReservation && companyOrder.inventoryReservedAt) {
        companyOrder.inventoryReservedAt = null;
        await companyOrder.save({ session });
    }

    return releasedLines;
};

module.exports = {
    reserveInventoryLine,
    releaseInventoryLine,
    releaseOrderItemReservation,
    releaseUnshippedCompanyInventory,
    fulfillReservedInventoryLine,
    reserveCompanyOrderInventory,
    releaseCompanyOrderInventory,
    reserveMasterOrderInventory,
    releaseMasterOrderInventory,
    syncProductsForLines,
};
