const mongoose = require("mongoose");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const Category = require("../model/category");
const Brand = require("../model/brand");
const ItemTrack = require("../model/itemTrack");
const PurchaseOrder = require("../model/purchaseOrder");
const SalesOrder = require("../model/salesOrder");
const AppError = require("../utils/appError");
const { companySnapshot } = require("./financeReportService");
const { MOVEMENT_TYPES } = require("../validators/inventoryReportValidator");

const DAY_MS = 86_400_000;
const MAX_RANKING_ROWS = 20;
const n = (value) => Number(value) || 0;
const id = (value) => (value == null ? "" : String(value._id || value));
const oid = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;
const tupleKey = (branchId, warehouseId, productId) =>
    `${id(branchId)}|${id(warehouseId)}|${id(productId)}`;
const branchProductKey = (branchId, productId) => `${id(branchId)}|${id(productId)}`;
const percent = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const escapeRegex = (value = "") =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const utcBound = (value, end = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        date.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    }
    return date;
};

const resolvePeriod = (query) => {
    const to = utcBound(query.to, true) || new Date();
    const from = utcBound(query.from, false) || new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new AppError("'from' must be before or equal to 'to'.", 422);
    if ((to.getTime() - from.getTime()) / DAY_MS > 731) {
        throw new AppError("Date range cannot exceed 731 days.", 422);
    }
    return { from, to };
};

const applyBranchScope = (match, requestedBranchId, managedBranchIds) => {
    const requested = oid(requestedBranchId);
    if (managedBranchIds === null) {
        if (requested) match.branchId = requested;
        return;
    }
    const allowed = (managedBranchIds || []).map(String);
    if (requested) {
        if (!allowed.includes(String(requested))) {
            throw new AppError("You cannot access inventory outside your branches.", 403);
        }
        match.branchId = requested;
    } else {
        match.branchId = { $in: managedBranchIds || [] };
    }
};

const pagination = (page, limit, total) => ({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPreviousPage: page > 1,
});

const periodStart = (value, groupBy) => {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    if (groupBy === "week") {
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
    } else if (groupBy === "month") {
        date.setUTCDate(1);
    }
    return date;
};

const periodKey = (value, groupBy) =>
    periodStart(value, groupBy).toISOString().slice(0, 10);

const periodKeys = (from, to, groupBy) => {
    const keys = [];
    const cursor = periodStart(from, groupBy);
    while (cursor <= to) {
        keys.push(cursor.toISOString().slice(0, 10));
        if (groupBy === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        else cursor.setUTCDate(cursor.getUTCDate() + (groupBy === "week" ? 7 : 1));
    }
    return keys;
};

const movementValue = (row) => {
    if (n(row.totalCost) > 0) return n(row.totalCost);
    if (n(row.unitCost) > 0) return n(row.quantity) * n(row.unitCost);
    return 0;
};

const resolveCost = (inventory, variant, product) => {
    const candidates = [
        ["inventory_average_cost", inventory.averageCost],
        ["inventory_last_purchase_price", inventory.lastPurchasePrice],
        ["variant_cost_price", variant?.costPrice],
        ["variant_purchase_price", variant?.purchasePrice],
        ["product_cost_price", product?.costPrice],
        ["product_purchase_price", product?.purchasePrice],
        ["product_average_purchase_price", product?.averagePurchasePrice],
        ["product_last_purchase_price", product?.lastPurchasePrice],
    ];
    const found = candidates.find(([, value]) => n(value) > 0);
    return found
        ? { resolvedUnitCost: n(found[1]), costSource: found[0] }
        : { resolvedUnitCost: 0, costSource: "unvalued" };
};

const derivedStockStatus = (available, reorderLevel, maximumStock) => {
    if (available <= 0) return "Out Of Stock";
    if (n(maximumStock) > 0 && available > n(maximumStock)) return "Over Stock";
    if (n(reorderLevel) > 0 && available <= n(reorderLevel)) return "Low Stock";
    return "In Stock";
};

const buildEvidence = (purchaseOrders, salesOrders) => {
    const tuples = new Set();
    const branchProducts = new Set();
    const productIds = new Set();
    const warehouseIds = new Set();
    const branchIds = new Set();
    const add = (branchId, warehouseId, productId) => {
        if (!branchId || !warehouseId || !productId) return;
        tuples.add(tupleKey(branchId, warehouseId, productId));
        branchProducts.add(branchProductKey(branchId, productId));
        productIds.add(id(productId));
        warehouseIds.add(id(warehouseId));
        branchIds.add(id(branchId));
    };
    for (const order of purchaseOrders) {
        for (const item of order.items || []) {
            add(order.branchId, order.warehouseId, item.productId);
        }
    }
    for (const order of salesOrders) {
        for (const item of order.items || []) {
            add(order.branchId, item.stockWarehouseId || order.warehouseId, item.productId);
        }
    }
    return { tuples, branchProducts, productIds, warehouseIds, branchIds };
};

const entityBreakdown = (rows, field, docs, nameField, codeField) => {
    const groups = new Map();
    for (const row of rows) {
        const key = id(row[field]);
        const current = groups.get(key) || {
            id: key || null,
            code: "",
            label: "Unassigned",
            skus: new Set(),
            products: new Set(),
            totalStock: 0,
            availableStock: 0,
            reservedStock: 0,
            damagedStock: 0,
            inTransitStock: 0,
            stockValue: 0,
        };
        current.skus.add(`${id(row.productId)}:${id(row.productVariantId)}`);
        current.products.add(id(row.productId));
        current.totalStock += row.currentStock;
        current.availableStock += row.availableStock;
        current.reservedStock += row.reservedStock;
        current.damagedStock += row.damagedStock;
        current.inTransitStock += row.inTransitStock;
        current.stockValue += row.stockValue;
        groups.set(key, current);
    }
    const totalValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
    return [...groups.values()]
        .map((row) => {
            const doc = docs.get(id(row.id)) || {};
            return {
                id: row.id,
                code: doc[codeField] || "",
                label: doc[nameField] || row.label,
                skuCount: row.skus.size,
                productCount: row.products.size,
                totalStock: row.totalStock,
                availableStock: row.availableStock,
                reservedStock: row.reservedStock,
                damagedStock: row.damagedStock,
                inTransitStock: row.inTransitStock,
                stockValue: row.stockValue,
                percentageOfValue: percent(row.stockValue, totalValue),
            };
        })
        .sort((a, b) => b.stockValue - a.stockValue);
};

const buildTrend = (movements, from, to, groupBy) => {
    const rows = new Map(
        periodKeys(from, to, groupBy).map((date) => [
            date,
            {
                period: date,
                date,
                label: date,
                inQty: 0,
                outQty: 0,
                netQty: 0,
                inValue: 0,
                outValue: 0,
                movementCount: 0,
            },
        ])
    );
    for (const movement of movements) {
        const row = rows.get(periodKey(movement.movementDate, groupBy));
        if (!row) continue;
        const quantity = n(movement.quantity);
        const value = movementValue(movement);
        if (movement.movementDirection === "IN") {
            row.inQty += quantity;
            row.inValue += value;
        } else {
            row.outQty += quantity;
            row.outValue += value;
        }
        row.movementCount += 1;
    }
    for (const row of rows.values()) row.netQty = row.inQty - row.outQty;
    return [...rows.values()];
};

const movementBreakdown = (movements) => {
    const groups = new Map();
    for (const movement of movements) {
        const key = `${movement.movementType}:${movement.movementDirection}`;
        const row = groups.get(key) || {
            key,
            label: `${movement.movementType} (${movement.movementDirection})`,
            movementType: movement.movementType,
            direction: movement.movementDirection,
            quantity: 0,
            value: 0,
            count: 0,
        };
        row.quantity += n(movement.quantity);
        row.value += movementValue(movement);
        row.count += 1;
        groups.set(key, row);
    }
    const total = [...groups.values()].reduce((sum, row) => sum + row.quantity, 0);
    return [...groups.values()]
        .map((row) => ({ ...row, percentage: percent(row.quantity, total) }))
        .sort((a, b) => b.quantity - a.quantity);
};

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const tenantId = oid(companyId);
    if (!tenantId) throw new AppError("Company context is required.", 403);
    const period = resolvePeriod(query);
    const groupBy = query.groupBy || "day";
    const slowMoverDays = Math.min(Math.max(parseInt(query.slowMoverDays, 10) || 60, 1), 3650);
    const deadStockDays = Math.min(Math.max(parseInt(query.deadStockDays, 10) || 90, 1), 3650);
    const stockPage = Math.max(parseInt(query.stockPage, 10) || 1, 1);
    const stockLimit = Math.min(Math.max(parseInt(query.stockLimit, 10) || 25, 1), 100);
    const movementPage = Math.max(parseInt(query.movementPage, 10) || 1, 1);
    const movementLimit = Math.min(Math.max(parseInt(query.movementLimit, 10) || 25, 1), 100);

    const orderMatch = {
        companyId: tenantId,
        isDeleted: { $ne: true },
        status: { $ne: "Cancelled" },
    };
    applyBranchScope(orderMatch, query.branchId, managedBranchIds);
    const [company, purchaseOrders, salesOrders] = await Promise.all([
        companySnapshot(tenantId),
        PurchaseOrder.find(orderMatch)
            .select("_id branchId warehouseId items.productId items.productVariantId")
            .lean(),
        SalesOrder.find(orderMatch)
            .select(
                "_id branchId warehouseId items.productId items.productVariantId items.stockWarehouseId"
            )
            .lean(),
    ]);
    const evidence = buildEvidence(purchaseOrders, salesOrders);
    if (query.warehouseId && !evidence.warehouseIds.has(String(query.warehouseId))) {
        throw new AppError(
            "The requested warehouse is not evidenced by tenant orders in your branch scope.",
            403
        );
    }

    const productObjectIds = [...evidence.productIds].map(oid).filter(Boolean);
    const warehouseObjectIds = [...evidence.warehouseIds].map(oid).filter(Boolean);
    const branchObjectIds = [...evidence.branchIds].map(oid).filter(Boolean);
    const purchaseOrderIds = purchaseOrders.map((row) => row._id);
    const salesOrderIds = salesOrders.map((row) => row._id);

    if (!productObjectIds.length || !warehouseObjectIds.length || !branchObjectIds.length) {
        const emptyCompany = company || {};
        return emptyDashboard({
            company: emptyCompany,
            period,
            groupBy,
            query,
            slowMoverDays,
            deadStockDays,
            managedBranchIds,
        });
    }

    const inventoryMatch = {
        isDeleted: { $ne: true },
        productId: { $in: productObjectIds },
        warehouseId: {
            $in: query.warehouseId ? [oid(query.warehouseId)] : warehouseObjectIds,
        },
        branchId: { $in: branchObjectIds },
    };
    if (query.productId) inventoryMatch.productId = oid(query.productId);
    if (query.productVariantId) inventoryMatch.productVariantId = oid(query.productVariantId);

    const movementMatch = {
        movementDate: { $gte: period.from, $lte: period.to },
        $or: [
            ...(purchaseOrderIds.length
                ? [{ purchaseOrderId: { $in: purchaseOrderIds } }]
                : []),
            ...(salesOrderIds.length ? [{ salesOrderId: { $in: salesOrderIds } }] : []),
        ],
    };
    if (!movementMatch.$or.length) movementMatch._id = { $exists: false };
    if (query.warehouseId) movementMatch.warehouseId = oid(query.warehouseId);
    if (query.productId) movementMatch.productId = oid(query.productId);
    if (query.productVariantId) movementMatch.productVariantId = oid(query.productVariantId);
    if (query.movementType) movementMatch.movementType = query.movementType;
    if (query.movementDirection) movementMatch.movementDirection = query.movementDirection;

    const historyMatch = {
        movementDate: { $lte: period.to },
        productId: { $in: productObjectIds },
        $and: [
            {
                $or: [
                    ...(purchaseOrderIds.length
                        ? [{ purchaseOrderId: { $in: purchaseOrderIds } }]
                        : []),
                    ...(salesOrderIds.length
                        ? [{ salesOrderId: { $in: salesOrderIds } }]
                        : []),
                ],
            },
            { $or: [{ movementType: "Sale" }, { movementDirection: "OUT" }] },
        ],
    };
    if (!historyMatch.$and[0].$or.length) historyMatch._id = { $exists: false };

    const [inventories, movements, saleHistory, products, variants] = await Promise.all([
        Inventory.find(inventoryMatch).lean(),
        StockMovement.find(movementMatch).sort({ movementDate: -1, _id: -1 }).lean(),
        StockMovement.find(historyMatch)
            .select("productId productVariantId movementDate quantity movementType movementDirection")
            .sort({ movementDate: -1 })
            .lean(),
        Product.find({ _id: { $in: productObjectIds }, isDeleted: { $ne: true } })
            .select(
                "productCode name sku barcode trackingType proCategoryId proBrandId costPrice purchasePrice averagePurchasePrice lastPurchasePrice reorderLevel minimumStock maximumStock reorderQuantity"
            )
            .lean(),
        ProductVariant.find({
            productId: { $in: productObjectIds },
            isDeleted: { $ne: true },
        })
            .select(
                "productId combinationString sku barcode costPrice purchasePrice reorderLevel minimumStock maximumStock reorderQuantity"
            )
            .lean(),
    ]);

    const productMap = new Map(products.map((row) => [id(row._id), row]));
    const variantMap = new Map(variants.map((row) => [id(row._id), row]));
    const productFilter = (product) =>
        product &&
        (!query.categoryId || id(product.proCategoryId) === String(query.categoryId)) &&
        (!query.brandId || id(product.proBrandId) === String(query.brandId)) &&
        (!query.trackingType || product.trackingType === query.trackingType);
    const allowedProductIds = new Set(
        products.filter(productFilter).map((row) => id(row._id))
    );

    const exactInventories = inventories.filter(
        (row) =>
            evidence.tuples.has(tupleKey(row.branchId, row.warehouseId, row.productId)) &&
            allowedProductIds.has(id(row.productId))
    );
    const filteredMovements = movements.filter(
        (row) => allowedProductIds.has(id(row.productId))
    );
    const filteredHistory = saleHistory.filter((row) =>
        allowedProductIds.has(id(row.productId))
    );

    const lastSaleBySku = new Map();
    for (const row of filteredHistory) {
        const key = `${id(row.productId)}:${id(row.productVariantId)}`;
        if (!lastSaleBySku.has(key)) lastSaleBySku.set(key, row.movementDate);
    }
    const periodBySku = new Map();
    for (const row of filteredMovements) {
        const key = `${id(row.productId)}:${id(row.productVariantId)}`;
        const aggregate = periodBySku.get(key) || { inQty: 0, outQty: 0, saleQty: 0 };
        if (row.movementDirection === "IN") aggregate.inQty += n(row.quantity);
        else aggregate.outQty += n(row.quantity);
        if (row.movementType === "Sale" || row.movementDirection === "OUT") {
            aggregate.saleQty += n(row.quantity);
        }
        periodBySku.set(key, aggregate);
    }

    const searchRegex = query.search
        ? new RegExp(escapeRegex(String(query.search).trim()), "i")
        : null;
    const snapshotAsOf = new Date();
    const stockRows = exactInventories
        .map((inventory) => {
            const product = productMap.get(id(inventory.productId)) || {};
            const variant = variantMap.get(id(inventory.productVariantId)) || {};
            const skuKey = `${id(inventory.productId)}:${id(inventory.productVariantId)}`;
            const periodStats = periodBySku.get(skuKey) || {
                inQty: 0,
                outQty: 0,
                saleQty: 0,
            };
            const currentStock = n(inventory.currentStock);
            const availableStock = n(inventory.availableStock);
            const reservedStock = n(inventory.reservedStock);
            const cost = resolveCost(inventory, variant, product);
            const reorderLevel =
                n(inventory.reorderLevel) ||
                n(variant.reorderLevel) ||
                n(product.reorderLevel);
            const minimumStock =
                n(inventory.minimumStock) ||
                n(variant.minimumStock) ||
                n(product.minimumStock);
            const maximumStock =
                n(inventory.maximumStock) ||
                n(variant.maximumStock) ||
                n(product.maximumStock);
            const reorderQuantity =
                n(inventory.reorderQuantity) ||
                n(variant.reorderQuantity) ||
                n(product.reorderQuantity);
            const stockStatus = derivedStockStatus(
                availableStock,
                reorderLevel,
                maximumStock
            );
            const lastSaleDate =
                lastSaleBySku.get(skuKey) || inventory.lastSaleDate || null;
            const daysSinceLastSale = lastSaleDate
                ? Math.max(
                      0,
                      Math.floor(
                          (period.to.getTime() - new Date(lastSaleDate).getTime()) / DAY_MS
                      )
                  )
                : null;
            const periodDays = Math.max(
                1,
                Math.ceil((period.to.getTime() - period.from.getTime() + 1) / DAY_MS)
            );
            const velocityPerDay = periodStats.saleQty / periodDays;
            let moverClass = "normal";
            if (currentStock > 0 && (daysSinceLastSale == null || daysSinceLastSale >= deadStockDays)) {
                moverClass = "dead";
            } else if (
                currentStock > 0 &&
                (daysSinceLastSale == null || daysSinceLastSale >= slowMoverDays)
            ) {
                moverClass = "slow";
            } else if (periodStats.saleQty > 0) {
                moverClass = "fast";
            }
            let suggestedReorderQuantity = 0;
            if (reorderLevel > 0 && availableStock <= reorderLevel) {
                suggestedReorderQuantity =
                    reorderQuantity > 0
                        ? reorderQuantity
                        : maximumStock > currentStock
                          ? maximumStock - currentStock
                          : Math.max(reorderLevel - availableStock, 0);
            }
            return {
                inventoryId: id(inventory._id),
                id: id(inventory._id),
                productId: id(inventory.productId) || null,
                productVariantId: id(inventory.productVariantId) || null,
                productCode: product.productCode || "",
                productName: product.name || "",
                name: product.name || "",
                variantLabel: variant.combinationString || "",
                sku: variant.sku || product.sku || "",
                barcode: variant.barcode || product.barcode || "",
                trackingType: product.trackingType || "Non-IMEI",
                categoryId: id(product.proCategoryId) || null,
                categoryName: "",
                brandId: id(product.proBrandId) || null,
                brandName: "",
                branchId: id(inventory.branchId) || null,
                branchName: "",
                warehouseId: id(inventory.warehouseId) || null,
                warehouseName: "",
                currentStock,
                availableStock,
                reservedStock,
                damagedStock: 0,
                inTransitStock: 0,
                averageCost: n(inventory.averageCost),
                resolvedUnitCost: cost.resolvedUnitCost,
                costSource: cost.costSource,
                stockValue: currentStock * cost.resolvedUnitCost,
                reorderLevel,
                minimumStock,
                maximumStock,
                reorderQuantity,
                suggestedReorderQuantity,
                stockStatus,
                lastMovementDate: inventory.lastMovementDate || null,
                lastSaleDate,
                daysSinceLastSale,
                periodInQty: periodStats.inQty,
                periodOutQty: periodStats.outQty,
                periodSaleQty: periodStats.saleQty,
                velocityPerDay,
                daysOfCover: velocityPerDay > 0 ? availableStock / velocityPerDay : null,
                moverClass,
                updatedAt: inventory.updatedAt || null,
            };
        })
        .filter(
            (row) =>
                (!query.stockStatus || row.stockStatus === query.stockStatus) &&
                (!searchRegex ||
                    searchRegex.test(row.productCode) ||
                    searchRegex.test(row.productName) ||
                    searchRegex.test(row.sku) ||
                    searchRegex.test(row.barcode))
        );
    const valuedStockRows = stockRows.filter((row) => row.resolvedUnitCost > 0).length;
    const quantityInvariantViolations = stockRows.filter(
        (row) =>
            Math.abs(row.currentStock - row.availableStock - row.reservedStock) > 0.0001
    ).length;
    const staleInventoryRows = stockRows.filter(
        (row) =>
            !row.updatedAt ||
            snapshotAsOf.getTime() - new Date(row.updatedAt).getTime() > 30 * DAY_MS
    ).length;

    const categoryIds = [
        ...new Set(products.map((row) => id(row.proCategoryId)).filter(Boolean)),
    ];
    const brandIds = [
        ...new Set(products.map((row) => id(row.proBrandId)).filter(Boolean)),
    ];
    const [categories, brands, branches, warehouses, imeiRows] = await Promise.all([
        Category.find({ _id: { $in: categoryIds.map(oid) }, isDeleted: { $ne: true } })
            .select("name")
            .lean(),
        Brand.find({ _id: { $in: brandIds.map(oid) }, isDeleted: { $ne: true } })
            .select("name")
            .lean(),
        Branch.find({ _id: { $in: branchObjectIds }, isDeleted: { $ne: true } })
            .select("branchCode name")
            .lean(),
        Warehouse.find({
            _id: { $in: warehouseObjectIds },
            isDeleted: { $ne: true },
        })
            .select("warehouseCode warehouseName")
            .lean(),
        ItemTrack.find({
            productId: { $in: [...allowedProductIds].map(oid) },
            currentBranchId: { $in: branchObjectIds },
            status: { $in: ["available", "in-transit"] },
        })
            .select("productId currentBranchId status")
            .lean(),
    ]);
    const categoryMap = new Map(categories.map((row) => [id(row._id), row]));
    const brandMap = new Map(brands.map((row) => [id(row._id), row]));
    const branchMap = new Map(branches.map((row) => [id(row._id), row]));
    const warehouseMap = new Map(warehouses.map((row) => [id(row._id), row]));
    for (const row of stockRows) {
        row.categoryName = categoryMap.get(id(row.categoryId))?.name || "";
        row.brandName = brandMap.get(id(row.brandId))?.name || "";
        row.branchName = branchMap.get(id(row.branchId))?.name || "";
        row.warehouseName = warehouseMap.get(id(row.warehouseId))?.warehouseName || "";
    }

    const movementRowsAll = filteredMovements
        .map((movement) => {
            const product = productMap.get(id(movement.productId)) || {};
            const variant = variantMap.get(id(movement.productVariantId)) || {};
            const branch = branchMap.get(id(movement.branchId)) || {};
            const warehouse = warehouseMap.get(id(movement.warehouseId)) || {};
            return {
                movementId: id(movement._id),
                id: id(movement._id),
                movementNumber: movement.movementNumber || "",
                movementDate: movement.movementDate,
                date: movement.movementDate,
                movementType: movement.movementType,
                movementDirection: movement.movementDirection,
                quantity: n(movement.quantity),
                unitCost: n(movement.unitCost),
                totalCost: movementValue(movement),
                productId: id(movement.productId) || null,
                productVariantId: id(movement.productVariantId) || null,
                productCode: product.productCode || "",
                productName: product.name || movement.productName || "",
                name: product.name || movement.productName || "",
                variantLabel: variant.combinationString || "",
                sku: variant.sku || movement.sku || product.sku || "",
                branchId: id(movement.branchId) || null,
                branchName: branch.name || "",
                warehouseId: id(movement.warehouseId) || null,
                warehouseName: warehouse.warehouseName || "",
                referenceType: movement.referenceType || "",
                referenceId: id(movement.referenceId) || null,
                transferStatus: movement.transferStatus || "",
                remarks: movement.remarks || "",
                scopeSource: "direct_order_link",
            };
        })
        .filter(
            (row) =>
                !searchRegex ||
                searchRegex.test(row.movementNumber) ||
                searchRegex.test(row.productCode) ||
                searchRegex.test(row.productName) ||
                searchRegex.test(row.sku) ||
                searchRegex.test(row.remarks)
        );

    const totalStockValue = stockRows.reduce((sum, row) => sum + row.stockValue, 0);
    const periodInQty = filteredMovements.reduce(
        (sum, row) => sum + (row.movementDirection === "IN" ? n(row.quantity) : 0),
        0
    );
    const periodOutQty = filteredMovements.reduce(
        (sum, row) => sum + (row.movementDirection === "OUT" ? n(row.quantity) : 0),
        0
    );
    const movementsWithCost = filteredMovements.filter(
        (row) => movementValue(row) > 0
    ).length;
    const imeiScoped = imeiRows.filter((row) =>
        evidence.branchProducts.has(branchProductKey(row.currentBranchId, row.productId))
    );
    const rank = (row) => ({
        id: row.inventoryId,
        productId: row.productId,
        productVariantId: row.productVariantId,
        name: row.name,
        productName: row.productName,
        sku: row.sku,
        quantity: row.periodSaleQty,
        value: row.stockValue,
        currentStock: row.currentStock,
        velocityPerDay: row.velocityPerDay,
        daysSinceLastSale: row.daysSinceLastSale,
        moverClass: row.moverClass,
    });
    const reorderAlerts = stockRows
        .filter((row) => row.reorderLevel > 0 && row.availableStock <= row.reorderLevel)
        .sort((a, b) => a.availableStock - b.availableStock)
        .slice(0, MAX_RANKING_ROWS);
    const warnings = [
        "Inventory and product collections have no companyId; only exact branch/warehouse/product tuples evidenced by tenant-owned non-cancelled orders are included.",
        "Only stock movements directly linked by purchaseOrderId or salesOrderId are included; unlinked opening, transfer, and adjustment history is excluded and totals may undercount legacy stock.",
        "Damaged and in-transit inventory quantities are reported as zero because the inventory schema does not provide reliable tenant-safe fields.",
        "IMEI counts are branch/product scoped (ItemTrack has no warehouseId) and are not used for valuation.",
    ];
    if (stockRows.some((row) => row.lastSaleDate == null && row.currentStock > 0)) {
        warnings.push(
            "Some dead-stock classifications have no directly linked sale history and are conservative."
        );
    }
    if (staleInventoryRows) {
        warnings.push("Some inventory snapshots have not been updated within 30 days.");
    }

    const stockTotal = stockRows.length;
    const movementTotal = movementRowsAll.length;
    const breakdownArgs = {
        branches: entityBreakdown(stockRows, "branchId", branchMap, "name", "branchCode"),
        warehouses: entityBreakdown(
            stockRows,
            "warehouseId",
            warehouseMap,
            "warehouseName",
            "warehouseCode"
        ),
        categories: entityBreakdown(
            stockRows,
            "categoryId",
            categoryMap,
            "name",
            "_unused"
        ),
        brands: entityBreakdown(stockRows, "brandId", brandMap, "name", "_unused"),
    };
    const effectiveBranchIds =
        managedBranchIds === null
            ? [...evidence.branchIds]
            : (managedBranchIds || []).map(String).filter((value) => evidence.branchIds.has(value));

    return {
        meta: {
            reportType: "inventory_dashboard",
            generatedAt: new Date().toISOString(),
            snapshotAsOf: snapshotAsOf.toISOString(),
            company,
            currency: company.currency || "USD",
            timezone: "UTC",
            companyTimezone: company.timezone || null,
            filters: {
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                groupBy,
                branchId: query.branchId || null,
                warehouseId: query.warehouseId || null,
                categoryId: query.categoryId || null,
                brandId: query.brandId || null,
                productId: query.productId || null,
                productVariantId: query.productVariantId || null,
                trackingType: query.trackingType || null,
                stockStatus: query.stockStatus || null,
                movementType: query.movementType || null,
                movementDirection: query.movementDirection || null,
                search: query.search || null,
                slowMoverDays,
                deadStockDays,
            },
            scope: {
                strategy: "tenant_order_evidence",
                evidencedTupleCount: evidence.tuples.size,
                evidencedProductCount: evidence.productIds.size,
                evidencedWarehouseCount: evidence.warehouseIds.size,
                effectiveBranchIds,
            },
            reliability: {
                valuationMethod: "weighted_average_with_fallback",
                valuationCoveragePercent: percent(valuedStockRows, stockRows.length),
                valuedStockRows,
                unvaluedStockRows: stockRows.length - valuedStockRows,
                movementCostCoveragePercent: percent(
                    movementsWithCost,
                    filteredMovements.length
                ),
                directLinkedMovementCount: filteredMovements.length,
                inferredMovementCount: 0,
                quantityInvariantViolations,
                staleInventoryRows,
                warnings,
            },
        },
        summary: {
            skuCount: new Set(
                stockRows.map((row) => `${row.productId}:${row.productVariantId}`)
            ).size,
            productCount: new Set(stockRows.map((row) => row.productId)).size,
            totalStock: stockRows.reduce((sum, row) => sum + row.currentStock, 0),
            availableStock: stockRows.reduce((sum, row) => sum + row.availableStock, 0),
            reservedStock: stockRows.reduce((sum, row) => sum + row.reservedStock, 0),
            damagedStock: 0,
            inTransitStock: 0,
            stockValue: totalStockValue,
            availableValue: stockRows.reduce(
                (sum, row) => sum + row.availableStock * row.resolvedUnitCost,
                0
            ),
            reservedValue: stockRows.reduce(
                (sum, row) => sum + row.reservedStock * row.resolvedUnitCost,
                0
            ),
            lowStockCount: stockRows.filter((row) => row.stockStatus === "Low Stock").length,
            outOfStockCount: stockRows.filter(
                (row) => row.stockStatus === "Out Of Stock"
            ).length,
            overStockCount: stockRows.filter((row) => row.stockStatus === "Over Stock")
                .length,
            reorderAlertCount: stockRows.filter(
                (row) => row.reorderLevel > 0 && row.availableStock <= row.reorderLevel
            ).length,
            imeiAvailable: imeiScoped.filter((row) => row.status === "available").length,
            imeiInTransit: imeiScoped.filter((row) => row.status === "in-transit").length,
            periodInQty,
            periodOutQty,
            periodNetQty: periodInQty - periodOutQty,
            periodMovementValue: filteredMovements.reduce(
                (sum, row) => sum + movementValue(row),
                0
            ),
        },
        movementTrend: buildTrend(filteredMovements, period.from, period.to, groupBy),
        movementTypeBreakdown: movementBreakdown(filteredMovements),
        warehouseBreakdown: breakdownArgs.warehouses,
        branchBreakdown: breakdownArgs.branches,
        categoryBreakdown: breakdownArgs.categories,
        brandBreakdown: breakdownArgs.brands,
        topStockValue: [...stockRows]
            .sort((a, b) => b.stockValue - a.stockValue)
            .slice(0, MAX_RANKING_ROWS),
        movers: {
            fast: stockRows
                .filter((row) => row.moverClass === "fast")
                .sort((a, b) => b.periodSaleQty - a.periodSaleQty)
                .slice(0, MAX_RANKING_ROWS)
                .map(rank),
            slow: stockRows
                .filter((row) => row.moverClass === "slow")
                .sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale)
                .slice(0, MAX_RANKING_ROWS)
                .map(rank),
            dead: stockRows
                .filter((row) => row.moverClass === "dead")
                .sort((a, b) => b.stockValue - a.stockValue)
                .slice(0, MAX_RANKING_ROWS)
                .map(rank),
        },
        reorderAlerts,
        stockRows: {
            items: stockRows.slice(
                (stockPage - 1) * stockLimit,
                stockPage * stockLimit
            ),
            pagination: pagination(stockPage, stockLimit, stockTotal),
        },
        movementRows: {
            items: movementRowsAll.slice(
                (movementPage - 1) * movementLimit,
                movementPage * movementLimit
            ),
            pagination: pagination(movementPage, movementLimit, movementTotal),
        },
        options: {
            branches: branches.map((row) => ({
                id: id(row._id),
                label: row.name,
                code: row.branchCode || "",
            })),
            warehouses: warehouses.map((row) => ({
                id: id(row._id),
                label: row.warehouseName,
                code: row.warehouseCode || "",
            })),
            categories: categories.map((row) => ({
                id: id(row._id),
                label: row.name,
                code: "",
            })),
            brands: brands.map((row) => ({
                id: id(row._id),
                label: row.name,
                code: "",
            })),
            movementTypes: MOVEMENT_TYPES.map((value) => ({
                id: value,
                label: value,
                code: value,
            })),
        },
    };
};

const emptyDashboard = ({
    company,
    period,
    groupBy,
    query,
    slowMoverDays,
    deadStockDays,
    managedBranchIds,
}) => {
    const emptyPagination = (pageName, limitName, defaultLimit) =>
        pagination(
            Math.max(parseInt(query[pageName], 10) || 1, 1),
            Math.min(Math.max(parseInt(query[limitName], 10) || defaultLimit, 1), 100),
            0
        );
    return {
        meta: {
            reportType: "inventory_dashboard",
            generatedAt: new Date().toISOString(),
            snapshotAsOf: new Date().toISOString(),
            company,
            currency: company.currency || "USD",
            timezone: "UTC",
            companyTimezone: company.timezone || null,
            filters: {
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                groupBy,
                branchId: query.branchId || null,
                warehouseId: query.warehouseId || null,
                categoryId: query.categoryId || null,
                brandId: query.brandId || null,
                productId: query.productId || null,
                productVariantId: query.productVariantId || null,
                trackingType: query.trackingType || null,
                stockStatus: query.stockStatus || null,
                movementType: query.movementType || null,
                movementDirection: query.movementDirection || null,
                search: query.search || null,
                slowMoverDays,
                deadStockDays,
            },
            scope: {
                strategy: "tenant_order_evidence",
                evidencedTupleCount: 0,
                evidencedProductCount: 0,
                evidencedWarehouseCount: 0,
                effectiveBranchIds:
                    managedBranchIds === null ? [] : (managedBranchIds || []).map(String),
            },
            reliability: {
                valuationMethod: "weighted_average_with_fallback",
                valuationCoveragePercent: 0,
                valuedStockRows: 0,
                unvaluedStockRows: 0,
                movementCostCoveragePercent: 0,
                directLinkedMovementCount: 0,
                inferredMovementCount: 0,
                quantityInvariantViolations: 0,
                staleInventoryRows: 0,
                warnings: [
                    "No tenant-owned order evidence exists in the effective branch scope; global inventory and movements were intentionally not queried.",
                    "Legacy opening-only inventory is excluded by the tenant-safe evidence policy.",
                ],
            },
        },
        summary: {
            skuCount: 0,
            productCount: 0,
            totalStock: 0,
            availableStock: 0,
            reservedStock: 0,
            damagedStock: 0,
            inTransitStock: 0,
            stockValue: 0,
            availableValue: 0,
            reservedValue: 0,
            lowStockCount: 0,
            outOfStockCount: 0,
            overStockCount: 0,
            reorderAlertCount: 0,
            imeiAvailable: 0,
            imeiInTransit: 0,
            periodInQty: 0,
            periodOutQty: 0,
            periodNetQty: 0,
            periodMovementValue: 0,
        },
        movementTrend: buildTrend([], period.from, period.to, groupBy),
        movementTypeBreakdown: [],
        warehouseBreakdown: [],
        branchBreakdown: [],
        categoryBreakdown: [],
        brandBreakdown: [],
        topStockValue: [],
        movers: { fast: [], slow: [], dead: [] },
        reorderAlerts: [],
        stockRows: {
            items: [],
            pagination: emptyPagination("stockPage", "stockLimit", 25),
        },
        movementRows: {
            items: [],
            pagination: emptyPagination("movementPage", "movementLimit", 25),
        },
        options: {
            branches: [],
            warehouses: [],
            categories: [],
            brands: [],
            movementTypes: MOVEMENT_TYPES.map((value) => ({
                id: value,
                label: value,
                code: value,
            })),
        },
    };
};

module.exports = { getDashboard };
