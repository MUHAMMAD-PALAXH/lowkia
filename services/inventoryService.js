/**
 * Inventory Service (read layer after GRN)
 * Stock increases only via GRN complete — this module is for viewing stock.
 */

const mongoose = require("mongoose");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const AppError = require("../utils/appError");

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

module.exports = {
    getInventoryList,
    getInventoryById,
    getInventoryStats,
    getLowStock,
    getStockMovements,
    getImeiStock
};
