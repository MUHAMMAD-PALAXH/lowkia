const mongoose = require("mongoose");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const ProductUnitBarcode = require("../model/productUnitBarcode");
const Inventory = require("../model/inventory");
const SalesOrder = require("../model/salesOrder");
const AppError = require("../utils/appError");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { generateUnitBarcodes } = require("./barcodeGenerator");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const isImeiTracking = (trackingType) => {
    const t = String(trackingType || "").toUpperCase();
    return t.includes("IMEI") && !t.includes("NON");
};

const mintUnits = async ({
    companyId,
    productId,
    productVariantId = null,
    quantity,
    sourceType = "other",
    sourceId = null,
    warehouseId = null,
    branchId = null,
    status = "available",
    session = null,
    soldInfo = null,
}) => {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (qty < 1) return [];
    if (!companyId) throw new AppError("Company context is required.", 403);

    const pid = toObjectId(productId);
    if (!pid) throw new AppError("Invalid productId.", 400);

    const codes = await generateUnitBarcodes(qty);
    const rows = codes.map((barcode) =>
        stampCompany(
            {
                productId: pid,
                productVariantId: toObjectId(productVariantId),
                warehouseId: toObjectId(warehouseId),
                branchId: toObjectId(branchId),
                barcode,
                status,
                sourceType,
                sourceId: toObjectId(sourceId),
                soldInfo: soldInfo || undefined,
            },
            companyId
        )
    );

    const inserted = await ProductUnitBarcode.insertMany(rows, {
        session: session || undefined,
        ordered: true,
    });
    return inserted;
};

const markSoldFifo = async ({
    companyId,
    productId,
    productVariantId = null,
    quantity,
    salesOrderId = null,
    session = null,
}) => {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (qty < 1) return { marked: 0 };

    const tenant = companyFilter(companyId);
    const pid = toObjectId(productId);
    const vid = toObjectId(productVariantId);

    const filter = {
        productId: pid,
        status: "available",
        ...NOT_DELETED,
        ...tenant,
    };
    if (vid) filter.productVariantId = vid;
    else filter.$or = [{ productVariantId: null }, { productVariantId: { $exists: false } }];

    const units = await ProductUnitBarcode.find(filter)
        .sort({ createdAt: 1 })
        .limit(qty)
        .session(session || null);

    if (!units.length) return { marked: 0 };

    const ids = units.map((u) => u._id);
    const soldAt = new Date();
    await ProductUnitBarcode.updateMany(
        { _id: { $in: ids } },
        {
            $set: {
                status: "sold",
                "soldInfo.salesOrderId": toObjectId(salesOrderId),
                "soldInfo.soldAt": soldAt,
            },
        },
        { session: session || undefined }
    );

    return { marked: ids.length };
};

const unmarkSoldFifo = async ({
    companyId,
    productId,
    productVariantId = null,
    quantity,
    session = null,
}) => {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (qty < 1) return { unmarked: 0 };

    const tenant = companyFilter(companyId);
    const pid = toObjectId(productId);
    const vid = toObjectId(productVariantId);

    const filter = {
        productId: pid,
        status: "sold",
        ...NOT_DELETED,
        ...tenant,
    };
    if (vid) filter.productVariantId = vid;

    const units = await ProductUnitBarcode.find(filter)
        .sort({ "soldInfo.soldAt": -1, updatedAt: -1 })
        .limit(qty)
        .session(session || null);

    if (!units.length) return { unmarked: 0 };

    const ids = units.map((u) => u._id);
    await ProductUnitBarcode.updateMany(
        { _id: { $in: ids } },
        {
            $set: {
                status: "available",
                "soldInfo.salesOrderId": null,
                "soldInfo.soldAt": null,
            },
        },
        { session: session || undefined }
    );

    return { unmarked: ids.length };
};

const voidAvailableUnits = async ({
    companyId,
    productId,
    productVariantId = null,
    quantity,
    session = null,
}) => {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (qty < 1) return { voided: 0 };

    const tenant = companyFilter(companyId);
    const filter = {
        productId: toObjectId(productId),
        status: "available",
        ...NOT_DELETED,
        ...tenant,
    };
    if (productVariantId) {
        filter.productVariantId = toObjectId(productVariantId);
    }

    const units = await ProductUnitBarcode.find(filter)
        .sort({ createdAt: -1 })
        .limit(qty)
        .session(session || null);

    if (!units.length) return { voided: 0 };

    await ProductUnitBarcode.updateMany(
        { _id: { $in: units.map((u) => u._id) } },
        { $set: { status: "void" } },
        { session: session || undefined }
    );
    return { voided: units.length };
};

const liveAvailableByVariant = async (productId) => {
    const pid = toObjectId(productId);
    const rows = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true },
            },
        },
        {
            $group: {
                _id: "$productVariantId",
                availableStock: { $sum: "$availableStock" },
                currentStock: { $sum: "$currentStock" },
            },
        },
    ]);

    const map = new Map();
    for (const row of rows) {
        const key = row._id ? String(row._id) : "null";
        const available =
            Number(row.availableStock) || Number(row.currentStock) || 0;
        map.set(key, Math.max(available, 0));
    }
    return map;
};

const soldQtyByVariant = async (productId, companyId = null) => {
    const pid = toObjectId(productId);
    const match = {
        isDeleted: { $ne: true },
        status: { $in: ["Confirmed", "Processing", "Completed"] },
        "items.productId": pid,
    };
    if (companyId) match.companyId = toObjectId(companyId);

    const rows = await SalesOrder.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
            $match: {
                "items.productId": pid,
            },
        },
        {
            $group: {
                _id: "$items.productVariantId",
                soldQty: {
                    $sum: {
                        $max: [
                            0,
                            {
                                $subtract: [
                                    {
                                        $ifNull: [
                                            "$items.deliveredQuantity",
                                            "$items.quantity",
                                        ],
                                    },
                                    { $ifNull: ["$items.returnedQuantity", 0] },
                                ],
                            },
                        ],
                    },
                },
            },
        },
    ]);

    const map = new Map();
    for (const row of rows) {
        const key = row._id ? String(row._id) : "null";
        map.set(key, Math.max(Number(row.soldQty) || 0, 0));
    }
    return map;
};

/**
 * Reconcile unit barcodes so available/sold counts match live stock + sold qty.
 * Safe for existing catalogs (self-heals on export/print).
 */
const ensureProductUnits = async (productId, companyId = null) => {
    const tenant = companyFilter(companyId);
    const pid = toObjectId(productId);
    const product = await Product.findOne({
        _id: pid,
        ...NOT_DELETED,
        ...tenant,
    })
        .select("_id trackingType companyId")
        .lean();

    if (!product) throw new AppError("Product not found.", 404);
    if (isImeiTracking(product.trackingType)) {
        return { skipped: true, reason: "imei" };
    }

    const variants = await ProductVariant.find({
        productId: pid,
        isDeleted: { $ne: true },
    })
        .select("_id quantity")
        .lean();

    const invByVariant = await liveAvailableByVariant(pid);
    const soldByVariant = await soldQtyByVariant(pid, companyId);

    let mintedAvailable = 0;
    let mintedSold = 0;
    let voided = 0;

    const scopes = variants.length
        ? variants.map((v) => ({
              variantId: v._id,
              key: String(v._id),
              catalogQty: Math.max(Number(v.quantity) || 0, 0),
          }))
        : [{ variantId: null, key: "null", catalogQty: 0 }];

    for (const scope of scopes) {
        const fromInv = invByVariant.get(scope.key) || 0;
        // Prefer inventory; fall back to catalog opening qty for Manual seed.
        const desiredAvailable =
            fromInv > 0
                ? fromInv
                : scope.catalogQty > 0
                  ? scope.catalogQty
                  : fromInv;
        const desiredSold = soldByVariant.get(scope.key) || 0;

        const unitFilter = {
            productId: pid,
            ...NOT_DELETED,
            ...tenant,
        };
        if (scope.variantId) {
            unitFilter.productVariantId = scope.variantId;
        } else {
            unitFilter.$or = [
                { productVariantId: null },
                { productVariantId: { $exists: false } },
            ];
        }

        const [availableCount, soldCount] = await Promise.all([
            ProductUnitBarcode.countDocuments({
                ...unitFilter,
                status: "available",
            }),
            ProductUnitBarcode.countDocuments({
                ...unitFilter,
                status: "sold",
            }),
        ]);

        if (availableCount < desiredAvailable) {
            const minted = await mintUnits({
                companyId,
                productId: pid,
                productVariantId: scope.variantId,
                quantity: desiredAvailable - availableCount,
                sourceType: "reconcile",
                status: "available",
            });
            mintedAvailable += minted.length;
        } else if (availableCount > desiredAvailable) {
            const result = await voidAvailableUnits({
                companyId,
                productId: pid,
                productVariantId: scope.variantId,
                quantity: availableCount - desiredAvailable,
            });
            voided += result.voided;
        }

        if (soldCount < desiredSold) {
            const minted = await mintUnits({
                companyId,
                productId: pid,
                productVariantId: scope.variantId,
                quantity: desiredSold - soldCount,
                sourceType: "sale_backfill",
                status: "sold",
                soldInfo: { soldAt: new Date() },
            });
            mintedSold += minted.length;
        }
    }

    return {
        skipped: false,
        mintedAvailable,
        mintedSold,
        voided,
    };
};

const ensureProductsUnits = async (productIds = [], companyId = null) => {
    const results = [];
    for (const id of productIds) {
        try {
            results.push({
                productId: String(id),
                ...(await ensureProductUnits(id, companyId)),
            });
        } catch (err) {
            results.push({
                productId: String(id),
                error: err.message || "ensure failed",
            });
        }
    }
    return results;
};

const listUnitBarcodes = async ({
    productIds = [],
    companyId = null,
    barcodeStatus = "all",
    limit = 10000,
} = {}) => {
    const tenant = companyFilter(companyId);
    const ids = (Array.isArray(productIds) ? productIds : [])
        .map((id) => toObjectId(id))
        .filter(Boolean);
    if (!ids.length) return [];

    const filter = {
        productId: { $in: ids },
        ...NOT_DELETED,
        ...tenant,
        status: { $ne: "void" },
    };

    const status = String(barcodeStatus || "all").toLowerCase();
    if (status === "available") filter.status = "available";
    else if (status === "sold") filter.status = "sold";

    return ProductUnitBarcode.find(filter)
        .select(
            "productId productVariantId barcode status soldInfo createdAt"
        )
        .sort({ productId: 1, status: 1, createdAt: 1 })
        .limit(Math.min(Math.max(Number(limit) || 10000, 1), 10000))
        .lean();
};

const findProductByUnitBarcode = async (barcode, companyId = null) => {
    const value = String(barcode || "").trim();
    if (!value) return null;
    const tenant = companyFilter(companyId);
    return ProductUnitBarcode.findOne({
        barcode: value,
        status: { $ne: "void" },
        ...NOT_DELETED,
        ...tenant,
    }).lean();
};

module.exports = {
    mintUnits,
    markSoldFifo,
    unmarkSoldFifo,
    voidAvailableUnits,
    ensureProductUnits,
    ensureProductsUnits,
    listUnitBarcodes,
    findProductByUnitBarcode,
};
