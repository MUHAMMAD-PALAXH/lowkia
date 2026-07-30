/**
 * GRN Service
 * Locked decisions:
 * - Create only from Ordered / Partially Received PO (no manual GRN)
 * - Partial receive allowed (multiple GRNs per PO)
 * - IMEI: scan one-by-one + bulk paste
 * - Owner completes freely; Employee needs approval before stock increases
 * - Non-IMEI: received qty (barcode optional)
 * - Stock increases ONLY on GRN completion (Mongo transaction)
 */

const mongoose = require("mongoose");
const GRN = require("../model/grn");
const PurchaseOrder = require("../model/purchaseOrder");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Inventory = require("../model/inventory");
const ItemTrack = require("../model/itemTrack");
const StockMovement = require("../model/StockMovement");
const Warehouse = require("../model/warehouse");
const {
    generateGRNCode,
    generateStockMovementCode,
    generateProductCode,
    generateProductVariantCode
} = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");
const productService = require("./productService");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };
const RECEIVABLE_PO = ["Ordered", "Partially Received"];
const EDITABLE_GRN = ["Draft", "Pending Approval"];

const trash = createTrashOps(GRN, {
    label: "GRN",
    nameField: "grnNumber",
    statusField: "status",
    restoreStatus: "Draft",
    beforeSoftDelete: async (doc) => {
        if (doc.status !== "Draft" || doc.inventoryUpdated) {
            throw new AppError(
                "Only Draft GRNs can move to trash. Completed GRNs already updated inventory and cannot be trashed.",
                400
            );
        }
    },
    scopeStatusMap: {
        draft: "Draft",
        pendingapproval: "Pending Approval",
        completed: "Completed",
        cancelled: "Cancelled",
        received: "Received",
        verified: "Verified"
    }
});

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isOwnerActor = (payload = {}) => {
    const type = (payload.actorType || payload.uploadedByType || "")
        .toString()
        .trim();
    return type === "Owner" || payload.autoApprove === true;
};

const normalizeImei = (value) =>
    String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

const resolveFallbackWarehouseId = async () => {
    const warehouse = await Warehouse.findOne({
        isDeleted: { $ne: true },
        $or: [{ status: "Active" }, { status: { $exists: false } }, { status: "" }]
    })
        .sort({ createdAt: 1 })
        .select("_id");
    return warehouse?._id || null;
};

const resolveTrackingType = (raw) => {
    const tt = String(raw || "")
        .trim()
        .toUpperCase();
    if (tt.includes("IMEI") && !tt.includes("NON")) return "IMEI";
    return "Non-IMEI";
};

const populateGrn = (query) =>
    query
        .populate("purchaseOrderId", "purchaseOrderNo status purchaseType items")
        .populate("supplierId", "supplierCode name phone email")
        .populate("warehouseId", "warehouseCode warehouseName city")
        .populate("branchId", "branchCode name city")
        .populate("createdBy", "name email")
        .populate("approvedBy", "name email")
        .populate("items.productId", "name productCode trackingType barcode sku")
        .populate("items.productVariantId", "sku combinationString barcode");

/** After populate, normalize line trackingType and hydrate snapshot fields */
const enrichGrnDoc = (grn) => {
    if (!grn) return grn;
    const obj = typeof grn.toObject === "function" ? grn.toObject() : grn;
    for (const line of obj.items || []) {
        line.trackingType = resolveTrackingType(line.trackingType);
        const product = line.productId;
        if (product && typeof product === "object") {
            if (!line.barcode && product.barcode) line.barcode = product.barcode;
            if (!line.sku && product.sku) line.sku = product.sku;
            if (!line.productName && product.name) line.productName = product.name;
        }
        const variant = line.productVariantId;
        if (variant && typeof variant === "object") {
            if (!line.barcode && variant.barcode) line.barcode = variant.barcode;
            if (!line.sku && variant.sku) line.sku = variant.sku;
        }
    }
    return obj;
};

const findGrnOrFail = async (id, session = null) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid GRN id.", 400);
    }
    const q = GRN.findOne({ _id: id, ...NOT_DELETED });
    if (session) q.session(session);
    const grn = await q;
    if (!grn) throw new AppError("GRN not found.", 404);
    return grn;
};

const loadProductMeta = async (productId) => {
    if (!productId) return null;
    return Product.findOne({ _id: productId, ...NOT_DELETED })
        .select("name trackingType barcode sku productCode hasVariants")
        .lean();
};

/** Build draft GRN lines from pending PO quantities */
const buildLinesFromPo = async (po) => {
    const lines = [];
    for (const item of po.items || []) {
        const pending = Math.max(
            Number(item.quantity || 0) - Number(item.receivedQuantity || 0),
            0
        );
        if (pending <= 0) continue;

        const product = await loadProductMeta(item.productId);
        const trackingType = item.trackingType
            ? resolveTrackingType(item.trackingType)
            : resolveTrackingType(product?.trackingType);

        lines.push({
            purchaseOrderItemId: item._id,
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            trackingType,
            sku: item.sku || product?.sku || "",
            barcode: product?.barcode || item.barcode || "",
            productName: item.productName,
            variantLabel: item.variantLabel || "",
            // Cap for THIS GRN = remaining pending on PO (supports partial receive)
            orderedQuantity: pending,
            receivedQuantity: 0,
            damagedQuantity: 0,
            acceptedQuantity: 0,
            rejectedQuantity: 0,
            purchasePrice: Number(item.purchasePrice) || 0,
            total: 0,
            imeis: [],
            remarks: ""
        });
    }
    return lines;
};

const recalculateGrn = (grn) => {
    let subtotal = 0;
    let totalDamaged = 0;
    let totalAccepted = 0;

    for (const item of grn.items || []) {
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const accepted = Math.max(received - damaged, 0);
        item.acceptedQuantity = accepted;
        item.rejectedQuantity = damaged;
        item.total = accepted * (Number(item.purchasePrice) || 0);
        subtotal += item.total;
        totalDamaged += damaged;
        totalAccepted += accepted;
    }

    grn.subtotal = subtotal;
    grn.grandTotal = subtotal;
    grn.totalDamagedQuantity = totalDamaged;
    grn.totalAcceptedQuantity = totalAccepted;
};

const validateDraftLines = (grn) => {
    let anyReceive = false;
    for (const item of grn.items || []) {
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const ordered = Math.max(Number(item.orderedQuantity) || 0, 0);
        const alreadyHint = ordered; // remaining validated against PO on complete

        if (received > alreadyHint) {
            // soft: still allow if PO pending was lower — hard check on complete
        }
        if (damaged > received) {
            throw new AppError(
                `Damaged qty cannot exceed received for ${item.productName}.`,
                400
            );
        }
        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || [])
                .map(normalizeImei)
                .filter(Boolean);
            item.imeis = [...new Set(imeis)];
            if (received > 0 && item.imeis.length !== received) {
                throw new AppError(
                    `IMEI count must equal received qty for ${item.productName} (${item.imeis.length}/${received}).`,
                    400
                );
            }
        }
        if (received > 0) anyReceive = true;
    }
    if (!anyReceive) {
        throw new AppError("Enter received quantity for at least one line.", 400);
    }
};

const assertImeiUnique = async (imeis, session) => {
    if (!imeis.length) return;
    const existing = await ItemTrack.find({ imei: { $in: imeis } })
        .session(session)
        .select("imei")
        .lean();
    if (existing.length) {
        throw new AppError(
            `Duplicate IMEI: ${existing.map((e) => e.imei).join(", ")}`,
            400
        );
    }
};

const upsertInventory = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    qty,
    purchasePrice,
    grnId,
    session
}) => {
    if (!productId || qty <= 0) return null;

    const filter = {
        warehouseId,
        productId,
        productVariantId: productVariantId || null
    };

    let inv = await Inventory.findOne(filter).session(session);
    if (!inv) {
        inv = new Inventory({
            warehouseId,
            branchId: branchId || null,
            productId,
            productVariantId: productVariantId || null,
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0
        });
    } else if (branchId && !inv.branchId) {
        inv.branchId = branchId;
    }

    const previous = Number(inv.currentStock) || 0;
    inv.currentStock = previous + qty;
    inv.availableStock =
        Math.max(Number(inv.availableStock) || 0, 0) + qty;
    inv.lastPurchasePrice = purchasePrice;
    inv.lastStockInDate = new Date();
    inv.lastGRN = grnId;
    if (!inv.averageCost || previous <= 0) {
        inv.averageCost = purchasePrice;
    } else {
        inv.averageCost =
            (inv.averageCost * previous + purchasePrice * qty) /
            (previous + qty);
    }
    // Value after averageCost is updated
    inv.inventoryValue =
        (Number(inv.averageCost) || purchasePrice) * inv.currentStock;

    const avail = Number(inv.availableStock) || 0;
    const reorder = Number(inv.reorderLevel) || 0;
    if (avail <= 0) inv.stockStatus = "Out Of Stock";
    else if (reorder > 0 && avail <= reorder) inv.stockStatus = "Low Stock";
    else inv.stockStatus = "In Stock";

    await inv.save({ session });
    return { inv, previous, current: inv.currentStock };
};

const createStockMovement = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    sku,
    productName,
    qty,
    previousStock,
    currentStock,
    purchasePrice,
    grnId,
    actorId,
    session
}) => {
    if (!productId || qty <= 0) return null;
    const movementNumber = await generateStockMovementCode();
    const [doc] = await StockMovement.create(
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
                movementType: "Purchase",
                movementDirection: "IN",
                quantity: qty,
                previousStock,
                currentStock,
                unitCost: purchasePrice,
                totalCost: purchasePrice * qty,
                referenceType: "GRN",
                grnId,
                remarks: "Stock in from GRN",
                createdBy: actorId || null
            }
        ],
        { session }
    );
    return doc;
};

/**
 * New-product PO lines may arrive without productId.
 * On GRN complete, create (or reuse by name) a catalog product and link it.
 */
const ensureProductForGrnLine = async (
    line,
    actorId,
    purchaseOrderId,
    purchaseOrderNo,
    session
) => {
    if (line.productId) {
        // If IMEI and variant missing, create a default variant under existing product
        if (
            resolveTrackingType(line.trackingType) === "IMEI" &&
            !line.productVariantId
        ) {
            const variant = await createDefaultVariantForProduct(
                line.productId,
                line,
                session
            );
            line.productVariantId = variant._id;
            if (!line.sku && variant.sku) line.sku = variant.sku;
        }
        return line;
    }

    const name = String(line.productName || "").trim();
    if (!name) {
        throw new AppError(
            "Cannot complete GRN: a line has no product name and no productId.",
            400
        );
    }

    const trackingType = resolveTrackingType(line.trackingType);
    const purchasePrice = Math.max(Number(line.purchasePrice) || 0, 0);

    // Reuse existing catalog product with same name when possible
    let product = await Product.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        ...NOT_DELETED
    }).session(session);

    if (!product) {
        const productCode = await generateProductCode();
        let barcode = "";
        let barcodeType = "None";
        if (trackingType === "Non-IMEI") {
            barcode = await generateProductBarcode();
            barcodeType = "EAN13";
        }

        const [created] = await Product.create(
            [
                {
                    name,
                    productCode,
                    sku: (line.sku || "").toString().trim().toUpperCase(),
                    slug: name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, ""),
                    trackingType,
                    productType: trackingType === "IMEI" ? "Variant" : "Simple",
                    hasVariants: trackingType === "IMEI",
                    barcode,
                    barcodeType,
                    barcodeGeneratedAt: barcode ? new Date() : null,
                    purchasePrice,
                    sellingPrice: purchasePrice,
                    approvalStatus: "Approved",
                    approvalRequired: false,
                    approvedAt: new Date(),
                    approvedBy: toObjectId(actorId),
                    createdBy: toObjectId(actorId),
                    vendorId: toObjectId(actorId),
                    uploadedByType: "Owner",
                    uploadedById: toObjectId(actorId),
                    uploadedAt: new Date(),
                    productSourceType: "PurchaseOrder",
                    ownershipType: "Owned",
                    sourcePurchaseOrderId: purchaseOrderId || null,
                    sourcePurchaseOrderItemId: line.purchaseOrderItemId || null,
                    sourcePurchaseOrderNo: purchaseOrderNo || ""
                }
            ],
            { session }
        );
        product = created;
    }

    line.productId = product._id;
    if (!line.sku && product.sku) line.sku = product.sku;
    if (!line.barcode && product.barcode) line.barcode = product.barcode;
    line.trackingType = trackingType;

    if (trackingType === "IMEI" && !line.productVariantId) {
        const variant = await createDefaultVariantForProduct(
            product._id,
            line,
            session
        );
        line.productVariantId = variant._id;
        if (!line.sku && variant.sku) line.sku = variant.sku;
    }

    return line;
};

const createDefaultVariantForProduct = async (productId, line, session) => {
    // Prefer an existing default / only variant
    const existing = await ProductVariant.findOne({
        productId,
        isDeleted: { $ne: true }
    })
        .sort({ createdAt: 1 })
        .session(session);
    if (existing) return existing;

    const purchasePrice = Math.max(Number(line.purchasePrice) || 0, 0);
    const sku =
        (line.sku || "").toString().trim().toUpperCase() ||
        (await generateProductVariantCode());

    const [variant] = await ProductVariant.create(
        [
            {
                productId,
                attributes: [],
                combinationString: "Default",
                sku,
                purchasePrice,
                costPrice: purchasePrice,
                sellingPrice: purchasePrice,
                price: purchasePrice,
                quantity: 0
            }
        ],
        { session }
    );

    await Product.updateOne(
        { _id: productId },
        {
            $set: {
                hasVariants: true,
                productType: "Variant"
            }
        },
        { session }
    );

    return variant;
};

const applyInventoryForGrn = async (grn, actorId, session) => {
    const productIds = new Set();
    const allImeis = [];

    // Link / create products for New-product lines before stock update
    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;
        await ensureProductForGrnLine(
            item,
            actorId,
            grn.purchaseOrderId || null,
            grn.purchaseOrderNo || "",
            session
        );
    }

    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;

        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || []).map(normalizeImei).filter(Boolean);
            if (imeis.length !== accepted) {
                throw new AppError(
                    `IMEI count mismatch for ${item.productName}.`,
                    400
                );
            }
            allImeis.push(...imeis);
        }
    }

    await assertImeiUnique(allImeis, session);

    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;
        if (!item.productId) {
            throw new AppError(
                `Product link missing for ${item.productName}. Create or link a product on this line, then complete again.`,
                400
            );
        }

        const stockResult = await upsertInventory({
            warehouseId: grn.warehouseId,
            branchId: grn.branchId,
            productId: item.productId,
            productVariantId: item.productVariantId,
            qty: accepted,
            purchasePrice: Number(item.purchasePrice) || 0,
            grnId: grn._id,
            session
        });

        await createStockMovement({
            warehouseId: grn.warehouseId,
            branchId: grn.branchId,
            productId: item.productId,
            productVariantId: item.productVariantId,
            sku: item.sku,
            productName: item.productName,
            qty: accepted,
            previousStock: stockResult?.previous || 0,
            currentStock: stockResult?.current || accepted,
            purchasePrice: Number(item.purchasePrice) || 0,
            grnId: grn._id,
            actorId,
            session
        });

        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || []).map(normalizeImei).filter(Boolean);
            if (!item.productVariantId) {
                throw new AppError(
                    `Variant required for IMEI product ${item.productName}.`,
                    400
                );
            }
            const rows = imeis.map((imei) => ({
                imei,
                productId: item.productId,
                variantId: item.productVariantId,
                vendorId: actorId,
                currentBranchId: grn.branchId || null,
                status: "available",
                history: [
                    {
                        status: "available",
                        branchId: grn.branchId || null,
                        updatedBy: actorId,
                        date: new Date(),
                        notes: `GRN ${grn.grnNumber}`
                    }
                ]
            }));
            await ItemTrack.insertMany(rows, { session });
        }

        productIds.add(String(item.productId));
    }

    // Persist any newly linked productIds on the GRN document
    await grn.save({ session });

    // Also back-fill PO lines so future GRNs inherit the product link
    if (grn.purchaseOrderId) {
        const po = await PurchaseOrder.findOne({
            _id: grn.purchaseOrderId,
            ...NOT_DELETED
        }).session(session);
        if (po) {
            let poDirty = false;
            for (const gItem of grn.items || []) {
                if (!gItem.productId || !gItem.purchaseOrderItemId) continue;
                const poItem = (po.items || []).id(gItem.purchaseOrderItemId);
                if (!poItem) continue;
                if (!poItem.productId) {
                    poItem.productId = gItem.productId;
                    poDirty = true;
                }
                if (!poItem.productVariantId && gItem.productVariantId) {
                    poItem.productVariantId = gItem.productVariantId;
                    poDirty = true;
                }
                if (gItem.trackingType && !poItem.trackingType) {
                    poItem.trackingType = gItem.trackingType;
                    poDirty = true;
                }
            }
            if (poDirty) await po.save({ session });
        }
    }

    return [...productIds];
};

const applyPoReceiving = async (grn, session) => {
    const po = await PurchaseOrder.findOne({
        _id: grn.purchaseOrderId,
        ...NOT_DELETED
    }).session(session);
    if (!po) throw new AppError("Linked purchase order not found.", 404);

    for (const gItem of grn.items || []) {
        const accepted = Math.max(Number(gItem.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;

        let poItem = null;
        if (gItem.purchaseOrderItemId) {
            poItem = (po.items || []).find(
                (i) => String(i._id) === String(gItem.purchaseOrderItemId)
            );
        }
        if (!poItem) {
            poItem = (po.items || []).find(
                (i) =>
                    String(i.productId) === String(gItem.productId) &&
                    String(i.productVariantId || "") ===
                        String(gItem.productVariantId || "")
            );
        }
        if (!poItem) {
            throw new AppError(
                `PO line not found for ${gItem.productName}.`,
                400
            );
        }

        const pending =
            Number(poItem.quantity || 0) - Number(poItem.receivedQuantity || 0);
        if (accepted > pending + 1e-9) {
            throw new AppError(
                `Cannot receive ${accepted} of ${gItem.productName}; only ${pending} pending on PO.`,
                400
            );
        }

        poItem.receivedQuantity =
            Number(poItem.receivedQuantity || 0) + accepted;
        poItem.pendingQuantity = Math.max(
            Number(poItem.quantity || 0) - poItem.receivedQuantity,
            0
        );
    }

    if (!po.grnIds) po.grnIds = [];
    if (!po.grnIds.some((id) => String(id) === String(grn._id))) {
        po.grnIds.push(grn._id);
    }

    let totalQty = 0;
    let receivedQty = 0;
    let receivedAmount = 0;
    for (const item of po.items || []) {
        totalQty += Number(item.quantity) || 0;
        receivedQty += Number(item.receivedQuantity) || 0;
        receivedAmount +=
            (Number(item.receivedQuantity) || 0) *
            (Number(item.purchasePrice) || 0);
    }
    po.totalReceivedAmount = receivedAmount;

    if (receivedQty <= 0) {
        po.status = "Ordered";
        po.isFullyReceived = false;
        grn.purchaseStatus = "Pending";
    } else if (receivedQty < totalQty) {
        po.status = "Partially Received";
        po.isFullyReceived = false;
        grn.purchaseStatus = "Partially Received";
    } else {
        po.status = "Completed";
        po.isFullyReceived = true;
        grn.purchaseStatus = "Completed";
    }

    await po.save({ session });
    return po;
};

// ==========================================================
// Public API
// ==========================================================

const listReceivablePurchaseOrders = async (query = {}) => {
    const filter = {
        ...NOT_DELETED,
        status: { $in: RECEIVABLE_PO }
    };
    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { purchaseOrderNo: { $regex: search, $options: "i" } },
            { referenceNo: { $regex: search, $options: "i" } }
        ];
    }

    const items = await PurchaseOrder.find(filter)
        .sort({ orderDate: -1 })
        .limit(Math.min(parseInt(query.limit, 10) || 50, 100))
        .populate("supplierId", "supplierCode name")
        .populate("warehouseId", "warehouseCode warehouseName")
        .lean();

    const poIds = items.map((p) => p._id);
    const openGrns = await GRN.find({
        purchaseOrderId: { $in: poIds },
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        inventoryUpdated: { $ne: true }
    })
        .select("grnNumber purchaseOrderId status")
        .lean();
    const openByPo = new Map(
        openGrns.map((g) => [String(g.purchaseOrderId), g])
    );

    return {
        items: items.map((po) => {
            const open = openByPo.get(String(po._id));
            return {
                ...po,
                pendingLines: (po.items || []).filter(
                    (i) =>
                        Number(i.quantity || 0) -
                            Number(i.receivedQuantity || 0) >
                        0
                ).length,
                openGrnId: open?._id || null,
                openGrnNumber: open?.grnNumber || null,
                hasOpenGrn: Boolean(open)
            };
        })
    };
};

const createGrnFromPurchaseOrder = async (payload = {}, actorId = null) => {
    const poId = toObjectId(payload.purchaseOrderId || payload.poId);
    if (!poId) throw new AppError("purchaseOrderId is required.", 400);

    const createdBy = toObjectId(actorId) || toObjectId(payload.createdBy);
    if (!createdBy) {
        throw new AppError("Creator (createdBy / auth user) is required.", 400);
    }

    const po = await PurchaseOrder.findOne({ _id: poId, ...NOT_DELETED });
    if (!po) throw new AppError("Purchase order not found.", 404);
    if (!RECEIVABLE_PO.includes(po.status)) {
        throw new AppError(
            "GRN can only be created from Ordered or Partially Received purchase orders.",
            400
        );
    }

    // One open GRN per PO — reopen Draft / Pending instead of creating duplicates
    const existingOpen = await GRN.findOne({
        purchaseOrderId: poId,
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        inventoryUpdated: { $ne: true }
    }).sort({ createdAt: -1 });

    if (existingOpen) {
        // Normalize stale line flags on reused drafts
        let dirty = false;
        for (const line of existingOpen.items || []) {
            const tt = resolveTrackingType(line.trackingType);
            if (line.trackingType !== tt) {
                line.trackingType = tt;
                dirty = true;
            }
            if (!line.productId) continue;
            const product = await loadProductMeta(line.productId);
            if (!product) continue;
            if (!line.barcode && product.barcode) {
                line.barcode = product.barcode;
                dirty = true;
            }
        }
        if (dirty) await existingOpen.save();
        const reused = await populateGrn(GRN.findById(existingOpen._id));
        const plain = enrichGrnDoc(reused);
        plain.reusedExisting = true;
        return plain;
    }

    const warehouseId =
        toObjectId(payload.warehouseId) ||
        toObjectId(po.warehouseId) ||
        (await resolveFallbackWarehouseId());
    if (!warehouseId) {
        throw new AppError(
            "No active warehouse was available to assign this GRN.",
            400
        );
    }

    const lines = await buildLinesFromPo(po);
    if (!lines.length) {
        throw new AppError("This purchase order has nothing left to receive.", 400);
    }

    const owner = isOwnerActor(payload);
    const grn = new GRN({
        grnNumber: await generateGRNCode(),
        purchaseOrderId: po._id,
        supplierId: po.supplierId || null,
        warehouseId,
        branchId: toObjectId(payload.branchId) || po.branchId || null,
        referenceNumber: (payload.referenceNumber || "").toString().trim(),
        supplierInvoiceNo: (payload.supplierInvoiceNo || "").toString().trim(),
        receivedDate: payload.receivedDate
            ? new Date(payload.receivedDate)
            : new Date(),
        invoiceDate: payload.invoiceDate ? new Date(payload.invoiceDate) : null,
        items: lines,
        supplierNote: (payload.supplierNote || "").toString().trim(),
        internalNote: (payload.internalNote || "").toString().trim(),
        createdBy,
        status: "Draft",
        requiresApproval: !owner,
        qualityStatus: "Pending",
        purchaseStatus: "Pending"
    });

    recalculateGrn(grn);
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const getGrns = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.purchaseOrderId) {
        filter.purchaseOrderId = toObjectId(query.purchaseOrderId);
    }
    if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId);
    if (query.supplierId) filter.supplierId = toObjectId(query.supplierId);

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { grnNumber: { $regex: search, $options: "i" } },
            { supplierInvoiceNo: { $regex: search, $options: "i" } },
            { referenceNumber: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populateGrn(GRN.find(filter).sort(sort).skip(skip).limit(limit)),
        GRN.countDocuments(filter)
    ]);

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

const getGrnById = async (id) => {
    const grn = await populateGrn(
        GRN.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!grn) throw new AppError("GRN not found.", 404);
    return enrichGrnDoc(grn);
};

const getGrnStats = async () => {
    const [rows, trashCount] = await Promise.all([
        GRN.aggregate([
            { $match: { ...NOT_DELETED } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    amount: { $sum: "$grandTotal" }
                }
            }
        ]),
        trash.trashCount()
    ]);
    const stats = {
        total: 0,
        draft: 0,
        pendingApproval: 0,
        completed: 0,
        cancelled: 0,
        totalAmount: 0,
        trashCount
    };
    for (const row of rows) {
        stats.total += row.count;
        stats.totalAmount += row.amount || 0;
        if (row._id === "Draft") stats.draft = row.count;
        if (row._id === "Pending Approval") stats.pendingApproval = row.count;
        if (row._id === "Completed" || row._id === "Received" || row._id === "Verified") {
            stats.completed += row.count;
        }
        if (row._id === "Cancelled") stats.cancelled = row.count;
    }
    return stats;
};

const updateGrn = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status)) {
        throw new AppError("Only Draft / Pending Approval GRNs can be edited.", 400);
    }
    if (grn.inventoryUpdated) {
        throw new AppError("Inventory already updated — GRN is locked.", 400);
    }

    if (payload.referenceNumber !== undefined) {
        grn.referenceNumber = String(payload.referenceNumber).trim();
    }
    if (payload.supplierInvoiceNo !== undefined) {
        grn.supplierInvoiceNo = String(payload.supplierInvoiceNo).trim();
    }
    if (payload.supplierNote !== undefined) {
        grn.supplierNote = String(payload.supplierNote).trim();
    }
    if (payload.internalNote !== undefined) {
        grn.internalNote = String(payload.internalNote).trim();
    }
    if (payload.remarks !== undefined) {
        grn.internalNote = String(payload.remarks).trim();
    }
    if (payload.receivedDate) grn.receivedDate = new Date(payload.receivedDate);
    if (payload.invoiceDate !== undefined) {
        grn.invoiceDate = payload.invoiceDate
            ? new Date(payload.invoiceDate)
            : null;
    }
    if (payload.branchId !== undefined) {
        grn.branchId = toObjectId(payload.branchId);
    }

    if (Array.isArray(payload.items)) {
        for (const patch of payload.items) {
            const line = grn.items.id(patch._id || patch.id) ||
                grn.items.find(
                    (i) =>
                        String(i.purchaseOrderItemId) ===
                        String(patch.purchaseOrderItemId)
                );
            if (!line) continue;

            if (patch.receivedQuantity !== undefined) {
                line.receivedQuantity = Math.max(
                    Number(patch.receivedQuantity) || 0,
                    0
                );
            }
            if (patch.damagedQuantity !== undefined) {
                line.damagedQuantity = Math.max(
                    Number(patch.damagedQuantity) || 0,
                    0
                );
            }
            if (patch.remarks !== undefined) {
                line.remarks = String(patch.remarks).trim();
            }
            if (Array.isArray(patch.imeis)) {
                line.imeis = [
                    ...new Set(patch.imeis.map(normalizeImei).filter(Boolean))
                ];
                if (line.trackingType === "IMEI" && line.imeis.length) {
                    line.receivedQuantity = line.imeis.length;
                }
            }
            if (patch.barcode !== undefined) {
                line.barcode = String(patch.barcode).trim();
            }
        }
    }

    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const findGrnLine = (grn, payload = {}) => {
    const itemId = payload.itemId || payload.lineId || payload._id;
    const poItemId = payload.purchaseOrderItemId;
    const productId = payload.productId;
    const variantId = payload.productVariantId;

    // Prefer PO line id — most stable across create/reuse
    if (poItemId) {
        const byPo = (grn.items || []).find(
            (i) => String(i.purchaseOrderItemId) === String(poItemId)
        );
        if (byPo) return byPo;
    }

    if (itemId && mongoose.Types.ObjectId.isValid(String(itemId))) {
        try {
            const bySubId = grn.items.id(itemId);
            if (bySubId) return bySubId;
        } catch (_) {}
        const byId = (grn.items || []).find(
            (i) => String(i._id) === String(itemId)
        );
        if (byId) return byId;
    }

    if (productId) {
        return (grn.items || []).find((i) => {
            if (String(i.productId) !== String(productId)) return false;
            if (variantId) {
                return String(i.productVariantId || "") === String(variantId);
            }
            return true;
        });
    }
    return null;
};

/** Ensure line trackingType matches product before IMEI ops */
const ensureLineTracking = async (line) => {
    if (!line) return line;
    line.trackingType = resolveTrackingType(line.trackingType);
    if (!line?.productId) return line;
    const product = await loadProductMeta(line.productId);
    if (!product) return line;
    if (!line.barcode && product.barcode) line.barcode = product.barcode;
    return line;
};

/** Add one IMEI to a GRN line (scan) */
const scanImei = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot scan IMEI on this GRN.", 400);
    }

    const imei = normalizeImei(payload.imei);
    if (!imei || imei.length < 14 || imei.length > 17) {
        throw new AppError(
            "Invalid IMEI (must be 14–17 characters, usually 15 digits).",
            400
        );
    }

    const exists = await ItemTrack.findOne({ imei }).select("_id").lean();
    if (exists) throw new AppError(`Duplicate IMEI: ${imei}`, 400);

    const onThis = (grn.items || []).some((i) =>
        (i.imeis || []).map(normalizeImei).includes(imei)
    );
    if (onThis) {
        throw new AppError("IMEI already scanned on this GRN.", 400);
    }

    const onOther = await GRN.findOne({
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        "items.imeis": imei,
        _id: { $ne: grn._id }
    })
        .select("grnNumber")
        .lean();
    if (onOther) {
        throw new AppError(
            `IMEI already on draft GRN ${onOther.grnNumber}.`,
            400
        );
    }

    const line = findGrnLine(grn, payload);
    if (!line) {
        throw new AppError(
            "GRN line not found. Refresh the GRN and try again.",
            404
        );
    }
    await ensureLineTracking(line);
    if (line.trackingType !== "IMEI") {
        throw new AppError(
            "This product is Non-IMEI — enter received quantity instead.",
            400
        );
    }

    if ((line.imeis || []).length >= Number(line.orderedQuantity || 0)) {
        throw new AppError(
            `Cannot scan more than qty (${line.orderedQuantity}) for this line.`,
            400
        );
    }

    line.imeis = [...(line.imeis || []), imei];
    line.receivedQuantity = line.imeis.length;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

/** Bulk add IMEIs to a line */
const bulkAddImeis = async (id, payload = {}, actorId = null) => {
    const list = Array.isArray(payload.imeis)
        ? payload.imeis
        : String(payload.imeisText || "")
              .split(/[\n,;\s]+/)
              .filter(Boolean);
    const normalized = [
        ...new Set(
            list
                .map(normalizeImei)
                .filter((e) => e.length >= 14 && e.length <= 17)
        )
    ];
    if (!normalized.length) {
        throw new AppError(
            "No valid IMEIs provided (each must be 14–17 characters).",
            400
        );
    }

    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot add IMEIs on this GRN.", 400);
    }

    const line = findGrnLine(grn, payload);
    if (!line) {
        throw new AppError(
            "GRN line not found. Refresh the GRN and try again.",
            404
        );
    }
    await ensureLineTracking(line);
    if (line.trackingType !== "IMEI") {
        throw new AppError(
            "This product is Non-IMEI — enter received quantity instead.",
            400
        );
    }

    await assertImeiUnique(normalized, null);

    const alreadyOnGrn = new Set();
    for (const item of grn.items || []) {
        for (const e of item.imeis || []) {
            alreadyOnGrn.add(normalizeImei(e));
        }
    }
    const fresh = normalized.filter((e) => !alreadyOnGrn.has(e));
    if (!fresh.length) {
        throw new AppError("All provided IMEIs are already on this GRN.", 400);
    }

    const merged = [...new Set([...(line.imeis || []), ...fresh])];
    if (merged.length > Number(line.orderedQuantity || 0)) {
        throw new AppError(
            `Too many IMEIs (${merged.length}) for qty ${line.orderedQuantity}.`,
            400
        );
    }

    line.imeis = merged;
    line.receivedQuantity = merged.length;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const removeImei = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot remove IMEI on this GRN.", 400);
    }
    const imei = normalizeImei(payload.imei);
    const line = findGrnLine(grn, payload);
    if (!line) throw new AppError("GRN line not found.", 404);
    line.imeis = (line.imeis || []).filter((e) => normalizeImei(e) !== imei);
    line.receivedQuantity = line.imeis.length;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const submitGrn = async (id, actorId = null, opts = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Draft") {
        throw new AppError("Only Draft GRNs can be submitted.", 400);
    }
    recalculateGrn(grn);
    validateDraftLines(grn);

    if (!grn.requiresApproval || isOwnerActor(opts)) {
        // Owner path — complete immediately
        return completeGrn(id, actorId, { ...opts, actorType: "Owner" });
    }

    grn.status = "Pending Approval";
    grn.submittedAt = new Date();
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const approveGrn = async (id, actor = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Pending Approval") {
        throw new AppError("Only Pending Approval GRNs can be approved.", 400);
    }
    // Approval triggers stock update (Employee path)
    return completeGrn(id, actor.id || actor.actorId, {
        actorType: "Owner",
        approvedBy: actor.id || actor.actorId
    });
};

const rejectGrn = async (id, reason = "", actor = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Pending Approval") {
        throw new AppError("Only Pending Approval GRNs can be rejected.", 400);
    }
    grn.status = "Draft";
    grn.rejectionReason = String(reason || "").trim();
    grn.updatedBy = toObjectId(actor.id || actor.actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const completeGrn = async (id, actorId = null, opts = {}) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const grn = await findGrnOrFail(id, session);
        if (grn.inventoryUpdated || grn.status === "Completed") {
            throw new AppError("GRN already completed.", 400);
        }
        if (!["Draft", "Pending Approval"].includes(grn.status)) {
            throw new AppError("GRN cannot be completed from this status.", 400);
        }

        // Employee cannot complete Draft without approval
        if (
            grn.requiresApproval &&
            grn.status === "Draft" &&
            !isOwnerActor(opts)
        ) {
            throw new AppError(
                "Employee GRNs must be submitted and approved before stock update.",
                403
            );
        }

        const wasPending = grn.status === "Pending Approval";
        recalculateGrn(grn);
        validateDraftLines(grn);

        const productIds = await applyInventoryForGrn(
            grn,
            toObjectId(actorId),
            session
        );
        await applyPoReceiving(grn, session);

        grn.status = "Completed";
        grn.inventoryUpdated = true;
        grn.inventoryUpdatedAt = new Date();
        grn.inventoryUpdatedBy = toObjectId(actorId);
        grn.qualityStatus = "Passed";
        if (opts.approvedBy || wasPending) {
            grn.approvedBy = toObjectId(opts.approvedBy || actorId);
            grn.approvedAt = new Date();
        }
        grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
        await grn.save({ session });

        await session.commitTransaction();

        // Refresh product stock summaries outside txn (must not be silent forever)
        const refreshErrors = [];
        for (const pid of productIds) {
            try {
                await productService.refreshStockSummary(pid);
            } catch (err) {
                refreshErrors.push(
                    `${pid}: ${err?.message || err}`
                );
                console.error(
                    "[GRN] refreshStockSummary failed:",
                    pid,
                    err?.message || err
                );
            }
        }
        if (refreshErrors.length && productIds.length === refreshErrors.length) {
            // Inventory already committed — surface a clear follow-up error
            throw new AppError(
                `GRN completed and inventory updated, but product stock summary failed to refresh: ${refreshErrors.join("; ")}. Open product and use Refresh Stock, or retry refresh.`,
                500
            );
        }

        return populateGrn(GRN.findById(grn._id));
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const cancelGrn = async (id, actorId = null, reason = "") => {
    const grn = await findGrnOrFail(id);
    if (grn.inventoryUpdated || grn.status === "Completed") {
        throw new AppError("Completed GRNs cannot be cancelled.", 400);
    }
    if (grn.status === "Cancelled") {
        throw new AppError("GRN already cancelled.", 400);
    }
    grn.status = "Cancelled";
    grn.cancelledBy = toObjectId(actorId);
    grn.cancelledAt = new Date();
    if (reason) grn.rejectionReason = String(reason).trim();
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const deleteGrn = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreGrn = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteGrn = (id) => trash.permanentDelete(id);
const bulkDeleteGrns = (payload, actorId) => trash.bulkSoftDelete(payload, actorId);
const bulkRestoreGrns = (payload, actorId) => trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteGrns = (payload) => trash.bulkPermanentDelete(payload);

module.exports = {
    listReceivablePurchaseOrders,
    createGrnFromPurchaseOrder,
    getGrns,
    getGrnById,
    getGrnStats,
    updateGrn,
    scanImei,
    bulkAddImeis,
    removeImei,
    submitGrn,
    approveGrn,
    rejectGrn,
    completeGrn,
    cancelGrn,
    deleteGrn,
    restoreGrn,
    permanentDeleteGrn,
    bulkDeleteGrns,
    bulkRestoreGrns,
    bulkPermanentDeleteGrns,
    RECEIVABLE_PO
};
