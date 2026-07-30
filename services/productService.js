const mongoose = require("mongoose");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const ItemTrack = require("../model/itemTrack");
const Inventory = require("../model/inventory");
const PurchaseOrder = require("../model/purchaseOrder");
const Supplier = require("../model/supplier");
const Category = require("../model/category");
const SubCategory = require("../model/subCategory");
const Brand = require("../model/brand");
const { generateProductCode } = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };

// Fields the client may never set directly.
// Stock lives in the Inventory Service, codes are generated, approval is a workflow.
// productVariants holds ObjectId refs and is rebuilt by syncVariants.
const PROTECTED_FIELDS = [
    "productVariants",
    "productCode",
    "barcode",
    "barcodeType",
    "barcodeGeneratedAt",
    "uploadedByType",
    "uploadedById",
    "uploadedByModel",
    "uploadedByName",
    "uploadedAt",
    "approvalStatus",
    "approvalRequired",
    "approvedBy",
    "approvedByName",
    "approvedAt",
    "rejectedBy",
    "rejectedByName",
    "rejectedAt",
    "rejectionReason",
    "approvalHistory",
    "submittedForApprovalAt",
    "totalStock",
    "availableStock",
    "reservedStock",
    "damagedStock",
    "inTransitStock",
    "warehouseStock",
    "totalImeiCount",
    "stockValue",
    "lastStockUpdatedAt",
    "lastPurchasePrice",
    "averagePurchasePrice",
    "lastPurchaseDate",
    "grossProfit",
    "profitMarginPercent",
    "totalViews",
    "totalShares",
    "totalWishlist",
    "averageRating",
    "totalReviews",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const slugify = (value = "") =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };
    PROTECTED_FIELDS.forEach((field) => delete data[field]);
    return data;
};

// ==========================================================
// Validation helpers
// ==========================================================

const validateMasterRefs = async (data, { required = false } = {}) => {
    const categoryId = toObjectId(data.proCategoryId);
    const subCategoryId = toObjectId(data.proSubCategoryId);
    const brandId = toObjectId(data.proBrandId);

    if (required) {
        if (!categoryId) throw new AppError("Category is required.", 400);
        if (!subCategoryId) throw new AppError("Sub category is required.", 400);
        if (!brandId) throw new AppError("Brand is required.", 400);
    }

    if (categoryId) {
        const category = await Category.exists({ _id: categoryId });
        if (!category) throw new AppError("Selected category not found.", 404);
    }
    if (subCategoryId) {
        const subCategory = await SubCategory.exists({ _id: subCategoryId });
        if (!subCategory) {
            throw new AppError("Selected sub category not found.", 404);
        }
    }
    if (brandId) {
        const brand = await Brand.exists({ _id: brandId });
        if (!brand) throw new AppError("Selected brand not found.", 404);
    }

    return { categoryId, subCategoryId, brandId };
};

// A product may be supplied by many suppliers. Exactly one can be primary.
const normalizeSuppliers = async (input) => {
    if (input === undefined || input === null) return undefined;
    if (!Array.isArray(input)) {
        throw new AppError("suppliers must be an array.", 400);
    }

    const seen = new Set();
    const rows = [];

    input.forEach((item) => {
        const raw = typeof item === "string" ? { supplierId: item } : item || {};
        const supplierId = toObjectId(raw.supplierId);
        if (!supplierId) return;

        const key = String(supplierId);
        if (seen.has(key)) return;
        seen.add(key);

        rows.push({
            supplierId,
            isPrimary: raw.isPrimary === true || raw.isPrimary === "true",
            supplierSku: (raw.supplierSku || "").toString().trim(),
            lastPurchasePrice: Number(raw.lastPurchasePrice) || 0,
            leadTimeDays: Number(raw.leadTimeDays) || 0,
            notes: (raw.notes || "").toString().trim()
        });
    });

    if (rows.length) {
        const count = await Supplier.countDocuments({
            _id: { $in: rows.map((r) => r.supplierId) },
            ...NOT_DELETED
        });

        if (count !== rows.length) {
            throw new AppError(
                "One or more selected suppliers are invalid or deleted.",
                400
            );
        }

        const primaries = rows.filter((r) => r.isPrimary);
        if (primaries.length === 0) {
            rows[0].isPrimary = true;
        } else if (primaries.length > 1) {
            rows.forEach((r, index) => {
                r.isPrimary = index === rows.indexOf(primaries[0]);
            });
        }
    }

    return rows;
};

const resolvePrimarySupplier = (suppliers = []) => {
    const primary = suppliers.find((s) => s.isPrimary) || suppliers[0];
    return primary ? primary.supplierId : null;
};

const normalizeUploader = (payload = {}) => {
    const allowed = ["Owner", "Employee", "Vendor"];
    const uploadedByType = allowed.includes(payload.uploadedByType)
        ? payload.uploadedByType
        : "Owner";

    const uploadedById = toObjectId(payload.uploadedById);
    let uploadedByModel = null;

    if (uploadedById) {
        uploadedByModel =
            uploadedByType === "Employee" ? "Employee" : "AdminUser";
    }

    return {
        uploadedByType,
        uploadedById,
        uploadedByModel,
        uploadedByName: (payload.uploadedByName || "").toString().trim()
    };
};

const PRODUCT_SOURCE_TYPES = ["Manual", "PurchaseOrder", "ThirdParty"];
const OWNERSHIP_TYPES = ["Owned", "ThirdParty"];

const normalizeProductSource = (payload = {}) => {
    const source =
        PRODUCT_SOURCE_TYPES.includes(payload.productSourceType)
            ? payload.productSourceType
            : "Manual";
    const ownership =
        OWNERSHIP_TYPES.includes(payload.ownershipType)
            ? payload.ownershipType
            : source === "ThirdParty"
              ? "ThirdParty"
              : "Owned";

    return {
        productSourceType: source,
        ownershipType: ownership,
        sourcePurchaseOrderId: toObjectId(payload.sourcePurchaseOrderId),
        sourcePurchaseOrderItemId: toObjectId(payload.sourcePurchaseOrderItemId),
        sourcePurchaseOrderNo: (payload.sourcePurchaseOrderNo || "")
            .toString()
            .trim(),
        sourceSupplierId: toObjectId(payload.sourceSupplierId)
    };
};

const populateProduct = (query) =>
    query
        .populate("proCategoryId", "name")
        .populate("proSubCategoryId", "name")
        .populate("proBrandId", "name")
        .populate("proVariantTypeId", "type name")
        .populate("unitId", "name shortName")
        .populate("suppliers.supplierId", "supplierCode name phone email status")
        .populate("primarySupplierId", "supplierCode name phone email status")
        .populate("warehouseStock.warehouseId", "warehouseCode warehouseName city");

// Terminal / finished POs do not block product trash.
const CLOSED_PO_STATUSES = [
    "Cancelled",
    "Completed",
    "Closed",
    "Rejected",
    "Received"
];

// POs we can auto-cancel then soft-delete when force-trashing a product.
const AUTO_RESOLVE_PO_STATUSES = [
    "Draft",
    "Pending Approval",
    "Approved",
    "Ordered",
    "Cancelled"
];

const poCanAutoResolve = (status) =>
    AUTO_RESOLVE_PO_STATUSES.includes(String(status || ""));

const mapOpenPurchaseOrder = (doc) => {
    const status = doc.status || "";
    const canAutoResolve = poCanAutoResolve(status);
    // Received stock means the PO stays as history — unlink product instead.
    const canUnlink = !canAutoResolve;
    return {
        id: String(doc._id),
        purchaseOrderNo: doc.purchaseOrderNo || "",
        status,
        orderDate: doc.orderDate || null,
        canAutoResolve,
        canUnlink,
        canCancel: !["Received", "Completed", "Partially Received", "Cancelled"].includes(
            status
        ),
        canTrash: ["Draft", "Cancelled"].includes(status),
        supplier: doc.supplierId
            ? {
                  id: String(doc.supplierId._id || ""),
                  supplierCode: doc.supplierId.supplierCode || "",
                  name: doc.supplierId.name || ""
              }
            : null,
        warehouse: doc.warehouseId
            ? {
                  id: String(doc.warehouseId._id || ""),
                  warehouseCode: doc.warehouseId.warehouseCode || "",
                  warehouseName: doc.warehouseId.warehouseName || ""
              }
            : null,
        branch: doc.branchId
            ? {
                  id: String(doc.branchId._id || ""),
                  branchCode: doc.branchId.branchCode || "",
                  name: doc.branchId.name || ""
              }
            : null
    };
};

const getBlockingPurchaseOrders = async (productId, limit = 20) => {
    try {
        const PurchaseOrderModel = mongoose.models.PurchaseOrder;
        if (!PurchaseOrderModel) return [];

        const docs = await PurchaseOrderModel.find({
            "items.productId": productId,
            status: { $nin: CLOSED_PO_STATUSES },
            isDeleted: { $ne: true }
        })
            .select(
                "purchaseOrderNo status orderDate supplierId warehouseId branchId"
            )
            .populate("supplierId", "supplierCode name")
            .populate("warehouseId", "warehouseCode warehouseName")
            .populate("branchId", "branchCode name")
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return docs.map(mapOpenPurchaseOrder);
    } catch (error) {
        return [];
    }
};

const hasOpenPurchaseOrder = async (productId) => {
    const rows = await getBlockingPurchaseOrders(productId, 1);
    return rows.length > 0;
};

const beforeProductSoftDelete = async (doc) => {
    if ((Number(doc.totalStock) || 0) > 0) {
        throw new AppError(
            'Cannot delete product while stock exists. Clear stock first (or use "Resolve & trash").',
            400
        );
    }

    const imeiCount = await ItemTrack.countDocuments({
        productId: doc._id,
        status: { $ne: "deleted" }
    });

    if (imeiCount > 0) {
        throw new AppError(
            `Cannot delete product while ${imeiCount} IMEI record(s) exist. Clear stock / IMEIs first (or use "Resolve & trash").`,
            400
        );
    }

    const openOrders = await getBlockingPurchaseOrders(doc._id, 5);
    if (openOrders.length) {
        const labels = openOrders
            .map((o) => `${o.purchaseOrderNo || o.id} (${o.status})`)
            .join(", ");
        throw new AppError(
            `Cannot delete product while it is on open purchase order(s): ${labels}. Cancel/trash those POs first (or use "Resolve & trash").`,
            400
        );
    }
};

const getProductDeleteCheck = async (id) => {
    const product = await populateProduct(
        Product.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!product) throw new AppError("Product not found.", 404);

    const imeiCount = await ItemTrack.countDocuments({
        productId: product._id,
        status: { $ne: "deleted" }
    });
    const blockedImeiCount = await ItemTrack.countDocuments({
        productId: product._id,
        status: { $in: ["sold", "repairing", "in-transit"] }
    });
    const openPurchaseOrders = await getBlockingPurchaseOrders(product._id);

    const stock = {
        total: Number(product.totalStock) || 0,
        available: Number(product.availableStock) || 0,
        reserved: Number(product.reservedStock) || 0
    };

    const canAutoResolvePos =
        openPurchaseOrders.length > 0 &&
        openPurchaseOrders.every((o) => o.canAutoResolve);
    const canUnlinkPos =
        openPurchaseOrders.length === 0 ||
        openPurchaseOrders.every((o) => o.canAutoResolve || o.canUnlink);
    const canClearStock =
        stock.total > 0 &&
        stock.reserved <= 0 &&
        blockedImeiCount <= 0;
    const canDelete =
        stock.total <= 0 &&
        imeiCount <= 0 &&
        openPurchaseOrders.length === 0;
    const canForceTrash =
        canDelete ||
        ((stock.total <= 0 || canClearStock) &&
            canUnlinkPos &&
            blockedImeiCount <= 0);

    return {
        canDelete,
        canForceTrash,
        canClearStock,
        canAutoResolvePos,
        canUnlinkPos,
        stock,
        imeiCount,
        blockedImeiCount,
        warehouseStock: (product.warehouseStock || []).map((row) => ({
            warehouseId: row.warehouseId?._id || row.warehouseId || null,
            warehouseCode: row.warehouseId?.warehouseCode || "",
            warehouseName: row.warehouseId?.warehouseName || "",
            quantity: Number(row.quantity) || 0,
            availableQuantity: Number(row.availableQuantity) || 0,
            reservedQuantity: Number(row.reservedQuantity) || 0
        })),
        openPurchaseOrders
    };
};

/**
 * Keep Partially Received / Ordered POs as history, but detach this product
 * so the catalog entry can be trashed.
 */
const unlinkProductFromPurchaseOrders = async (productId, actorId = null) => {
    const pos = await PurchaseOrder.find({
        "items.productId": productId,
        status: { $nin: CLOSED_PO_STATUSES },
        isDeleted: { $ne: true }
    });

    const unlinked = [];
    for (const po of pos) {
        let changed = false;
        for (const item of po.items || []) {
            if (String(item.productId || "") !== String(productId)) continue;
            if (!item.productName) {
                item.productName = "Unlinked product";
            }
            item.productId = null;
            item.productVariantId = null;
            changed = true;
        }
        if (!changed) continue;
        po.updatedBy = toObjectId(actorId) || po.updatedBy;
        po.markModified("items");
        await po.save();
        unlinked.push({
            id: String(po._id),
            purchaseOrderNo: po.purchaseOrderNo || "",
            status: po.status || ""
        });
    }
    return unlinked;
};

/**
 * Clears resolvable blockers (stock + draft/open POs) then soft-deletes.
 * Used by the friendly "Resolve & trash" product UI.
 */
const prepareAndTrashProduct = async (id, actorId = null) => {
    const product = await findProductOrFail(id);
    const steps = [];

    // 1) Clear warehouse / available IMEI stock when possible
    const stockTotal = Number(product.totalStock) || 0;
    const reserved = Number(product.reservedStock) || 0;
    const blockedImeiCount = await ItemTrack.countDocuments({
        productId: product._id,
        status: { $in: ["sold", "repairing", "in-transit"] }
    });

    if (stockTotal > 0 || reserved > 0) {
        if (reserved > 0) {
            throw new AppError(
                "Cannot clear reserved stock automatically. Unreserve first, then retry.",
                400
            );
        }
        if (blockedImeiCount > 0) {
            throw new AppError(
                `Cannot clear stock: ${blockedImeiCount} IMEI(s) are sold, repairing, or in-transit.`,
                400
            );
        }
        const inventoryService = require("./inventoryService");
        const cleared = await inventoryService.clearProductStock(
            product._id,
            actorId
        );
        steps.push({
            action: "clearStock",
            clearedQty: cleared.clearedQty || 0,
            clearedImeis: cleared.clearedImeis || 0
        });
    } else if (
        (await ItemTrack.countDocuments({
            productId: product._id,
            status: "available"
        })) > 0
    ) {
        const inventoryService = require("./inventoryService");
        const cleared = await inventoryService.clearProductStock(
            product._id,
            actorId
        );
        steps.push({
            action: "clearStock",
            clearedQty: cleared.clearedQty || 0,
            clearedImeis: cleared.clearedImeis || 0
        });
    }

    // 2) Resolve linked open POs:
    //    - Draft/Ordered-like → cancel + trash PO
    //    - Partially Received / locked → unlink product, keep PO as history
    const openPos = await getBlockingPurchaseOrders(product._id, 50);
    const purchaseOrderService = require("./purchaseOrderService");
    const autoPos = openPos.filter((o) => o.canAutoResolve);
    const unlinkPos = openPos.filter((o) => !o.canAutoResolve && o.canUnlink);
    const blockedPos = openPos.filter(
        (o) => !o.canAutoResolve && !o.canUnlink
    );

    if (blockedPos.length) {
        throw new AppError(
            `Cannot resolve purchase order(s): ${blockedPos
                .map((o) => `${o.purchaseOrderNo} (${o.status})`)
                .join(", ")}.`,
            400
        );
    }

    for (const po of autoPos) {
        if (po.status !== "Cancelled" && po.status !== "Draft") {
            await purchaseOrderService.cancelPurchaseOrder(
                po.id,
                actorId,
                "Auto-cancelled to trash linked product"
            );
            steps.push({
                action: "cancelPo",
                purchaseOrderNo: po.purchaseOrderNo,
                id: po.id
            });
        }
        await purchaseOrderService.deletePurchaseOrder(po.id, actorId);
        steps.push({
            action: "trashPo",
            purchaseOrderNo: po.purchaseOrderNo,
            id: po.id
        });
    }

    if (unlinkPos.length) {
        const unlinked = await unlinkProductFromPurchaseOrders(
            product._id,
            actorId
        );
        for (const row of unlinked) {
            steps.push({
                action: "unlinkPo",
                purchaseOrderNo: row.purchaseOrderNo,
                id: row.id,
                status: row.status
            });
        }
    }

    // 3) Soft-delete the product
    const deleted = await deleteProduct(id, actorId);
    steps.push({ action: "trashProduct", id: String(deleted._id) });

    return {
        productId: String(deleted._id),
        productName: deleted.name || "",
        steps
    };
};

const trash = createTrashOps(Product, {
    label: "Product",
    nameField: "name",
    softDeleteExtra: (doc) => {
        doc.status = "Archived";
        doc.isPublished = false;
    },
    restoreStatus: "Inactive",
    beforeSoftDelete: beforeProductSoftDelete,
    beforePermanent: async (doc) => {
        await ProductVariant.deleteMany({ productId: doc._id });
    },
    scopeStatusMap: {
        active: "Active",
        inactive: "Inactive",
        draft: "Draft",
        archived: "Archived"
    }
});

const findProductOrFail = trash.findActiveOrFail;

const pushApproval = (product, action, actor = {}, note = "") => {
    product.approvalHistory.push({
        action,
        actorType: actor.type || "System",
        actorId: toObjectId(actor.id),
        actorName: actor.name || "",
        note,
        at: new Date()
    });
};

const getPoSourceLine = async (sourcePurchaseOrderId, sourcePurchaseOrderItemId) => {
    if (!sourcePurchaseOrderId || !sourcePurchaseOrderItemId) {
        throw new AppError(
            "sourcePurchaseOrderId and sourcePurchaseOrderItemId are required for PO-linked products.",
            400
        );
    }

    const po = await PurchaseOrder.findOne({
        _id: sourcePurchaseOrderId,
        ...NOT_DELETED
    })
        .populate("supplierId", "supplierCode name phone email")
        .populate(
            "items.productId",
            "name productCode sku trackingType productType purchasePrice costPrice sellingPrice wholesalePrice warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId manufacturer countryOfOrigin hsnCode"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString purchasePrice costPrice sellingPrice wholesalePrice"
        );

    if (!po) throw new AppError("Source purchase order not found.", 404);
    if (!["Received", "Completed"].includes(po.status)) {
        throw new AppError(
            "Only Received / Completed purchase orders can be used as a product source.",
            400
        );
    }

    const line = (po.items || []).find(
        (item) => String(item._id) === String(sourcePurchaseOrderItemId)
    );
    if (!line) {
        throw new AppError("Source purchase order line not found.", 404);
    }

    return { po, line };
};

// ==========================================================
// Variants (existing multi-variant functionality)
// ==========================================================

const normalizeAttributes = (attributes = []) =>
    (Array.isArray(attributes) ? attributes : [])
        .map((a) => ({
            variantTypeId: toObjectId(a?.variantTypeId),
            variantId: toObjectId(a?.variantId)
        }))
        .filter((a) => a.variantTypeId && a.variantId)
        .sort((a, b) =>
            String(a.variantTypeId).localeCompare(String(b.variantTypeId))
        );

const mapVariantWriteError = (err) => {
    if (err instanceof AppError) return err;
    if (err && err.code === 11000) {
        const fields = Object.keys(err.keyPattern || {});
        if (fields.includes("sku")) {
            return new AppError(
                "Duplicate variant SKU. Each combination needs a unique SKU (or leave SKU blank).",
                400
            );
        }
        if (fields.includes("barcode")) {
            return new AppError(
                "Duplicate variant barcode. Please retry — a unique barcode will be generated.",
                400
            );
        }
        // Combination conflicts are recovered in syncVariants — only surface if recovery failed
        return new AppError(
            "Could not save a variant combination. Please try again.",
            400
        );
    }
    if (err && err.name === "ValidationError") {
        return new AppError(err.message, 400);
    }
    return err;
};

/** Prefer active row, otherwise revive a soft-deleted match. */
const findVariantForUpsert = async (productId, existingId, attributes) => {
    if (existingId) {
        const byId = await ProductVariant.findOne({
            _id: existingId,
            productId
        });
        if (byId) return byId;
    }

    if (attributes.length > 0) {
        const active = await ProductVariant.findOne({
            productId,
            isDeleted: { $ne: true },
            attributes
        });
        if (active) return active;

        return ProductVariant.findOne({
            productId,
            isDeleted: true,
            attributes
        }).sort({ updatedAt: -1 });
    }

    // Simple / default variant (no attributes)
    const activeDefault = await ProductVariant.findOne({
        productId,
        isDeleted: { $ne: true },
        $or: [{ attributes: { $size: 0 } }, { attributes: [] }]
    });
    if (activeDefault) return activeDefault;

    return ProductVariant.findOne({
        productId,
        isDeleted: true,
        $or: [{ attributes: { $size: 0 } }, { attributes: [] }]
    }).sort({ updatedAt: -1 });
};

const syncVariants = async (product, variantsInput, actorId = null) => {
    if (variantsInput === undefined || variantsInput === null) return;
    if (!Array.isArray(variantsInput)) {
        throw new AppError("productVariants must be an array.", 400);
    }

    const keptIds = [];
    const vendorId =
        product.vendorId ||
        (product.uploadedByType === "Vendor" ? product.uploadedById : null) ||
        actorId;
    const seenSkus = new Set();
    const productCode = (product.productCode || "VAR").toString();

    // Legacy rows used barcode: "" which breaks the sparse unique index.
    await ProductVariant.updateMany(
        { barcode: "" },
        { $unset: { barcode: 1 } }
    );

    // Drop legacy unique indexes that blocked soft-deleted + edit re-saves.
    // New partial indexes are defined on the model.
    try {
        const indexes = await ProductVariant.collection.indexes();
        for (const idx of indexes) {
            const name = idx.name || "";
            if (
                name === "productId_1_attributes_1" ||
                name === "sku_1" ||
                name === "barcode_1"
            ) {
                // Only drop if it is the old non-partial unique form
                if (idx.unique && !idx.partialFilterExpression) {
                    await ProductVariant.collection.dropIndex(name);
                }
            }
        }
        await ProductVariant.syncIndexes();
    } catch (_) {
        // Index heal is best-effort; upsert logic below still recovers conflicts.
    }

    try {
        for (let index = 0; index < variantsInput.length; index += 1) {
            const raw = variantsInput[index];
            const sellingPrice =
                Number(raw.sellingPrice) || Number(raw.price) || 0;
            const attributes = normalizeAttributes(raw.attributes);
            const label =
                (raw.combinationString || "").toString().trim() ||
                `Variant ${index + 1}`;

            if (variantsInput.length > 1 && attributes.length === 0) {
                throw new AppError(
                    `Variant "${label}" is missing Color/Size attributes. Re-select variant values and try again.`,
                    400
                );
            }

            let sku =
                (raw.sku || "").toString().trim().toUpperCase() || undefined;
            if (!sku && variantsInput.length > 1) {
                const slug = label
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 24);
                sku = `${productCode}-${slug || index + 1}`;
            }
            if (sku) {
                // Same payload may list the same SKU twice — auto-suffix instead of failing.
                if (seenSkus.has(sku)) {
                    sku = `${sku}-${index + 1}`;
                }
                seenSkus.add(sku);
            }

            const existingId = toObjectId(raw._id || raw.id);
            let variantDoc = await findVariantForUpsert(
                product._id,
                existingId,
                attributes
            );

            const payload = {
                productId: product._id,
                attributes,
                combinationString: label,
                purchasePrice: Number(raw.purchasePrice) || 0,
                costPrice: Number(raw.costPrice) || 0,
                sellingPrice,
                wholesalePrice: Number(raw.wholesalePrice) || 0,
                price: sellingPrice,
                offerPrice: Number(raw.offerPrice) || 0,
                // Opening qty: Manual / ThirdParty may set on create (and update if no live inventory).
                // PO / GRN stock always comes from Inventory — never overwrite those from the form.
                minimumStock: Number(raw.minimumStock) || 0,
                maximumStock: Number(raw.maximumStock) || 0,
                reorderLevel: Number(raw.reorderLevel) || 0,
                unitId: toObjectId(raw.unitId),
                status: raw.status || "Active",
                isDefaultVariant: raw.isDefaultVariant === true || index === 0,
                updatedBy: toObjectId(actorId),
                isDeleted: false,
                deletedAt: null,
                deletedBy: null
            };
            if (!variantDoc) {
                const sourceType = String(product.productSourceType || "");
                if (sourceType === "Manual" || sourceType === "ThirdParty") {
                    payload.quantity = Math.max(Number(raw.quantity) || 0, 0);
                } else {
                    payload.quantity = 0;
                }
            } else {
                const sourceType = String(product.productSourceType || "");
                if (sourceType === "Manual" || sourceType === "ThirdParty") {
                    const hasInv = await Inventory.exists({
                        productVariantId: variantDoc._id,
                        isDeleted: { $ne: true },
                        $or: [
                            { availableStock: { $gt: 0 } },
                            { currentStock: { $gt: 0 } }
                        ]
                    });
                    if (!hasInv) {
                        payload.quantity = Math.max(Number(raw.quantity) || 0, 0);
                    }
                }
            }

            if (sku) payload.sku = sku;
            else if (!variantDoc?.sku) payload.sku = undefined;

            // Non-IMEI: keep existing barcode on edit; generate only for new rows.
            if (product.trackingType === "Non-IMEI") {
                const incoming = (raw.barcode || "").toString().trim();
                if (incoming) {
                    payload.barcode = incoming;
                } else if (!variantDoc?.barcode) {
                    payload.barcode = await generateProductBarcode();
                }
            }

            if (variantDoc) {
                const $set = { ...payload };
                if (!payload.sku && variantDoc.sku) delete $set.sku;
                if (!payload.barcode && variantDoc.barcode) delete $set.barcode;
                variantDoc = await ProductVariant.findByIdAndUpdate(
                    variantDoc._id,
                    { $set },
                    { new: true }
                );
            } else {
                payload.createdBy = toObjectId(actorId);
                try {
                    variantDoc = await ProductVariant.create(payload);
                } catch (err) {
                    // Race / legacy unique index: update the conflicting row instead.
                    if (err && err.code === 11000) {
                        const conflict = await findVariantForUpsert(
                            product._id,
                            null,
                            attributes
                        );
                        if (!conflict) throw err;
                        const $set = { ...payload };
                        delete $set.createdBy;
                        variantDoc = await ProductVariant.findByIdAndUpdate(
                            conflict._id,
                            { $set },
                            { new: true }
                        );
                    } else {
                        throw err;
                    }
                }
            }

            if (!variantDoc) {
                throw new AppError(
                    `Failed to save variant "${label}".`,
                    500
                );
            }

            keptIds.push(variantDoc._id);

            if (
                product.trackingType === "IMEI" &&
                Array.isArray(raw.imeis) &&
                raw.imeis.length
            ) {
                const existingImeis = await ItemTrack.find({
                    productId: product._id,
                    variantId: variantDoc._id
                }).select("imei");

                const known = new Set(existingImeis.map((i) => i.imei));
                const fresh = raw.imeis
                    .map((i) => String(i).trim())
                    .filter((i) => i && !known.has(i));

                if (fresh.length) {
                    if (!vendorId) {
                        throw new AppError(
                            "Vendor / uploader id is required to register IMEIs.",
                            400
                        );
                    }

                    await ItemTrack.insertMany(
                        fresh.map((imei) => ({
                            imei,
                            productId: product._id,
                            variantId: variantDoc._id,
                            vendorId,
                            status: "available"
                        }))
                    );
                }
            }
        }

        await ProductVariant.updateMany(
            {
                productId: product._id,
                _id: { $nin: keptIds },
                isDeleted: { $ne: true }
            },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    deletedBy: toObjectId(actorId)
                }
            }
        );

        product.productVariants = keptIds;
        product.hasVariants = keptIds.length > 0;
        if (product.hasVariants && product.productType === "Simple") {
            product.productType = "Variant";
        }
    } catch (err) {
        throw mapVariantWriteError(err);
    }
};

// ==========================================================
// Create
// ==========================================================

const createProduct = async (payload = {}, actorId = null) => {
    const data = pickUpdatableFields(payload);
    const name = (data.name || "").toString().trim();

    if (!name) throw new AppError("Product name is required.", 400);

    const { categoryId, subCategoryId, brandId } = await validateMasterRefs(data);

    const duplicate = await Product.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        ...NOT_DELETED
    });

    if (duplicate) {
        throw new AppError("Product with this name already exists.", 409);
    }

    const trackingType =
        data.trackingType === "IMEI" ? "IMEI" : "Non-IMEI";

    const source = normalizeProductSource(payload);
    let poSource = null;
    if (source.productSourceType === "PurchaseOrder") {
        poSource = await getPoSourceLine(
            source.sourcePurchaseOrderId,
            source.sourcePurchaseOrderItemId
        );

        const duplicateSource = await Product.findOne({
            sourcePurchaseOrderItemId: source.sourcePurchaseOrderItemId,
            isDeleted: { $ne: true }
        }).select("name productCode");
        if (duplicateSource) {
            throw new AppError(
                `This purchase-order line is already linked to product "${duplicateSource.name}" (${duplicateSource.productCode}).`,
                409
            );
        }

        if (poSource.line.productId) {
            const existingProduct = await Product.findOne({
                _id: poSource.line.productId,
                isDeleted: { $ne: true }
            }).select("name productCode");
            if (existingProduct) {
                throw new AppError(
                    `This PO line already points to existing product "${existingProduct.name}" (${existingProduct.productCode}). Open that product instead of creating a duplicate.`,
                    409
                );
            }
        }
    }

    const suppliers =
        (await normalizeSuppliers(data.suppliers)) ||
        (poSource?.po?.supplierId
            ? [
                  {
                      supplierId: poSource.po.supplierId._id || poSource.po.supplierId,
                      isPrimary: true,
                      lastPurchasePrice: Number(poSource.line.purchasePrice) || 0,
                      supplierSku: poSource.line.sku || ""
                  }
              ]
            : []);
    const uploader = normalizeUploader(payload);

    const productCode = await generateProductCode();

    // Rules: only Non IMEI products get a barcode, one per product
    let barcode = "";
    let barcodeType = "None";
    if (trackingType === "Non-IMEI") {
        barcode = await generateProductBarcode();
        barcodeType = "EAN13";
    }

    const isOwnerUpload = uploader.uploadedByType === "Owner";

    // Vendor uploads also set vendorId so the user-app /products filter works.
    // Owner / Employee still get vendorId = their account id for catalog ownership
    // (same as the old dashboard form which always set vendorId = req.user._id).
    const vendorId =
        toObjectId(payload.vendorId) ||
        uploader.uploadedById ||
        toObjectId(actorId);

    const sourceProduct = poSource?.line?.productId || null;
    const sourceVariant = poSource?.line?.productVariantId || null;

    const product = new Product({
        ...data,
        name,
        productCode,
        barcode,
        barcodeType,
        barcodeGeneratedAt: barcode ? new Date() : null,
        slug: data.slug ? slugify(data.slug) : slugify(name),
        sku:
            (data.sku || sourceVariant?.sku || sourceProduct?.sku || "")
                .toString()
                .trim()
                .toUpperCase(),
        proCategoryId: categoryId || sourceProduct?.proCategoryId || null,
        proSubCategoryId: subCategoryId || sourceProduct?.proSubCategoryId || null,
        proBrandId: brandId || sourceProduct?.proBrandId || null,
        unitId: toObjectId(data.unitId),
        proVariantTypeId: toObjectId(data.proVariantTypeId),
        trackingType,
        vendorId,
        suppliers,
        primarySupplierId: resolvePrimarySupplier(suppliers),
        productSourceType: source.productSourceType,
        ownershipType: source.ownershipType,
        sourcePurchaseOrderId: source.sourcePurchaseOrderId,
        sourcePurchaseOrderItemId: source.sourcePurchaseOrderItemId,
        sourcePurchaseOrderNo:
            source.sourcePurchaseOrderNo || poSource?.po?.purchaseOrderNo || "",
        sourceSupplierId:
            source.sourceSupplierId ||
            poSource?.po?.supplierId?._id ||
            poSource?.po?.supplierId ||
            null,
        purchasePrice:
            Number(data.purchasePrice) ||
            Number(poSource?.line?.purchasePrice) ||
            Number(sourceVariant?.purchasePrice) ||
            Number(sourceProduct?.purchasePrice) ||
            0,
        costPrice:
            Number(data.costPrice) ||
            Number(sourceVariant?.costPrice) ||
            Number(sourceProduct?.costPrice) ||
            Number(poSource?.line?.purchasePrice) ||
            0,
        sellingPrice:
            Number(data.sellingPrice) ||
            Number(sourceVariant?.sellingPrice) ||
            Number(sourceProduct?.sellingPrice) ||
            0,
        wholesalePrice:
            Number(data.wholesalePrice) ||
            Number(sourceVariant?.wholesalePrice) ||
            Number(sourceProduct?.wholesalePrice) ||
            0,
        warrantyType:
            data.warrantyType ||
            sourceProduct?.warrantyType ||
            "No Warranty",
        warrantyPeriod:
            Number(data.warrantyPeriod) ||
            Number(sourceProduct?.warrantyPeriod) ||
            0,
        manufacturer:
            (data.manufacturer || sourceProduct?.manufacturer || "")
                .toString()
                .trim(),
        countryOfOrigin:
            (data.countryOfOrigin || sourceProduct?.countryOfOrigin || "Bangladesh")
                .toString()
                .trim(),
        hsnCode:
            (data.hsnCode || sourceProduct?.hsnCode || "").toString().trim(),
        ...uploader,
        uploadedAt: new Date(),
        approvalRequired: !isOwnerUpload,
        approvalStatus: isOwnerUpload ? "Approved" : "Pending",
        approvedBy: isOwnerUpload ? actorId || null : null,
        approvedByName: isOwnerUpload ? uploader.uploadedByName : "",
        approvedAt: isOwnerUpload ? new Date() : null,
        submittedForApprovalAt: isOwnerUpload ? null : new Date(),
        createdBy: actorId || uploader.uploadedById || null
    });

    pushApproval(
        product,
        isOwnerUpload ? "Approved" : "Submitted",
        {
            type: uploader.uploadedByType,
            id: uploader.uploadedById,
            name: uploader.uploadedByName
        },
        isOwnerUpload
            ? "Auto approved (uploaded by Owner)."
            : "Waiting for Owner approval."
    );

    product.recomputeProfit();
    product.recomputeLowStock();

    // Owner uploads are immediately usable by the user app catalog
    if (isOwnerUpload) {
        product.status = "Active";
        product.isPublished = true;
        product.publishedAt = new Date();
    }

    await product.save();

    try {
        await syncVariants(product, payload.productVariants, actorId);
        if (product.isModified()) await product.save();
        // Persist stock/profit summary from Inventory or Manual opening qty.
        await syncProductStockSummary(product);
    } catch (err) {
        // Product row was already persisted — soft-delete so the same name
        // can be retried instead of returning "already exists".
        try {
            product.isDeleted = true;
            product.deletedAt = new Date();
            product.deletedBy = toObjectId(actorId);
            product.status = "Archived";
            product.isPublished = false;
            await product.save();
            await ProductVariant.updateMany(
                { productId: product._id, isDeleted: { $ne: true } },
                {
                    $set: {
                        isDeleted: true,
                        deletedAt: new Date(),
                        deletedBy: toObjectId(actorId)
                    }
                }
            );
        } catch (_) {
            // best-effort cleanup
        }
        throw err;
    }

    if (
        source.productSourceType === "PurchaseOrder" &&
        source.sourcePurchaseOrderId &&
        source.sourcePurchaseOrderItemId
    ) {
        await PurchaseOrder.updateOne(
            {
                _id: source.sourcePurchaseOrderId,
                "items._id": source.sourcePurchaseOrderItemId
            },
            {
                $set: {
                    "items.$.productId": product._id,
                    "items.$.trackingType": product.trackingType,
                    "items.$.sku": product.sku || poSource?.line?.sku || ""
                }
            }
        );
    }

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// List / Get
// ==========================================================

const getProducts = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.trackingType) filter.trackingType = query.trackingType;
    if (query.uploadedByType) filter.uploadedByType = query.uploadedByType;
    if (query.isLowStock === "true" || query.isLowStock === true) {
        filter.isLowStock = true;
    }

    const categoryId = toObjectId(query.proCategoryId || query.categoryId);
    if (categoryId) filter.proCategoryId = categoryId;

    const subCategoryId = toObjectId(query.proSubCategoryId);
    if (subCategoryId) filter.proSubCategoryId = subCategoryId;

    const brandId = toObjectId(query.proBrandId || query.brandId);
    if (brandId) filter.proBrandId = brandId;

    const supplierId = toObjectId(query.supplierId);
    if (supplierId) filter["suppliers.supplierId"] = supplierId;

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { productCode: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { barcode: { $regex: search, $options: "i" } },
            { shortDescription: { $regex: search, $options: "i" } }
        ];
    }

    let sort;
    if (query.sort) {
        sort = trash.resolveEntitySort(query);
    } else {
        const sortBy = query.sortBy || "createdAt";
        const sortOrder = query.order === "asc" ? 1 : -1;
        sort = { [sortBy]: sortOrder };
    }

    const [items, total] = await Promise.all([
        populateProduct(
            Product.find(filter).sort(sort).skip(skip).limit(limit)
        ),
        Product.countDocuments(filter)
    ]);

    // Manual / ThirdParty: fill zero stock from variant opening qty + unit profit.
    await hydrateListStockFromVariants(items);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        },
        trash: trashMode
    };
};

const getProductById = async (id, { includeDeleted = false } = {}) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid product id.", 400);
    }

    const filter = { _id: id };
    if (!includeDeleted) Object.assign(filter, NOT_DELETED);

    const product = await populateProduct(Product.findOne(filter));

    if (!product) throw new AppError("Product not found.", 404);

    const variants = await ProductVariant.find({
        productId: id,
        isDeleted: { $ne: true }
    })
        .populate("attributes.variantTypeId", "type name")
        .populate("attributes.variantId", "name")
        .lean();

    const result = product.toObject();
    result.productVariants = await attachLiveStockToVariants(
        product._id,
        variants,
        product.trackingType
    );

    // Prefer live Inventory totals on details (even if summary is stale)
    const live = await getLiveProductStock(product._id);
    if (live) {
        result.totalStock = live.totalStock;
        result.availableStock = live.availableStock;
        result.reservedStock = live.reservedStock;
        result.stockValue = live.stockValue;
        result.warehouseStock = live.warehouseStock;
        result.totalImeiCount = live.totalImeiCount;
    }
    applyUnitProfit(result);

    return result;
};

/** Aggregate Inventory + IMEI counts onto each variant for product details */
const attachLiveStockToVariants = async (
    productId,
    variants = [],
    trackingType = "Non-IMEI"
) => {
    const pid = toObjectId(productId) || productId;
    const invRows = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$productVariantId",
                currentStock: { $sum: "$currentStock" },
                availableStock: { $sum: "$availableStock" },
                reservedStock: { $sum: "$reservedStock" }
            }
        }
    ]);

    const invByVariant = new Map(
        invRows.map((r) => [r._id ? String(r._id) : "null", r])
    );

    const imeiRows = await ItemTrack.aggregate([
        { $match: { productId: pid, status: "available" } },
        { $group: { _id: "$variantId", count: { $sum: 1 } } }
    ]);
    const imeiByVariant = new Map(
        imeiRows.map((r) => [r._id ? String(r._id) : "null", r.count || 0])
    );

    const isImei =
        String(trackingType || "")
            .toUpperCase()
            .includes("IMEI") &&
        !String(trackingType || "")
            .toUpperCase()
            .includes("NON");

    return variants.map((v) => {
        const key = v._id ? String(v._id) : "null";
        const inv = invByVariant.get(key) || {
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0
        };
        const imeiCount = imeiByVariant.get(key) || 0;
        const catalogQty = Number(v.quantity) || 0;
        const fromInv =
            Number(inv.availableStock) || Number(inv.currentStock) || 0;
        const liveQty = isImei
            ? imeiCount
            : fromInv > 0
              ? fromInv
              : catalogQty;

        return {
            ...v,
            // Keep catalog field, but expose live stock for UI
            stockCurrent: Number(inv.currentStock) || catalogQty || 0,
            stockAvailable: fromInv > 0 ? fromInv : catalogQty,
            stockReserved: Number(inv.reservedStock) || 0,
            imeiAvailableCount: imeiCount,
            // quantity = live warehouse stock, else Manual/ThirdParty catalog qty
            quantity: liveQty
        };
    });
};

const getLiveProductStock = async (productId) => {
    const pid = toObjectId(productId) || productId;
    const rows = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$warehouseId",
                quantity: { $sum: "$currentStock" },
                availableQuantity: { $sum: "$availableStock" },
                reservedQuantity: { $sum: "$reservedStock" },
                inventoryValue: {
                    $sum: {
                        $multiply: [
                            { $ifNull: ["$currentStock", 0] },
                            { $ifNull: ["$averageCost", 0] }
                        ]
                    }
                }
            }
        }
    ]);

    const totalImeiCount = await ItemTrack.countDocuments({
        productId: pid,
        status: "available"
    });

    const invTotal = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    const invAvailable = rows.reduce(
        (s, r) => s + (r.availableQuantity || 0),
        0
    );
    const invReserved = rows.reduce(
        (s, r) => s + (r.reservedQuantity || 0),
        0
    );
    const invValue = Number(
        rows.reduce((s, r) => s + (r.inventoryValue || 0), 0).toFixed(2)
    );

    if (invTotal > 0 || invAvailable > 0 || totalImeiCount > 0) {
        const product = await Product.findById(pid)
            .select("trackingType")
            .lean();
        const isImei =
            String(product?.trackingType || "")
                .toUpperCase()
                .includes("IMEI") &&
            !String(product?.trackingType || "")
                .toUpperCase()
                .includes("NON");
        return {
            totalStock: isImei ? totalImeiCount : invTotal,
            availableStock: isImei ? totalImeiCount : invAvailable,
            reservedStock: invReserved,
            stockValue: invValue,
            warehouseStock: rows.map((row) => ({
                warehouseId: row._id,
                quantity: row.quantity || 0,
                availableQuantity: row.availableQuantity || 0,
                reservedQuantity: row.reservedQuantity || 0,
                updatedAt: new Date()
            })),
            totalImeiCount,
            fromCatalog: false
        };
    }

    // Manual / ThirdParty (or any product with no Inventory yet):
    // fall back to ProductVariant.quantity opening stock.
    const product = await Product.findById(pid)
        .select(
            "trackingType costPrice purchasePrice averagePurchasePrice sellingPrice"
        )
        .lean();
    const variants = await ProductVariant.find({
        productId: pid,
        isDeleted: { $ne: true }
    })
        .select("quantity costPrice purchasePrice sellingPrice")
        .lean();

    const catalogQty = variants.reduce(
        (s, v) => s + (Math.max(Number(v.quantity) || 0, 0)),
        0
    );
    const unitCost =
        Number(product?.costPrice) ||
        Number(product?.purchasePrice) ||
        Number(product?.averagePurchasePrice) ||
        0;

    return {
        totalStock: catalogQty,
        availableStock: catalogQty,
        reservedStock: 0,
        stockValue: Number((catalogQty * unitCost).toFixed(2)),
        warehouseStock: [],
        totalImeiCount: 0,
        fromCatalog: true
    };
};

/**
 * Persist product stock summary from Inventory, or from variant opening qty
 * when Inventory is empty (Manual / ThirdParty).
 */
const syncProductStockSummary = async (productDoc) => {
    if (!productDoc?._id) return productDoc;
    const live = await getLiveProductStock(productDoc._id);

    productDoc.totalStock = Math.max(Number(live.totalStock) || 0, 0);
    productDoc.availableStock = Math.max(Number(live.availableStock) || 0, 0);
    productDoc.reservedStock = Math.max(Number(live.reservedStock) || 0, 0);
    productDoc.stockValue = Number(live.stockValue) || 0;
    productDoc.warehouseStock = live.warehouseStock || [];
    productDoc.totalImeiCount = Math.max(Number(live.totalImeiCount) || 0, 0);
    productDoc.lastStockUpdatedAt = new Date();
    if (typeof productDoc.recomputeLowStock === "function") {
        productDoc.recomputeLowStock();
    }
    if (typeof productDoc.recomputeProfit === "function") {
        productDoc.recomputeProfit();
    }
    await productDoc.save();
    return productDoc;
};

/** Align unit profit with current cost rules (cost > purchase + otherCost). */
const applyUnitProfit = (p) => {
    const selling = Number(p.sellingPrice) || 0;
    const unitCost =
        Number(p.costPrice) > 0
            ? Number(p.costPrice)
            : Number(p.purchasePrice) > 0
              ? Number(p.purchasePrice)
              : Number(p.lastPurchasePrice) || 0;
    const cost = unitCost + (Number(p.otherCost) || 0);
    p.grossProfit = Number((selling - cost).toFixed(2));
    p.profitMarginPercent =
        selling > 0
            ? Number((((selling - cost) / selling) * 100).toFixed(2))
            : 0;
};

/** List hydrate: fill zero stock from variant qty without rewriting every doc. */
const hydrateListStockFromVariants = async (items = []) => {
    const need = items.filter(
        (p) =>
            !(Number(p.availableStock) > 0) && !(Number(p.totalStock) > 0)
    );

    let qtyMap = new Map();
    if (need.length) {
        const ids = need.map((p) => p._id);
        const rows = await ProductVariant.aggregate([
            {
                $match: {
                    productId: { $in: ids },
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: "$productId",
                    qty: { $sum: { $ifNull: ["$quantity", 0] } }
                }
            }
        ]);
        qtyMap = new Map(
            rows.map((r) => [String(r._id), Number(r.qty) || 0])
        );
    }

    for (const p of items) {
        if (!(Number(p.availableStock) > 0) && !(Number(p.totalStock) > 0)) {
            const q = qtyMap.get(String(p._id)) || 0;
            if (q > 0) {
                p.availableStock = q;
                p.totalStock = q;
                const unitCost =
                    Number(p.costPrice) > 0
                        ? Number(p.costPrice)
                        : Number(p.purchasePrice) || 0;
                p.stockValue = Number((q * unitCost).toFixed(2));
            }
        }
        applyUnitProfit(p);
    }
    return items;
};

const getApprovedProducts = () => populateProduct(Product.getApprovedProducts());

const getPendingApprovals = () => populateProduct(Product.getPendingApprovals());

const getLowStockProducts = () => Product.getLowStockProducts();

const getProductByBarcode = async (barcode) => {
    const value = String(barcode || "").trim();
    if (!value) throw new AppError("Barcode is required.", 400);

    const product = await populateProduct(
        Product.findOne({ barcode: value, ...NOT_DELETED })
    );

    if (product) return product;

    const variant = await ProductVariant.findOne({
        barcode: value,
        isDeleted: { $ne: true }
    });

    if (!variant) throw new AppError("No product found for this barcode.", 404);

    return populateProduct(
        Product.findOne({ _id: variant.productId, ...NOT_DELETED })
    );
};

// ==========================================================
// Update
// ==========================================================

const updateProduct = async (id, payload = {}, actorId = null) => {
    const product = await findProductOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const name = data.name.toString().trim();
        const duplicate = await Product.findOne({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            ...NOT_DELETED
        });

        if (duplicate) {
            throw new AppError("Product with this name already exists.", 409);
        }

        data.name = name;
    }

    if (
        data.proCategoryId !== undefined ||
        data.proSubCategoryId !== undefined ||
        data.proBrandId !== undefined
    ) {
        const refs = await validateMasterRefs({
            proCategoryId: data.proCategoryId || product.proCategoryId,
            proSubCategoryId: data.proSubCategoryId || product.proSubCategoryId,
            proBrandId: data.proBrandId || product.proBrandId
        });

        data.proCategoryId = refs.categoryId;
        data.proSubCategoryId = refs.subCategoryId;
        data.proBrandId = refs.brandId;
    }

    if (data.unitId !== undefined) data.unitId = toObjectId(data.unitId);
    if (data.proVariantTypeId !== undefined) {
        data.proVariantTypeId = toObjectId(data.proVariantTypeId);
    }

    const suppliers = await normalizeSuppliers(data.suppliers);
    if (suppliers !== undefined) {
        data.suppliers = suppliers;
        data.primarySupplierId = resolvePrimarySupplier(suppliers);
    }

    // Tracking type can only change while the product has no stock or IMEI
    if (data.trackingType && data.trackingType !== product.trackingType) {
        const [imeiCount, hasStock] = await Promise.all([
            ItemTrack.countDocuments({ productId: product._id }),
            Promise.resolve((Number(product.totalStock) || 0) > 0)
        ]);

        if (imeiCount > 0 || hasStock) {
            throw new AppError(
                "Tracking type cannot change after stock or IMEI exists for this product.",
                400
            );
        }
    }

    Object.assign(product, data);

    // A Non IMEI product must always own exactly one barcode, generated once
    if (product.trackingType === "Non-IMEI" && !product.barcode) {
        product.barcode = await generateProductBarcode();
        product.barcodeType = "EAN13";
        product.barcodeGeneratedAt = new Date();
    }

    product.recomputeProfit();
    product.recomputeLowStock();
    product.updatedBy = actorId || product.updatedBy;

    await product.save();

    await syncVariants(product, payload.productVariants, actorId);
    if (product.isModified()) await product.save();
    await syncProductStockSummary(product);

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Approval workflow
// ==========================================================

const approveProduct = async (id, actor = {}, note = "") => {
    const product = await findProductOrFail(id);

    if (product.approvalStatus === "Approved") {
        throw new AppError("Product is already approved.", 400);
    }

    product.approvalStatus = "Approved";
    product.approvedBy = toObjectId(actor.id);
    product.approvedByName = actor.name || "Owner";
    product.approvedAt = new Date();
    product.rejectedBy = null;
    product.rejectedByName = "";
    product.rejectedAt = null;
    product.rejectionReason = "";

    if (product.status === "Draft") product.status = "Active";
    // Make approved products available to the user-app catalog (/products)
    product.isPublished = true;
    product.publishedAt = new Date();

    pushApproval(product, "Approved", { ...actor, type: actor.type || "Owner" }, note);
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const rejectProduct = async (id, reason = "", actor = {}) => {
    const product = await findProductOrFail(id);

    if (!String(reason).trim()) {
        throw new AppError("Rejection reason is required.", 400);
    }

    product.approvalStatus = "Rejected";
    product.rejectedBy = toObjectId(actor.id);
    product.rejectedByName = actor.name || "Owner";
    product.rejectedAt = new Date();
    product.rejectionReason = String(reason).trim();
    product.approvedBy = null;
    product.approvedByName = "";
    product.approvedAt = null;
    product.status = "Inactive";

    pushApproval(
        product,
        "Rejected",
        { ...actor, type: actor.type || "Owner" },
        product.rejectionReason
    );
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const resubmitProduct = async (id, actor = {}, note = "") => {
    const product = await findProductOrFail(id);

    if (product.approvalStatus === "Approved") {
        throw new AppError("Product is already approved.", 400);
    }

    product.approvalStatus = "Pending";
    product.approvalRequired = true;
    product.submittedForApprovalAt = new Date();
    product.rejectionReason = "";

    pushApproval(product, "Resubmitted", actor, note);
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Status / publish
// ==========================================================

const setStatus = async (id, status, actorId = null) => {
    const allowed = ["Draft", "Active", "Inactive", "Archived"];
    if (!allowed.includes(status)) {
        throw new AppError("Invalid product status.", 400);
    }

    const product = await findProductOrFail(id);

    if (status === "Active" && product.approvalStatus !== "Approved") {
        throw new AppError(
            "Product must be approved by the Owner before it can be activated.",
            400
        );
    }

    product.status = status;
    if (status !== "Active") product.isPublished = false;
    product.updatedBy = actorId || product.updatedBy;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const setPublish = async (id, publish, actorId = null) => {
    const product = await findProductOrFail(id);

    if (publish && product.approvalStatus !== "Approved") {
        throw new AppError(
            "Product must be approved by the Owner before publishing.",
            400
        );
    }

    if (publish) {
        product.isPublished = true;
        product.publishedAt = new Date();
        product.status = "Active";
    } else {
        product.isPublished = false;
    }

    product.updatedBy = actorId || product.updatedBy;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Suppliers
// ==========================================================

const assignSuppliers = async (id, suppliersInput, actorId = null) => {
    const product = await findProductOrFail(id);
    const suppliers = (await normalizeSuppliers(suppliersInput)) || [];

    product.suppliers = suppliers;
    product.primarySupplierId = resolvePrimarySupplier(suppliers);
    product.updatedBy = actorId || null;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Soft delete
// ==========================================================

const deleteProduct = async (id, actorId = null) => {
    const product = await trash.softDelete(id, actorId);

    await ProductVariant.updateMany(
        { productId: product._id, isDeleted: { $ne: true } },
        {
            $set: {
                isDeleted: true,
                deletedAt: product.deletedAt,
                deletedBy: product.deletedBy
            }
        }
    );

    return product;
};

const restoreProduct = async (id, actorId = null) => {
    const product = await trash.restore(id, actorId);

    await ProductVariant.updateMany(
        { productId: product._id, isDeleted: true },
        { $set: { isDeleted: false, deletedAt: null, deletedBy: null } }
    );

    return populateProduct(Product.findById(product._id));
};

const permanentDeleteProduct = (id) => trash.permanentDelete(id);
const bulkDeleteProducts = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreProducts = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteProducts = (payload) =>
    trash.bulkPermanentDelete(payload);

// ==========================================================
// Stock summary (written by Inventory Service only)
// ==========================================================

const refreshStockSummary = async (id) => {
    const product = await findProductOrFail(id);
    const productObjectId = product._id;

    // Keep ProductVariant.quantity in sync with live Inventory / IMEI stock
    // (only when Inventory rows exist — never wipe Manual opening qty).
    const isImei =
        String(product.trackingType || "")
            .toUpperCase()
            .includes("IMEI") &&
        !String(product.trackingType || "")
            .toUpperCase()
            .includes("NON");

    const byVariant = await Inventory.aggregate([
        {
            $match: {
                productId: productObjectId,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$productVariantId",
                qty: { $sum: "$currentStock" },
                avail: { $sum: "$availableStock" },
                lastPurchasePrice: { $max: "$lastPurchasePrice" },
                inventoryValue: {
                    $sum: {
                        $multiply: [
                            { $ifNull: ["$currentStock", 0] },
                            { $ifNull: ["$averageCost", 0] }
                        ]
                    }
                }
            }
        }
    ]);

    for (const row of byVariant) {
        if (!row._id) continue;
        let qty = Number(row.avail) || Number(row.qty) || 0;
        if (isImei) {
            qty = await ItemTrack.countDocuments({
                productId: productObjectId,
                variantId: row._id,
                status: "available"
            });
        }
        await ProductVariant.updateOne(
            { _id: row._id, isDeleted: { $ne: true } },
            { $set: { quantity: qty } }
        );
    }

    const invLast = byVariant.reduce(
        (max, r) => Math.max(max, Number(r.lastPurchasePrice) || 0),
        0
    );
    if (invLast > 0 && !(Number(product.purchasePrice) > 0)) {
        product.purchasePrice = invLast;
    }

    const inventoryValueSum = byVariant.reduce(
        (s, r) => s + (Number(r.inventoryValue) || 0),
        0
    );
    if (inventoryValueSum > 0) {
        const invQty = byVariant.reduce(
            (s, r) => s + (Number(r.qty) || 0),
            0
        );
        if (invQty > 0) {
            product.averagePurchasePrice = Number(
                (inventoryValueSum / invQty).toFixed(2)
            );
        }
    }

    // Inventory totals when present; else Manual/ThirdParty variant opening qty.
    await syncProductStockSummary(product);

    return populateProduct(Product.findById(product._id));
};

const getProductStats = async () => {
    const [[rows], trashCount] = await Promise.all([
        Product.aggregate([
        { $match: NOT_DELETED },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                active: {
                    $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] }
                },
                draft: {
                    $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] }
                },
                inactive: {
                    $sum: { $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0] }
                },
                archived: {
                    $sum: { $cond: [{ $eq: ["$status", "Archived"] }, 1, 0] }
                },
                pendingApproval: {
                    $sum: { $cond: [{ $eq: ["$approvalStatus", "Pending"] }, 1, 0] }
                },
                rejected: {
                    $sum: { $cond: [{ $eq: ["$approvalStatus", "Rejected"] }, 1, 0] }
                },
                imei: {
                    $sum: { $cond: [{ $eq: ["$trackingType", "IMEI"] }, 1, 0] }
                },
                nonImei: {
                    $sum: { $cond: [{ $eq: ["$trackingType", "Non-IMEI"] }, 1, 0] }
                },
                lowStock: { $sum: { $cond: ["$isLowStock", 1, 0] } },
                stockValue: { $sum: "$stockValue" }
            }
        }
        ]),
        trash.trashCount()
    ]);

    return {
        ...(rows || {
            total: 0,
            active: 0,
            draft: 0,
            inactive: 0,
            archived: 0,
            pendingApproval: 0,
            rejected: 0,
            imei: 0,
            nonImei: 0,
            lowStock: 0,
            stockValue: 0
        }),
        trashCount
    };
};

const getCompletedPurchaseOrderSourceLines = async (query = {}) => {
    const search = String(query.search || "").trim().toLowerCase();

    const pos = await PurchaseOrder.find({
        ...NOT_DELETED,
        status: { $in: ["Received", "Completed"] },
        purchaseType: "New"
    })
        .populate("supplierId", "supplierCode name phone email")
        .populate(
            "items.productId",
            "name productCode sku trackingType productType purchasePrice costPrice sellingPrice wholesalePrice warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId manufacturer countryOfOrigin hsnCode"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString purchasePrice costPrice sellingPrice wholesalePrice"
        )
        .sort({ createdAt: -1 })
        .lean();

    const usedSourceIds = new Set(
        (
            await Product.find({
                sourcePurchaseOrderItemId: { $ne: null },
                isDeleted: { $ne: true }
            }).select("sourcePurchaseOrderItemId")
        ).map((p) => String(p.sourcePurchaseOrderItemId))
    );

    const rows = [];
    for (const po of pos) {
        for (const item of po.items || []) {
            const itemId = String(item._id || "");
            const existingProduct = item.productId || null;
            const blockedByExistingProduct = !!existingProduct;
            const alreadyUsedAsSource = itemId && usedSourceIds.has(itemId);

            const line = {
                purchaseOrderId: po._id,
                purchaseOrderNo: po.purchaseOrderNo,
                purchaseOrderItemId: item._id,
                supplierId: po.supplierId?._id || po.supplierId || null,
                supplierName: po.supplierId?.name || "",
                supplierCode: po.supplierId?.supplierCode || "",
                productName: item.productName || existingProduct?.name || "",
                variantLabel: item.variantLabel || item.productVariantId?.combinationString || "",
                variantAttributes: Array.isArray(item.variantAttributes)
                    ? item.variantAttributes
                          .map((attr) => ({
                              variantTypeId: attr?.variantTypeId?._id || attr?.variantTypeId || null,
                              variantId: attr?.variantId?._id || attr?.variantId || null
                          }))
                          .filter((attr) => attr.variantTypeId && attr.variantId)
                    : [],
                sku: item.sku || item.productVariantId?.sku || existingProduct?.sku || "",
                trackingType: item.trackingType || existingProduct?.trackingType || "Non-IMEI",
                quantity: Number(item.quantity) || 0,
                purchasePrice: Number(item.purchasePrice) || 0,
                receivedQuantity: Number(item.receivedQuantity) || 0,
                productId: existingProduct?._id || null,
                productCode: existingProduct?.productCode || "",
                barcode: existingProduct?.barcode || "",
                categoryId: existingProduct?.proCategoryId || item.proCategoryId || null,
                subCategoryId:
                    existingProduct?.proSubCategoryId || item.proSubCategoryId || null,
                brandId: existingProduct?.proBrandId || item.proBrandId || null,
                manufacturer: existingProduct?.manufacturer || item.manufacturer || "",
                countryOfOrigin:
                    existingProduct?.countryOfOrigin || item.countryOfOrigin || "",
                hsnCode: existingProduct?.hsnCode || item.hsnCode || "",
                warrantyType:
                    existingProduct?.warrantyType || item.warrantyType || "No Warranty",
                warrantyPeriod:
                    Number(existingProduct?.warrantyPeriod) ||
                    Number(item.warrantyPeriod) ||
                    0,
                sellingPrice:
                    Number(item.sellingPrice) ||
                    Number(item.productVariantId?.sellingPrice) ||
                    Number(existingProduct?.sellingPrice) ||
                    0,
                wholesalePrice:
                    Number(item.wholesalePrice) ||
                    Number(item.productVariantId?.wholesalePrice) ||
                    Number(existingProduct?.wholesalePrice) ||
                    0,
                duplicateBlocked: blockedByExistingProduct || alreadyUsedAsSource,
                duplicateReason: blockedByExistingProduct
                    ? `Already linked to existing product ${existingProduct.name || existingProduct.productCode || ""}`.trim()
                    : alreadyUsedAsSource
                      ? "Already converted into a product"
                      : ""
            };

            if (search) {
                const hay =
                    `${line.purchaseOrderNo} ${line.productName} ${line.variantLabel} ${line.sku} ${line.supplierName} ${line.productCode}`.toLowerCase();
                if (!hay.includes(search)) continue;
            }

            rows.push(line);
        }
    }

    return rows;
};

module.exports = {
    createProduct,
    getProducts,
    getProductById,
    getProductDeleteCheck,
    prepareAndTrashProduct,
    getApprovedProducts,
    getPendingApprovals,
    getLowStockProducts,
    getProductByBarcode,
    updateProduct,
    approveProduct,
    rejectProduct,
    resubmitProduct,
    setStatus,
    setPublish,
    assignSuppliers,
    deleteProduct,
    restoreProduct,
    permanentDeleteProduct,
    bulkDeleteProducts,
    bulkRestoreProducts,
    bulkPermanentDeleteProducts,
    refreshStockSummary,
    getProductStats,
    getCompletedPurchaseOrderSourceLines
};
