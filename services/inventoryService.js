/**
 * Inventory Service (read layer after GRN)
 * Stock increases only via GRN complete — this module is for viewing stock
 * plus clear/sync helpers used by product trash.
 */

const mongoose = require("mongoose");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const Product = require("../model/product");
const AppError = require("../utils/appError");
const { generateStockMovementCode } = require("./codeGenerator");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");
const { writeActivityLog } = require("./activityLogService");
const {
    buildInventoryWorkbook,
    buildExportFilename,
    MAX_EXPORT_INVENTORY
} = require("./export/inventoryExcelExporter");

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One heal pass per company per process — materialize Manual/Vendor opening stock. */
const _manualStockHealedCompanies = new Set();

const ensureManualOpeningStockHealed = async (companyId) => {
    if (!companyId) return;
    const key = String(companyId);
    if (_manualStockHealedCompanies.has(key)) return;
    _manualStockHealedCompanies.add(key);
    try {
        const productService = require("./productService");
        if (typeof productService.backfillManualOpeningInventory === "function") {
            await productService.backfillManualOpeningInventory(companyId);
        }
    } catch (err) {
        _manualStockHealedCompanies.delete(key);
        console.error("Manual stock backfill failed:", err.message);
    }
};

/** Keep Inventory.stockStatus in sync after qty changes */
const computeStockStatus = (availableStock, reorderLevel = 0) => {
    const avail = Number(availableStock) || 0;
    const reorder = Number(reorderLevel) || 0;
    if (avail <= 0) return "Out Of Stock";
    if (reorder > 0 && avail <= reorder) return "Low Stock";
    return "In Stock";
};

const applyStockStatus = (inv) => {
    inv.stockStatus = computeStockStatus(
        inv.availableStock,
        inv.reorderLevel
    );
    return inv;
};

const populateInventory = (query) =>
    query
        .populate("warehouseId", "warehouseCode warehouseName city")
        .populate("branchId", "branchCode name city")
        .populate(
            "productId",
            "name productCode sku barcode trackingType productType productSourceType isDeleted"
        )
        .populate("productVariantId", "sku combinationString attributes");

const populateMovement = (query) =>
    query
        .populate("warehouseId", "warehouseCode warehouseName")
        .populate("branchId", "branchCode name")
        .populate("productId", "name productCode trackingType")
        .populate("productVariantId", "sku combinationString")
        .populate("grnId", "grnNumber status")
        .populate({
            path: "salesOrderId",
            select: "orderNumber customerId customerName customerPhone",
            populate: {
                path: "customerId",
                select: "customerCode name phone"
            }
        })
        .populate({
            path: "salesReturnId",
            select: "returnNumber customerId customerName customerPhone",
            populate: {
                path: "customerId",
                select: "customerCode name phone"
            }
        })
        .populate("createdBy", "name email");

const resolveSearchProductIds = async (search) => {
    const s = String(search || "").trim();
    if (!s) return null;
    const regex = { $regex: escapeRegex(s), $options: "i" };
    const products = await Product.find({
        isDeleted: { $ne: true },
        $or: [
            { name: regex },
            { productCode: regex },
            { sku: regex },
            { barcode: regex },
            { shortName: regex }
        ]
    })
        .select("_id")
        .lean();
    return products.map((p) => p._id);
};

/**
 * Live warehouse + IMEI totals for trash / clear decisions.
 * Always uses Inventory qty (not IMEI-overwritten product summary).
 */
const getLiveWarehouseStock = async (productId) => {
    const pid = toObjectId(productId);
    if (!pid) {
        return {
            invTotal: 0,
            invAvailable: 0,
            invReserved: 0,
            availableImei: 0,
            activeImei: 0,
            blockedImei: 0
        };
    }

    const [agg] = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: null,
                invTotal: { $sum: "$currentStock" },
                invAvailable: { $sum: "$availableStock" },
                invReserved: { $sum: "$reservedStock" }
            }
        }
    ]);

    const [availableImei, activeImei, blockedImei] = await Promise.all([
        ItemTrack.countDocuments({ productId: pid, status: "available" }),
        ItemTrack.countDocuments({
            productId: pid,
            status: { $ne: "deleted" }
        }),
        ItemTrack.countDocuments({
            productId: pid,
            status: { $in: ["sold", "repairing", "in-transit"] }
        })
    ]);

    return {
        invTotal: Number(agg?.invTotal) || 0,
        invAvailable: Number(agg?.invAvailable) || 0,
        invReserved: Number(agg?.invReserved) || 0,
        availableImei,
        activeImei,
        blockedImei
    };
};

const getInventoryList = async (query = {}, companyId = null) => {
    await ensureManualOpeningStockHealed(companyId);

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { isDeleted: { $ne: true }, ...companyFilter(companyId) };

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
        const productIds = await resolveSearchProductIds(query.search);
        const searchOr = [{ batchNumber: { $regex: search, $options: "i" } }];
        if (productIds && productIds.length) {
            searchOr.push({ productId: { $in: productIds } });
        }
        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
            delete filter.$or;
        } else {
            filter.$or = searchOr;
        }
    }

    const [items, total] = await Promise.all([
        populateInventory(
            Inventory.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
        ).lean(),
        Inventory.countDocuments(filter)
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

const getInventoryById = async (id, companyId = null) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid inventory id.", 400);
    }
    const tenant = companyFilter(companyId);
    const row = await populateInventory(
        Inventory.findOne({ _id: id, isDeleted: { $ne: true }, ...tenant })
    ).lean();
    if (!row) throw new AppError("Inventory record not found.", 404);
    assertDocumentCompany(row, companyId, "Inventory");
    return row;
};

const getInventoryStats = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const match = { isDeleted: { $ne: true }, ...tenant };
    if (query.warehouseId) match.warehouseId = toObjectId(query.warehouseId);

    const [agg] = await Inventory.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalSkus: { $sum: 1 },
                totalQty: { $sum: "$currentStock" },
                availableQty: { $sum: "$availableStock" },
                reservedQty: { $sum: "$reservedStock" },
                inventoryValue: {
                    $sum: {
                        $cond: [
                            { $gt: [{ $ifNull: ["$inventoryValue", 0] }, 0] },
                            { $ifNull: ["$inventoryValue", 0] },
                            {
                                $multiply: [
                                    { $ifNull: ["$currentStock", 0] },
                                    { $ifNull: ["$averageCost", 0] }
                                ]
                            }
                        ]
                    }
                },
                lowStock: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ["$stockStatus", "Low Stock"] },
                                    {
                                        $and: [
                                            { $gt: ["$reorderLevel", 0] },
                                            {
                                                $lte: [
                                                    "$availableStock",
                                                    "$reorderLevel"
                                                ]
                                            },
                                            { $gt: ["$availableStock", 0] }
                                        ]
                                    }
                                ]
                            },
                            1,
                            0
                        ]
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

    const imeiMatch = { status: { $ne: "deleted" }, ...tenant };
    const imeiAvailable = await ItemTrack.countDocuments({
        status: "available",
        ...tenant
    });
    const imeiSold = await ItemTrack.countDocuments({
        status: "sold",
        ...tenant
    });
    const imeiInTransit = await ItemTrack.countDocuments({
        status: "in-transit",
        ...tenant
    });
    const imeiActive = await ItemTrack.countDocuments(imeiMatch);

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
        imeiInTransit,
        imeiActive
    };
};

const getLowStock = async (query = {}, companyId = null) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const filter = {
        isDeleted: { $ne: true },
        ...companyFilter(companyId),
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

    // Drop rows whose product is already trashed
    const filtered = items.filter((row) => {
        const p = row.productId;
        if (p && typeof p === "object" && p.isDeleted === true) return false;
        return true;
    });

    return { items: filtered, total: filtered.length };
};

const getStockMovements = async (query = {}, companyId = null) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Tenant scope: stamped companyId, plus legacy rows (no companyId) whose
    // warehouse belongs to this company — sales/GRN historically omitted it.
    const Warehouse = require("../model/warehouse");
    const whIds = await Warehouse.find({
        companyId,
        isDeleted: { $ne: true }
    })
        .select("_id")
        .lean();
    const companyWarehouseIds = whIds.map((w) => w._id);

    const and = [
        {
            $or: [
                { companyId },
                {
                    $and: [
                        {
                            $or: [
                                { companyId: null },
                                { companyId: { $exists: false } }
                            ]
                        },
                        companyWarehouseIds.length
                            ? { warehouseId: { $in: companyWarehouseIds } }
                            : { _id: null }
                    ]
                }
            ]
        }
    ];

    if (query.warehouseId) {
        and.push({ warehouseId: toObjectId(query.warehouseId) });
    }
    if (query.branchId) and.push({ branchId: toObjectId(query.branchId) });
    if (query.productId) and.push({ productId: toObjectId(query.productId) });
    if (query.movementType) and.push({ movementType: query.movementType });
    if (query.movementDirection) {
        and.push({ movementDirection: query.movementDirection });
    }
    if (query.grnId) and.push({ grnId: toObjectId(query.grnId) });

    if (query.from || query.to) {
        const movementDate = {};
        if (query.from) movementDate.$gte = new Date(query.from);
        if (query.to) movementDate.$lte = new Date(query.to);
        and.push({ movementDate });
    }

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        and.push({
            $or: [
                { movementNumber: { $regex: search, $options: "i" } },
                { productName: { $regex: search, $options: "i" } },
                { sku: { $regex: search, $options: "i" } }
            ]
        });
    }

    const filter = and.length === 1 ? and[0] : { $and: and };

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

const getImeiStock = async (query = {}, companyId = null) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { ...companyFilter(companyId) };

    if (query.status) {
        filter.status = query.status;
    } else if (query.availableOnly === "true" || query.availableOnly === true) {
        filter.status = "available";
    } else if (query.includeDeleted !== "true" && query.includeDeleted !== true) {
        // Hide cleared/trashed IMEIs by default
        filter.status = { $ne: "deleted" };
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

/** Fill missing averageCost / inventoryValue from product prices. */
const healInventoryCostsAndValues = async (companyId = null) => {
    const tenant = companyId ? companyFilter(companyId) : {};
    const rows = await Inventory.find({
        isDeleted: { $ne: true },
        currentStock: { $gt: 0 },
        $or: [
            { averageCost: { $lte: 0 } },
            { averageCost: { $exists: false } },
            { inventoryValue: { $lte: 0 } },
            { inventoryValue: { $exists: false } }
        ],
        ...tenant
    }).limit(500);

    let healed = 0;
    for (const row of rows) {
        const product = await Product.findById(row.productId)
            .select("costPrice purchasePrice averagePurchasePrice sellingPrice")
            .lean();
        if (!product) continue;
        const cost =
            Number(row.averageCost) ||
            Number(row.lastPurchasePrice) ||
            Number(product.costPrice) ||
            Number(product.purchasePrice) ||
            Number(product.averagePurchasePrice) ||
            Number(product.sellingPrice) ||
            0;
        if (cost <= 0) continue;
        const qty = Number(row.currentStock) || 0;
        if (!row.averageCost || row.averageCost <= 0) row.averageCost = cost;
        row.inventoryValue = (Number(row.averageCost) || cost) * qty;
        await row.save();
        healed += 1;
    }
    return healed;
};

/** Push Inventory totals onto Product.totalStock / stockValue */
const syncProductStockSummaries = async (companyId = null) => {
    const healedValues = await healInventoryCostsAndValues(companyId);

    const productService = require("./productService");

    const [fromInventory, fromImei, staleSummaries] = await Promise.all([
        Inventory.distinct("productId", { isDeleted: { $ne: true } }),
        ItemTrack.distinct("productId", { status: { $ne: "deleted" } }),
        Product.distinct("_id", {
            isDeleted: { $ne: true },
            totalStock: { $gt: 0 }
        })
    ]);

    const idSet = new Set();
    for (const id of [...fromInventory, ...fromImei, ...staleSummaries]) {
        if (id) idSet.add(String(id));
    }

    let updated = 0;
    const errors = [];
    for (const id of idSet) {
        try {
            await productService.refreshStockSummary(id);
            updated += 1;
        } catch (err) {
            errors.push(`${id}: ${err?.message || err}`);
        }
    }
    return { updated, total: idSet.size, errors, healedValues };
};

const clearProductStock = async (productId, actorId = null, companyId = null) => {
    const id = toObjectId(productId);
    if (!id) throw new AppError("Invalid product id.", 400);

    const tenant = companyFilter(companyId);

    const product = await Product.findOne({
        _id: id,
        isDeleted: { $ne: true },
        ...tenant
    });
    if (!product) throw new AppError("Product not found.", 404);
    assertDocumentCompany(product, companyId, "Product");

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
        currentStock: { $gt: 0 },
        ...tenant
    });

    const reservedAgg = await Inventory.aggregate([
        {
            $match: {
                productId: id,
                isDeleted: { $ne: true },
                reservedStock: { $gt: 0 },
                ...tenant
            }
        },
        { $group: { _id: null, reserved: { $sum: "$reservedStock" } } }
    ]);
    if ((Number(reservedAgg[0]?.reserved) || 0) > 0) {
        throw new AppError(
            "Cannot clear stock while reserved stock exists for this product.",
            400
        );
    }

    const blockedImeiCount = await ItemTrack.countDocuments({
        productId: id,
        status: { $in: ["sold", "repairing", "in-transit"] },
        ...tenant
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
        await StockMovement.create(
            stampCompany(
                {
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
                    unitCost:
                        Number(row.averageCost) ||
                        Number(row.lastPurchasePrice) ||
                        0,
                    totalCost:
                        (Number(row.averageCost) ||
                            Number(row.lastPurchasePrice) ||
                            0) * qty,
                    referenceType: "Manual",
                    remarks: "Manual clear stock before product delete",
                    adjustmentReason: "Clear Product Stock",
                    createdBy: movementActorId
                },
                companyId
            )
        );

        row.currentStock = 0;
        row.availableStock = 0;
        row.inventoryValue = 0;
        applyStockStatus(row);
        await row.save();

        clearedQty += qty;
        clearedRows += 1;
    }

    const imeiResult = await ItemTrack.updateMany(
        {
            productId: id,
            status: "available",
            ...tenant
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

    // Also zero any leftover catalog opening qty on variants so summaries stay clean
    const ProductVariant = require("../model/productVariant");
    await ProductVariant.updateMany(
        {
            productId: id,
            isDeleted: { $ne: true },
            quantity: { $gt: 0 },
            ...tenant
        },
        { $set: { quantity: 0 } }
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

/**
 * Full filtered Stock Management Excel export (balances, low stock,
 * movements, IMEIs — not page-limited).
 */
const exportInventoryExcel = async (
    query = {},
    companyId = null,
    actor = null
) => {
    await ensureManualOpeningStockHealed(companyId);

    const tenant = companyFilter(companyId);
    const stockFilter = { isDeleted: { $ne: true }, ...tenant };

    if (query.warehouseId) {
        stockFilter.warehouseId = toObjectId(query.warehouseId);
    }
    if (query.branchId) stockFilter.branchId = toObjectId(query.branchId);
    if (query.productId) stockFilter.productId = toObjectId(query.productId);
    if (query.stockStatus) stockFilter.stockStatus = query.stockStatus;

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        const productIds = await resolveSearchProductIds(query.search);
        const searchOr = [{ batchNumber: { $regex: search, $options: "i" } }];
        if (productIds && productIds.length) {
            searchOr.push({ productId: { $in: productIds } });
        }
        stockFilter.$or = searchOr;
    }

    const stockTotal = await Inventory.countDocuments(stockFilter);
    if (stockTotal > MAX_EXPORT_INVENTORY) {
        throw new AppError(
            `Too many matching stock rows (${stockTotal}). Narrow filters (max ${MAX_EXPORT_INVENTORY}).`,
            400
        );
    }

    const stockRows =
        stockTotal === 0
            ? []
            : await populateInventory(
                  Inventory.find(stockFilter).sort({ updatedAt: -1 })
              ).lean();

    // Low stock (same warehouse filter; ignore stockStatus so sheet stays useful)
    const lowFilter = {
        isDeleted: { $ne: true },
        ...tenant,
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
    if (query.warehouseId) {
        lowFilter.warehouseId = toObjectId(query.warehouseId);
    }
    const lowStockRaw = await populateInventory(
        Inventory.find(lowFilter).sort({ availableStock: 1 })
    ).lean();
    const lowStockRows = lowStockRaw.filter((row) => {
        const p = row.productId;
        if (p && typeof p === "object" && p.isDeleted === true) return false;
        return true;
    });

    // Movements — reuse tenant-aware warehouse scope from getStockMovements
    const Warehouse = require("../model/warehouse");
    const whIds = await Warehouse.find({
        companyId,
        isDeleted: { $ne: true }
    })
        .select("_id")
        .lean();
    const companyWarehouseIds = whIds.map((w) => w._id);

    const movAnd = [
        {
            $or: [
                { companyId },
                {
                    $and: [
                        {
                            $or: [
                                { companyId: null },
                                { companyId: { $exists: false } }
                            ]
                        },
                        companyWarehouseIds.length
                            ? { warehouseId: { $in: companyWarehouseIds } }
                            : { _id: null }
                    ]
                }
            ]
        }
    ];
    if (query.warehouseId) {
        movAnd.push({ warehouseId: toObjectId(query.warehouseId) });
    }
    if (query.movementType) {
        movAnd.push({ movementType: query.movementType });
    }
    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        movAnd.push({
            $or: [
                { movementNumber: { $regex: search, $options: "i" } },
                { productName: { $regex: search, $options: "i" } },
                { sku: { $regex: search, $options: "i" } }
            ]
        });
    }
    const movFilter = movAnd.length === 1 ? movAnd[0] : { $and: movAnd };
    const movTotal = await StockMovement.countDocuments(movFilter);
    if (movTotal > MAX_EXPORT_INVENTORY) {
        throw new AppError(
            `Too many matching movements (${movTotal}). Narrow filters (max ${MAX_EXPORT_INVENTORY}).`,
            400
        );
    }
    const movements =
        movTotal === 0
            ? []
            : await populateMovement(
                  StockMovement.find(movFilter).sort({
                      movementDate: -1,
                      createdAt: -1
                  })
              ).lean();

    // IMEIs
    const imeiFilter = { ...tenant };
    if (query.imeiStatus || query.status) {
        imeiFilter.status = query.imeiStatus || query.status;
    } else {
        imeiFilter.status = { $ne: "deleted" };
    }
    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        imeiFilter.imei = { $regex: search, $options: "i" };
    }
    const imeiTotal = await ItemTrack.countDocuments(imeiFilter);
    if (imeiTotal > MAX_EXPORT_INVENTORY) {
        throw new AppError(
            `Too many matching IMEIs (${imeiTotal}). Narrow filters (max ${MAX_EXPORT_INVENTORY}).`,
            400
        );
    }
    const imeis =
        imeiTotal === 0
            ? []
            : await ItemTrack.find(imeiFilter)
                  .sort({ updatedAt: -1 })
                  .populate("productId", "name productCode trackingType sku")
                  .populate("variantId", "sku combinationString")
                  .populate("currentBranchId", "branchCode name")
                  .lean();

    const stats = await getInventoryStats(query, companyId);
    const filename = buildExportFilename(query);
    const buffer = await buildInventoryWorkbook({
        stockRows,
        lowStockRows,
        movements,
        imeis,
        stats,
        meta: {
            exportedAt: new Date(),
            exportedBy:
                [actor?.firstName, actor?.lastName].filter(Boolean).join(" ") ||
                actor?.name ||
                actor?.email ||
                actor?.username ||
                "",
            companyId: companyId ? String(companyId) : "",
            filters: {
                search: query.search || "",
                warehouseId: query.warehouseId || "",
                stockStatus: query.stockStatus || "",
                movementType: query.movementType || "",
                imeiStatus: query.imeiStatus || query.status || ""
            }
        }
    });

    await writeActivityLog({
        user: actor,
        companyId,
        activityType: "Export",
        module: "Inventory",
        subModule: "Stock",
        description: `Exported stock Excel (${filename}): ${stockRows.length} balances, ${movements.length} movements, ${imeis.length} IMEIs.`,
        shortDescription: `Stock Excel export (${stockRows.length} rows)`,
        referenceType: "StockMovement",
        referenceId: null,
        newData: {
            filename,
            stockCount: stockRows.length,
            lowStockCount: lowStockRows.length,
            movementCount: movements.length,
            imeiCount: imeis.length,
            filters: {
                search: query.search || "",
                warehouseId: query.warehouseId || "",
                stockStatus: query.stockStatus || ""
            }
        },
        securityLevel: "Medium"
    });

    return {
        buffer,
        filename,
        stockCount: stockRows.length,
        movementCount: movements.length,
        imeiCount: imeis.length
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
    healInventoryCostsAndValues,
    clearProductStock,
    computeStockStatus,
    applyStockStatus,
    getLiveWarehouseStock,
    exportInventoryExcel
};
