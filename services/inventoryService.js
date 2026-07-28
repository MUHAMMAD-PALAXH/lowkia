/**
 * Inventory Service (read layer after GRN)
 * Stock increases only via GRN complete — this module is for viewing stock.
 */

const mongoose = require("mongoose");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const Product = require("../model/product");
const AppError = require("../utils/appError");
const { generateStockMovementCode } = require("./codeGenerator");

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateInventory = (query) =>
    query
        .populate("warehouseId", "warehouseCode warehouseName city")
        .populate("branchId", "branchCode name city")
        .populate(
            "productId",
            "name productCode sku barcode trackingType productType"
        )
        .populate("productVariantId", "sku combinationString attributes");

const populateMovement = (query) =>
    query
        .populate("warehouseId", "warehouseCode warehouseName")
        .populate("branchId", "branchCode name")
        .populate("productId", "name productCode trackingType")
        .populate("productVariantId", "sku combinationString")
        .populate("grnId", "grnNumber status")
        .populate("createdBy", "name email");

const getInventoryList = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { isDeleted: { $ne: true } };

    if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId);
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.productId) filter.productId = toObjectId(query.productId);
    if (query.stockStatus) filter.stockStatus = query.stockStatus;

    if (query.lowStock === "true" || query.lowStock === true) {
        filter.$or = [
            { stockStatus: "Low Stock" },
            { stockStatus: "Out Of Stock" },
            {
                $expr: {
                    $and: [
                        { $gt: ["$reorderLevel", 0] },
                        { $lte: ["$availableStock", "$reorderLevel"] }
                    ]
                }
            }
        ];
    }

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        // Search via populated fields needs aggregation OR pre-filter products.
        // Simple approach: match product names via $lookup later; for now use
        // sku-like fields if present on inventory, else rely on productId filter.
        filter.$or = [
            ...(filter.$or || []),
            { batchNumber: { $regex: search, $options: "i" } }
        ];
    }

    let itemsQuery = populateInventory(
        Inventory.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
    );
    let items = await itemsQuery.lean();

    // Client-side name filter when search provided
    if (query.search) {
        const s = String(query.search).trim().toLowerCase();
        items = items.filter((row) => {
            const name = (row.productId?.name || "").toLowerCase();
            const code = (row.productId?.productCode || "").toLowerCase();
            const sku = (
                row.productVariantId?.sku ||
                row.productId?.sku ||
                ""
            ).toLowerCase();
            const wh = (
                row.warehouseId?.warehouseName ||
                row.warehouseId?.warehouseCode ||
                ""
            ).toLowerCase();
            return (
                name.includes(s) ||
                code.includes(s) ||
                sku.includes(s) ||
                wh.includes(s)
            );
        });
    }

    const total = await Inventory.countDocuments(filter);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

const getInventoryById = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid inventory id.", 400);
    }
    const row = await populateInventory(
        Inventory.findOne({ _id: id, isDeleted: { $ne: true } })
    ).lean();
    if (!row) throw new AppError("Inventory record not found.", 404);
    return row;
};

const getInventoryStats = async () => {
    const [agg] = await Inventory.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
            $group: {
                _id: null,
                totalSkus: { $sum: 1 },
                totalQty: { $sum: "$currentStock" },
                availableQty: { $sum: "$availableStock" },
                reservedQty: { $sum: "$reservedStock" },
                inventoryValue: { $sum: "$inventoryValue" },
                lowStock: {
                    $sum: {
                        $cond: [{ $eq: ["$stockStatus", "Low Stock"] }, 1, 0]
                    }
                },
                outOfStock: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ["$stockStatus", "Out Of Stock"] },
                                    { $lte: ["$availableStock", 0] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const imeiAvailable = await ItemTrack.countDocuments({
        status: "available"
    });
    const imeiSold = await ItemTrack.countDocuments({ status: "sold" });
    const imeiInTransit = await ItemTrack.countDocuments({
        status: "in-transit"
    });

    return {
        totalSkus: agg?.totalSkus || 0,
        totalQty: agg?.totalQty || 0,
        availableQty: agg?.availableQty || 0,
        reservedQty: agg?.reservedQty || 0,
        inventoryValue: agg?.inventoryValue || 0,
        lowStock: agg?.lowStock || 0,
        outOfStock: agg?.outOfStock || 0,
        imeiAvailable,
        imeiSold,
        imeiInTransit
    };
};

const getLowStock = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const filter = {
        isDeleted: { $ne: true },
        $or: [
            { stockStatus: { $in: ["Low Stock", "Out Of Stock"] } },
            {
                $expr: {
                    $and: [
                        { $gt: ["$reorderLevel", 0] },
                        { $lte: ["$availableStock", "$reorderLevel"] }
                    ]
                }
            },
            { availableStock: { $lte: 0 } }
        ]
    };
    if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId);

    const items = await populateInventory(
        Inventory.find(filter).sort({ availableStock: 1 }).limit(limit)
    ).lean();

    return { items, total: items.length };
};

const getStockMovements = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = {};

    if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId);
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.productId) filter.productId = toObjectId(query.productId);
    if (query.movementType) filter.movementType = query.movementType;
    if (query.movementDirection) {
        filter.movementDirection = query.movementDirection;
    }
    if (query.grnId) filter.grnId = toObjectId(query.grnId);

    if (query.from || query.to) {
        filter.movementDate = {};
        if (query.from) filter.movementDate.$gte = new Date(query.from);
        if (query.to) filter.movementDate.$lte = new Date(query.to);
    }

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { movementNumber: { $regex: search, $options: "i" } },
            { productName: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        populateMovement(
            StockMovement.find(filter)
                .sort({ movementDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ).lean(),
        StockMovement.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

const getImeiStock = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = {};

    if (query.status) filter.status = query.status;
    else if (query.availableOnly === "true" || query.availableOnly === true) {
        filter.status = "available";
    }

    if (query.branchId) filter.currentBranchId = toObjectId(query.branchId);
    if (query.productId) filter.productId = toObjectId(query.productId);
    if (query.variantId || query.productVariantId) {
        filter.variantId = toObjectId(query.variantId || query.productVariantId);
    }

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.imei = { $regex: search, $options: "i" };
    }

    const [items, total] = await Promise.all([
        ItemTrack.find(filter)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("productId", "name productCode trackingType sku")
            .populate("variantId", "sku combinationString")
            .populate("currentBranchId", "branchCode name")
            .lean(),
        ItemTrack.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

/** Push Inventory totals onto Product.totalStock / stockValue for all stocked products */
const syncProductStockSummaries = async () => {
    const productService = require("./productService");
    const ids = await Inventory.distinct("productId", {
        isDeleted: { $ne: true },
        currentStock: { $gt: 0 }
    });
    let updated = 0;
    const errors = [];
    for (const id of ids) {
        if (!id) continue;
        try {
            await productService.refreshStockSummary(id);
            updated += 1;
        } catch (err) {
            errors.push(`${id}: ${err?.message || err}`);
        }
    }
    return { updated, total: ids.length, errors };
};

const clearProductStock = async (productId, actorId = null) => {
    const id = toObjectId(productId);
    if (!id) throw new AppError("Invalid product id.", 400);

    const product = await Product.findOne({
        _id: id,
        isDeleted: { $ne: true }
    });
    if (!product) throw new AppError("Product not found.", 404);

    const movementActorId = actorId || product.createdBy || product.vendorId || null;
    if (!movementActorId) {
        throw new AppError(
            "Cannot clear stock because no valid stock-movement actor could be resolved.",
            400
        );
    }

    const rows = await Inventory.find({
        productId: id,
        isDeleted: { $ne: true },
        currentStock: { $gt: 0 }
    });

    const reservedRow = rows.find((row) => Number(row.reservedStock) > 0);
    if (reservedRow) {
        throw new AppError(
            "Cannot clear stock while reserved stock exists for this product.",
            400
        );
    }

    const blockedImeiCount = await ItemTrack.countDocuments({
        productId: id,
        status: { $in: ["sold", "repairing", "in-transit"] }
    });
    if (blockedImeiCount > 0) {
        throw new AppError(
            `Cannot clear stock while ${blockedImeiCount} IMEI record(s) are sold, repairing, or in transit.`,
            400
        );
    }

    let clearedQty = 0;
    let clearedRows = 0;

    for (const row of rows) {
        const qty = Number(row.currentStock) || 0;
        if (qty <= 0) continue;

        const movementNumber = await generateStockMovementCode();
        await StockMovement.create({
            movementNumber,
            movementDate: new Date(),
            warehouseId: row.warehouseId,
            branchId: row.branchId || null,
            productId: row.productId,
            productVariantId: row.productVariantId || null,
            sku: "",
            productName: product.name || product.productCode || "Product",
            movementType: "Adjustment",
            movementDirection: "OUT",
            quantity: qty,
            previousStock: qty,
            currentStock: 0,
            unitCost: Number(row.averageCost) || Number(row.lastPurchasePrice) || 0,
            totalCost:
                (Number(row.averageCost) || Number(row.lastPurchasePrice) || 0) * qty,
            referenceType: "Manual",
            remarks: "Manual clear stock before product delete",
            adjustmentReason: "Clear Product Stock",
            createdBy: movementActorId
        });

        row.currentStock = 0;
        row.availableStock = 0;
        row.inventoryValue = 0;
        row.stockStatus = "Out Of Stock";
        await row.save();

        clearedQty += qty;
        clearedRows += 1;
    }

    const imeiResult = await ItemTrack.updateMany(
        {
            productId: id,
            status: "available"
        },
        {
            $set: {
                status: "deleted",
                currentBranchId: null
            },
            $push: {
                history: {
                    status: "deleted",
                    updatedBy: movementActorId,
                    date: new Date(),
                    notes: "Manual clear stock before product delete"
                }
            }
        }
    );

    const productService = require("./productService");
    await productService.refreshStockSummary(id);

    return {
        productId: String(id),
        productName: product.name || "",
        clearedRows,
        clearedQty,
        clearedImeis: imeiResult.modifiedCount || 0
    };
};

module.exports = {
    getInventoryList,
    getInventoryById,
    getInventoryStats,
    getLowStock,
    getStockMovements,
    getImeiStock,
    syncProductStockSummaries,
    clearProductStock
};
