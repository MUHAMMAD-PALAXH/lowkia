const mongoose = require("mongoose");
const PurchaseOrder = require("../model/purchaseOrder");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Supplier = require("../model/supplier");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const GRN = require("../model/grn");
const { generatePurchaseOrderCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };
const OPEN_GRN_STATUSES = ["Draft", "Pending Approval"];

const EDITABLE_STATUSES = ["Draft", "Pending Approval"];
const LOCKED_AFTER = ["Ordered", "Partially Received", "Received", "Completed"];
const NO_STOCK_IMPACT_STATUSES = ["Draft", "Cancelled"];
/** POs that already moved stock / partial receive — keep as history */
const TRASH_LOCKED_STATUSES = [
    "Partially Received",
    "Received",
    "Completed"
];
/** Statuses that can cancel + trash (after supplier notify when needed) */
const CANCEL_AND_TRASH_STATUSES = [
    "Pending Approval",
    "Approved",
    "Awaiting Supplier",
    "Supplier Accepted",
    "Supplier Rejected",
    "Ordered",
    "Partially Delivered",
    "Completely Delivered"
];

const applyBuyerWithdrawalNotice = (po, { reason = "", forTrash = true } = {}) => {
    const no = po.purchaseOrderNo || "this purchase order";
    const hadSupplier = Boolean(po.supplierId);
    const supplierWasInLoop =
        hadSupplier &&
        (["Pending", "Accepted", "Rejected", "Withdrawn"].includes(
            po.supplierAcceptanceStatus
        ) ||
            [
                "Awaiting Supplier",
                "Supplier Accepted",
                "Supplier Rejected",
                "Partially Delivered",
                "Completely Delivered",
                "Ordered"
            ].includes(po.status));

    po.status = "Cancelled";
    if (reason) po.rejectionReason = String(reason).trim();

    if (supplierWasInLoop) {
        po.supplierAcceptanceStatus = "Withdrawn";
        po.supplierNotifiedAt = new Date();
        po.supplierMessage = forTrash
            ? `Purchase order ${no} was cancelled by the buyer and moved to trash. It is no longer active.`
            : `Purchase order ${no} was cancelled by the buyer. It is no longer active.`;
        po.supplierRespondedAt = new Date();
        po.supplierResponseNote =
            String(reason || "").trim() || "Cancelled by buyer.";
    }
};

const applyRestoreSupplierNotice = (po) => {
    const no = po.purchaseOrderNo || "this purchase order";
    const hadSupplierCycle =
        Boolean(po.supplierId) &&
        po.supplierAcceptanceStatus !== "Not Required";

    if (hadSupplierCycle) {
        // Stay cancelled — supplier sees it again with a restore notice
        po.status = "Cancelled";
        po.supplierAcceptanceStatus = "Withdrawn";
        po.supplierNotifiedAt = new Date();
        po.supplierMessage =
            `Purchase order ${no} was restored from trash. ` +
            `It remains cancelled. Contact the buyer if you need a new order.`;
    } else {
        po.status = "Draft";
        po.supplierAcceptanceStatus = "Not Required";
        po.supplierMessage = "";
        po.supplierNotifiedAt = null;
        po.supplierRespondedAt = null;
        po.supplierResponseNote = "";
    }
};

const trash = createTrashOps(PurchaseOrder, {
    label: "Purchase Order",
    nameField: "purchaseOrderNo",
    statusField: "status",
    // Default Draft; restoreExtra overrides when supplier cycle existed
    restoreStatus: "Draft",
    beforeSoftDelete: async (doc) => {
        if (!NO_STOCK_IMPACT_STATUSES.includes(doc.status)) {
            throw new AppError(
                `Only Draft or Cancelled purchase orders can move to trash directly. This PO is "${doc.status}". Use Cancel & trash to withdraw from the supplier and archive it.`,
                400
            );
        }
    },
    softDeleteExtra: (doc) => {
        if (doc.status !== "Cancelled") doc.status = "Cancelled";
    },
    restoreExtra: (doc) => {
        applyRestoreSupplierNotice(doc);
    },
    beforePermanent: async (doc) => {
        const stocked = await GRN.findOne({
            purchaseOrderId: doc._id,
            inventoryUpdated: true
        }).select("_id grnNumber");
        if (stocked) {
            throw new AppError(
                `Cannot permanently delete — GRN ${stocked.grnNumber || ""} already updated inventory. Keep this PO in trash as history.`,
                400
            );
        }
        // Remove non-stocked GRNs tied to this PO (drafts / cancelled)
        await GRN.deleteMany({
            purchaseOrderId: doc._id,
            inventoryUpdated: { $ne: true }
        });
    },
    scopeStatusMap: {
        draft: "Draft",
        pendingapproval: "Pending Approval",
        approved: "Approved",
        awaitingsupplier: "Awaiting Supplier",
        supplieraccepted: "Supplier Accepted",
        supplierrejected: "Supplier Rejected",
        ordered: "Ordered",
        partiallydelivered: "Partially Delivered",
        completelydelivered: "Completely Delivered",
        partiallyreceived: "Partially Received",
        received: "Received",
        completed: "Completed",
        cancelled: "Cancelled"
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

const populatePo = (query) =>
    query
        .populate("branchId", "name code city branchCode")
        .populate(
            "supplierId",
            "supplierCode name companyName phone email status paymentTerms creditLimit creditDays currentBalance totalPurchaseAmount totalPaidAmount totalDueAmount openingBalance lastPurchaseDate lastPaymentDate"
        )
        .populate("warehouseId", "warehouseCode warehouseName city status")
        .populate("items.productId", "name productCode trackingType productType totalStock availableStock purchasePrice")
        .populate("items.productVariantId", "sku combinationString sellingPrice purchasePrice attributes")
        .populate("approvedBy", "name email")
        .populate("createdBy", "name email")
        .populate("rejectedBy", "name email")
        .populate("cancelledBy", "name email");

const toPlainPo = (po) => {
    if (!po) return po;
    if (typeof po.toObject === "function") return po.toObject({ virtuals: true });
    return po;
};

/** Attach hasOpenGrn / openGrnNumber / hasGrnCreated for admin UI. */
const enrichPosWithGrnMeta = async (poOrList) => {
    const asList = Array.isArray(poOrList);
    const list = (asList ? poOrList : [poOrList]).filter(Boolean).map(toPlainPo);
    if (!list.length) return poOrList;

    const ids = list.map((p) => p._id).filter(Boolean);
    const [openGrns, anyGrns] = await Promise.all([
        GRN.find({
            purchaseOrderId: { $in: ids },
            ...NOT_DELETED,
            status: { $in: OPEN_GRN_STATUSES },
            inventoryUpdated: { $ne: true }
        })
            .select("grnNumber purchaseOrderId")
            .sort({ createdAt: -1 })
            .lean(),
        GRN.find({
            purchaseOrderId: { $in: ids },
            ...NOT_DELETED
        })
            .select("grnNumber purchaseOrderId")
            .lean()
    ]);

    const openByPo = new Map();
    for (const g of openGrns) {
        const key = String(g.purchaseOrderId);
        if (!openByPo.has(key)) openByPo.set(key, g);
    }
    const anyByPo = new Map();
    for (const g of anyGrns) {
        const key = String(g.purchaseOrderId);
        if (!anyByPo.has(key)) anyByPo.set(key, g);
    }

    const enriched = list.map((po) => {
        const key = String(po._id);
        const open = openByPo.get(key);
        const any = anyByPo.get(key);
        const fromIds = Array.isArray(po.grnIds) && po.grnIds.length > 0;
        const hasGrnCreated = Boolean(open) || Boolean(any) || fromIds;
        return {
            ...po,
            openGrnId: open?._id || null,
            openGrnNumber: open?.grnNumber || any?.grnNumber || "",
            hasOpenGrn: Boolean(open),
            hasGrnCreated
        };
    });

    return asList ? enriched : enriched[0];
};

const chargeType = (value) =>
    String(value || "Fixed").toLowerCase() === "percentage"
        ? "Percentage"
        : "Fixed";

const resolveTrackingType = (value) =>
    String(value || "").toUpperCase().includes("IMEI") &&
    !String(value || "").toUpperCase().includes("NON")
        ? "IMEI"
        : "Non-IMEI";

const normalizeVariantAttributes = (attributes = []) =>
    (Array.isArray(attributes) ? attributes : [])
        .map((a) => ({
            variantTypeId: toObjectId(a?.variantTypeId),
            variantId: toObjectId(a?.variantId)
        }))
        .filter((a) => a.variantTypeId && a.variantId);

const resolveCharge = (value, type, base) => {
    const v = Math.max(Number(value) || 0, 0);
    if (type === "Percentage") {
        return Math.max((Math.max(Number(base) || 0, 0) * v) / 100, 0);
    }
    return v;
};

const calculateLines = (items = [], header = {}) => {
    let subtotal = 0;
    const normalized = items.map((raw) => {
        const quantity = Math.max(Number(raw.quantity) || 0, 0);
        const purchasePrice = Math.max(Number(raw.purchasePrice) || 0, 0);
        const discount = Math.max(Number(raw.discount) || 0, 0);
        const tax = Math.max(Number(raw.tax) || 0, 0);
        const receivedQuantity = Math.max(Number(raw.receivedQuantity) || 0, 0);
        const total = quantity * purchasePrice - discount + tax;
        subtotal += total;
        return {
            ...raw,
            quantity,
            purchasePrice,
            discount,
            tax,
            total,
            receivedQuantity,
            pendingQuantity: Math.max(quantity - receivedQuantity, 0)
        };
    });

    const discountType = chargeType(header.discountType);
    const taxType = chargeType(header.taxType);
    const shippingType = chargeType(header.shippingType);

    const discountValue = Math.max(Number(header.discount) || 0, 0);
    const taxValue = Math.max(Number(header.tax) || 0, 0);
    const shippingValue = Math.max(Number(header.shippingCost) || 0, 0);
    const otherCharges = Math.max(Number(header.otherCharges) || 0, 0);
    const paidAmount = Math.max(Number(header.paidAmount) || 0, 0);

    const appliedDiscount = resolveCharge(discountValue, discountType, subtotal);
    const taxBase = Math.max(subtotal - appliedDiscount, 0);
    const appliedTax = resolveCharge(taxValue, taxType, taxBase);
    const appliedShipping = resolveCharge(
        shippingValue,
        shippingType,
        subtotal
    );

    const grandTotal =
        subtotal - appliedDiscount + appliedTax + appliedShipping + otherCharges;
    const dueAmount = Math.max(grandTotal - paidAmount, 0);

    let paymentStatus = "Pending";
    if (paidAmount <= 0) paymentStatus = "Pending";
    else if (paidAmount < grandTotal) paymentStatus = "Partial";
    else paymentStatus = "Paid";

    return {
        items: normalized,
        subtotal,
        discount: discountValue,
        discountType,
        tax: taxValue,
        taxType,
        shippingCost: shippingValue,
        shippingType,
        appliedDiscount,
        appliedTax,
        appliedShipping,
        otherCharges,
        paidAmount,
        grandTotal,
        dueAmount,
        paymentStatus
    };
};

const resolveDefaultPurchasePrice = async ({
    product,
    variant,
    supplierId
}) => {
    if (variant && Number(variant.purchasePrice) > 0) {
        return Number(variant.purchasePrice);
    }
    if (product && Number(product.purchasePrice) > 0) {
        return Number(product.purchasePrice);
    }
    if (product && Array.isArray(product.suppliers) && supplierId) {
        const link = product.suppliers.find(
            (s) => String(s.supplierId) === String(supplierId)
        );
        if (link && Number(link.lastPurchasePrice) > 0) {
            return Number(link.lastPurchasePrice);
        }
    }
    return 0;
};

const normalizeItems = async (itemsInput = [], purchaseType, supplierId) => {
    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
        throw new AppError("At least one purchase line is required.", 400);
    }

    const items = [];

    for (const raw of itemsInput) {
        const productId = toObjectId(raw.productId);
        const productVariantId = toObjectId(raw.productVariantId);
        let product = null;
        let variant = null;

        if (purchaseType === "Existing") {
            if (!productId) {
                throw new AppError(
                    "Existing Product PO requires a product on every line.",
                    400
                );
            }
            product = await Product.findOne({ _id: productId, ...NOT_DELETED });
            if (!product) {
                throw new AppError("One or more products were not found.", 404);
            }

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
            }
        } else {
            // New Product Purchase — catalog product optional
            if (productId) {
                product = await Product.findOne({
                    _id: productId,
                    ...NOT_DELETED
                });
            }
            if (productVariantId) {
                variant = await ProductVariant.findOne({
                    _id: productVariantId,
                    isDeleted: { $ne: true }
                });
            }
        }

        const productName =
            (raw.productName || "").toString().trim() ||
            (variant && (variant.combinationString || variant.sku)) ||
            product?.name ||
            "";
        const variantLabel =
            (raw.variantLabel || "").toString().trim() ||
            (variant?.combinationString || "").toString().trim();
        const variantAttributes = normalizeVariantAttributes(raw.variantAttributes);

        if (!productName) {
            throw new AppError("Each line needs a product name.", 400);
        }

        const quantity = Number(raw.quantity);
        if (!quantity || quantity < 1) {
            throw new AppError(
                `Invalid quantity for "${productName}".`,
                400
            );
        }

        let purchasePrice = Number(raw.purchasePrice);
        if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
            purchasePrice = await resolveDefaultPurchasePrice({
                product,
                variant,
                supplierId
            });
        }

        const sku =
            (raw.sku || "").toString().trim().toUpperCase() ||
            variant?.sku ||
            product?.sku ||
            "";

        const trackingType = raw.trackingType
            ? resolveTrackingType(raw.trackingType)
            : resolveTrackingType(product?.trackingType);

        const warrantyType = [
            "No Warranty",
            "Days",
            "Months",
            "Years",
            "Lifetime"
        ].includes(raw.warrantyType)
            ? raw.warrantyType
            : product?.warrantyType || "No Warranty";

        items.push({
            _id: toObjectId(raw._id || raw.id) || undefined,
            productId: product?._id || null,
            productVariantId: variant?._id || null,
            trackingType,
            sku,
            productName:
                product && variant
                    ? `${product.name} (${variant.combinationString || variant.sku || "Variant"})`
                    : productName,
            variantLabel,
            variantAttributes,
            quantity,
            purchasePrice,
            discount: Number(raw.discount) || 0,
            tax: Number(raw.tax) || 0,
            receivedQuantity: Number(raw.receivedQuantity) || 0,
            remarks: (raw.remarks || "").toString().trim(),
            currentStock:
                Number(raw.currentStock) ||
                Number(product?.availableStock) ||
                Number(product?.totalStock) ||
                0,
            proCategoryId: toObjectId(raw.proCategoryId) || product?.proCategoryId || null,
            proSubCategoryId:
                toObjectId(raw.proSubCategoryId) || product?.proSubCategoryId || null,
            proBrandId: toObjectId(raw.proBrandId) || product?.proBrandId || null,
            manufacturer:
                (raw.manufacturer || product?.manufacturer || "").toString().trim(),
            countryOfOrigin:
                (raw.countryOfOrigin || product?.countryOfOrigin || "Bangladesh")
                    .toString()
                    .trim(),
            hsnCode: (raw.hsnCode || product?.hsnCode || "").toString().trim(),
            warrantyType,
            warrantyPeriod:
                Number(raw.warrantyPeriod) ||
                Number(product?.warrantyPeriod) ||
                0,
            sellingPrice:
                Number(raw.sellingPrice) ||
                Number(variant?.sellingPrice) ||
                Number(product?.sellingPrice) ||
                0,
            wholesalePrice:
                Number(raw.wholesalePrice) ||
                Number(variant?.wholesalePrice) ||
                Number(product?.wholesalePrice) ||
                0
        });
    }

    return items;
};

const assertRefs = async ({ supplierId, warehouseId, branchId }) => {
    let supplier = null;
    let warehouse = null;

    if (supplierId) {
        supplier = await Supplier.findOne({
            _id: supplierId,
            ...NOT_DELETED
        });
        if (!supplier) throw new AppError("Supplier not found.", 404);
    }

    if (warehouseId) {
        warehouse = await Warehouse.findOne({
            _id: warehouseId,
            ...NOT_DELETED
        });
        if (!warehouse) throw new AppError("Warehouse not found.", 404);
    }

    if (branchId) {
        const branch = await Branch.findOne({ _id: branchId, ...NOT_DELETED });
        if (!branch) throw new AppError("Branch not found.", 404);
    }

    return { supplier, warehouse };
};

const findPoOrFail = trash.findActiveOrFail;

const createPurchaseOrder = async (payload = {}, actorId = null) => {
    const purchaseType =
        payload.purchaseType === "New" ? "New" : "Existing";
    const supplierId = toObjectId(payload.supplierId);
    const warehouseId = toObjectId(payload.warehouseId);
    const branchId = toObjectId(payload.branchId);
    const createdBy = toObjectId(actorId) || toObjectId(payload.createdBy);

    if (!createdBy) {
        throw new AppError("Creator (createdBy / auth user) is required.", 400);
    }

    await assertRefs({ supplierId, warehouseId, branchId });

    const items = await normalizeItems(
        payload.items || payload.products,
        purchaseType,
        supplierId
    );
    const totals = calculateLines(items, payload);

    const uploadedByType = (payload.actorType || payload.uploadedByType || "")
        .toString()
        .trim();
    const isOwner =
        uploadedByType === "Owner" || payload.autoApprove === true;

    const po = new PurchaseOrder({
        purchaseOrderNo: await generatePurchaseOrderCode(),
        purchaseType,
        branchId,
        supplierId,
        warehouseId,
        referenceNo: (payload.referenceNo || "").toString().trim(),
        orderDate: payload.orderDate ? new Date(payload.orderDate) : new Date(),
        expectedDeliveryDate: payload.expectedDeliveryDate
            ? new Date(payload.expectedDeliveryDate)
            : null,
        items: totals.items,
        subtotal: totals.subtotal,
        discount: totals.discount,
        discountType: totals.discountType,
        tax: totals.tax,
        taxType: totals.taxType,
        shippingCost: totals.shippingCost,
        shippingType: totals.shippingType,
        otherCharges: totals.otherCharges,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paidAmount,
        dueAmount: totals.dueAmount,
        paymentStatus: totals.paymentStatus,
        paymentTerms: payload.paymentTerms || "Cash",
        paymentDueDate: payload.paymentDueDate
            ? new Date(payload.paymentDueDate)
            : null,
        supplierNote: (payload.supplierNote || "").toString().trim(),
        internalNote: (payload.internalNote || "").toString().trim(),
        createdBy,
        status: "Draft",
        requiresApproval: !isOwner
    });

    // Owner POs auto-approve then can be marked Ordered in one step later
    if (isOwner) {
        po.status = "Approved";
        po.requiresApproval = false;
        po.approvedBy = createdBy;
        po.approvedAt = new Date();
    }

    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const getPurchaseOrders = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.status) {
        if (query.status === "Completed") {
            filter.status = { $in: ["Completed", "Received"] };
        } else {
            filter.status = query.status;
        }
    }
    if (query.purchaseType) filter.purchaseType = query.purchaseType;

    const supplierId = toObjectId(query.supplierId || query.supplier);
    if (supplierId) filter.supplierId = supplierId;

    const warehouseId = toObjectId(query.warehouseId || query.warehouse);
    if (warehouseId) filter.warehouseId = warehouseId;

    const branchId = toObjectId(query.branchId || query.branch);
    if (branchId) filter.branchId = branchId;

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { purchaseOrderNo: { $regex: search, $options: "i" } },
            { referenceNo: { $regex: search, $options: "i" } },
            { "items.productName": { $regex: search, $options: "i" } },
            { "items.sku": { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populatePo(
            PurchaseOrder.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
        ),
        PurchaseOrder.countDocuments(filter)
    ]);

    return {
        items: await enrichPosWithGrnMeta(items),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        },
        trash: trashMode
    };
};

const getPurchaseOrderById = async (id, { includeDeleted = false } = {}) => {
    const filter = { _id: id };
    if (!includeDeleted) Object.assign(filter, NOT_DELETED);
    const po = await populatePo(PurchaseOrder.findOne(filter));
    if (!po) throw new AppError("Purchase order not found.", 404);
    return enrichPosWithGrnMeta(po);
};

const getPurchaseOrderStats = async () => {
    const [rows, trashCount] = await Promise.all([
        PurchaseOrder.aggregate([
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
        approved: 0,
        ordered: 0,
        awaitingSupplier: 0,
        supplierAccepted: 0,
        supplierRejected: 0,
        partiallyDelivered: 0,
        completelyDelivered: 0,
        partiallyReceived: 0,
        completed: 0,
        cancelled: 0,
        totalAmount: 0,
        trashCount
    };

    rows.forEach((row) => {
        stats.total += row.count;
        stats.totalAmount += row.amount || 0;
        switch (row._id) {
            case "Draft":
                stats.draft = row.count;
                break;
            case "Pending Approval":
                stats.pendingApproval = row.count;
                break;
            case "Approved":
                stats.approved = row.count;
                break;
            case "Ordered":
                stats.ordered = row.count;
                break;
            case "Awaiting Supplier":
                stats.awaitingSupplier = row.count;
                break;
            case "Supplier Accepted":
                stats.supplierAccepted = row.count;
                break;
            case "Supplier Rejected":
                stats.supplierRejected = row.count;
                break;
            case "Partially Delivered":
                stats.partiallyDelivered = row.count;
                break;
            case "Completely Delivered":
                stats.completelyDelivered = row.count;
                break;
            case "Partially Received":
                stats.partiallyReceived = row.count;
                break;
            case "Received":
            case "Completed":
                stats.completed += row.count;
                break;
            case "Cancelled":
                stats.cancelled = row.count;
                break;
            default:
                break;
        }
    });

    return stats;
};

const updatePurchaseOrder = async (id, payload = {}, actorId = null) => {
    const po = await findPoOrFail(id);

    if (!EDITABLE_STATUSES.includes(po.status)) {
        throw new AppError(
            "Only Draft or Pending Approval purchase orders can be edited. Ordered+ lines are locked.",
            400
        );
    }

    const purchaseType =
        payload.purchaseType === "New"
            ? "New"
            : payload.purchaseType === "Existing"
              ? "Existing"
              : po.purchaseType;

    const supplierId =
        payload.supplierId === null || payload.supplierId === ""
            ? null
            : toObjectId(payload.supplierId) || po.supplierId;
    const warehouseId =
        payload.warehouseId === null || payload.warehouseId === ""
            ? null
            : toObjectId(payload.warehouseId) || po.warehouseId;
    const branchId =
        payload.branchId === null || payload.branchId === ""
            ? null
            : toObjectId(payload.branchId) || po.branchId;

    await assertRefs({ supplierId, warehouseId, branchId });

    const chargeHeader = {
        discount: payload.discount ?? po.discount,
        discountType: payload.discountType ?? po.discountType,
        tax: payload.tax ?? po.tax,
        taxType: payload.taxType ?? po.taxType,
        shippingCost: payload.shippingCost ?? po.shippingCost,
        shippingType: payload.shippingType ?? po.shippingType,
        otherCharges: payload.otherCharges ?? po.otherCharges,
        paidAmount: payload.paidAmount ?? po.paidAmount
    };

    if (payload.items || payload.products) {
        const items = await normalizeItems(
            payload.items || payload.products,
            purchaseType,
            supplierId
        );
        const totals = calculateLines(items, chargeHeader);
        po.items = totals.items;
        po.subtotal = totals.subtotal;
        po.discount = totals.discount;
        po.discountType = totals.discountType;
        po.tax = totals.tax;
        po.taxType = totals.taxType;
        po.shippingCost = totals.shippingCost;
        po.shippingType = totals.shippingType;
        po.otherCharges = totals.otherCharges;
        po.grandTotal = totals.grandTotal;
        po.paidAmount = totals.paidAmount;
        po.dueAmount = totals.dueAmount;
        po.paymentStatus = totals.paymentStatus;
    } else if (
        payload.discount !== undefined ||
        payload.discountType !== undefined ||
        payload.tax !== undefined ||
        payload.taxType !== undefined ||
        payload.shippingCost !== undefined ||
        payload.shippingType !== undefined ||
        payload.otherCharges !== undefined ||
        payload.paidAmount !== undefined
    ) {
        const totals = calculateLines(
            po.items.map((i) => i.toObject()),
            chargeHeader
        );
        po.items = totals.items;
        po.subtotal = totals.subtotal;
        po.discount = totals.discount;
        po.discountType = totals.discountType;
        po.tax = totals.tax;
        po.taxType = totals.taxType;
        po.shippingCost = totals.shippingCost;
        po.shippingType = totals.shippingType;
        po.otherCharges = totals.otherCharges;
        po.grandTotal = totals.grandTotal;
        po.paidAmount = totals.paidAmount;
        po.dueAmount = totals.dueAmount;
        po.paymentStatus = totals.paymentStatus;
    }

    po.purchaseType = purchaseType;
    po.supplierId = supplierId;
    po.warehouseId = warehouseId;
    po.branchId = branchId;
    if (payload.referenceNo !== undefined) {
        po.referenceNo = String(payload.referenceNo).trim();
    }
    if (payload.orderDate) po.orderDate = new Date(payload.orderDate);
    if (payload.expectedDeliveryDate !== undefined) {
        po.expectedDeliveryDate = payload.expectedDeliveryDate
            ? new Date(payload.expectedDeliveryDate)
            : null;
    }
    if (payload.paymentTerms) po.paymentTerms = payload.paymentTerms;
    if (payload.paymentDueDate !== undefined) {
        po.paymentDueDate = payload.paymentDueDate
            ? new Date(payload.paymentDueDate)
            : null;
    }
    if (payload.supplierNote !== undefined) {
        po.supplierNote = String(payload.supplierNote).trim();
    }
    if (payload.internalNote !== undefined) {
        po.internalNote = String(payload.internalNote).trim();
    }

    po.updatedBy = toObjectId(actorId) || po.updatedBy;
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const deletePurchaseOrder = async (id, actorId = null, payload = {}) => {
    const po = await findPoOrFail(id);
    if (NO_STOCK_IMPACT_STATUSES.includes(po.status)) {
        return trash.softDelete(id, actorId);
    }
    return prepareAndTrashPurchaseOrder(id, actorId, payload);
};
const restorePurchaseOrder = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeletePurchaseOrder = (id) => trash.permanentDelete(id);

const bulkDeletePurchaseOrders = async (payload = {}, actorId = null) => {
    const scope = String(payload.scope || "ids").toLowerCase();
    if (scope === "ids") {
        const ids = Array.isArray(payload.ids) ? payload.ids : [];
        let deleted = 0;
        const errors = [];
        for (const rawId of ids) {
            try {
                await deletePurchaseOrder(rawId, actorId, payload);
                deleted += 1;
            } catch (e) {
                errors.push({
                    id: String(rawId),
                    message: e.message || "Failed"
                });
            }
        }
        if (!deleted && errors.length) {
            throw new AppError(
                errors.map((e) => e.message).join(" · ") ||
                    "Failed to move purchase orders to trash.",
                400
            );
        }
        return { deleted, failed: errors.length, errors };
    }
    // Scope-based: only soft-delete statuses that are already Draft/Cancelled
    return trash.bulkSoftDelete(payload, actorId);
};
const bulkRestorePurchaseOrders = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeletePurchaseOrders = (payload) =>
    trash.bulkPermanentDelete(payload);

/** Cancel open draft GRNs, withdraw from supplier, cancel PO, then trash. */
const prepareAndTrashPurchaseOrder = async (
    id,
    actorId = null,
    payload = {}
) => {
    const po = await findPoOrFail(id);

    if (TRASH_LOCKED_STATUSES.includes(po.status)) {
        throw new AppError(
            `Purchase orders in "${po.status}" are purchase history and cannot be trashed. ` +
                `To remove a catalog product linked here, use Products → Resolve & trash.`,
            400
        );
    }

    const stockedGrn = await GRN.findOne({
        purchaseOrderId: po._id,
        ...NOT_DELETED,
        inventoryUpdated: true
    }).select("grnNumber");
    if (stockedGrn) {
        throw new AppError(
            `Cannot trash — GRN ${stockedGrn.grnNumber || ""} already updated inventory. Keep this PO as history.`,
            400
        );
    }

    if (
        !NO_STOCK_IMPACT_STATUSES.includes(po.status) &&
        !CANCEL_AND_TRASH_STATUSES.includes(po.status)
    ) {
        throw new AppError(
            `Cannot trash purchase order in status "${po.status}".`,
            400
        );
    }

    // Soft-delete open / non-stocked GRNs so Receive from PO stays clean
    const openGrns = await GRN.find({
        purchaseOrderId: po._id,
        ...NOT_DELETED,
        inventoryUpdated: { $ne: true }
    });
    const now = new Date();
    const actor = toObjectId(actorId);
    for (const g of openGrns) {
        g.isDeleted = true;
        g.deletedAt = now;
        g.deletedBy = actor;
        if (["Draft", "Pending Approval", "Cancelled"].includes(g.status) ||
            !g.status) {
            g.status = "Cancelled";
        }
        await g.save();
    }

    if (po.status !== "Cancelled") {
        po.cancelledBy = actor;
        po.cancelledAt = now;
        po.updatedBy = actor;
        applyBuyerWithdrawalNotice(po, {
            reason: payload.reason || payload.rejectionReason || "",
            forTrash: true
        });
        await po.save();
    } else if (po.supplierId && po.supplierAcceptanceStatus !== "Not Required") {
        // Already cancelled — refresh trash notice for supplier
        po.supplierAcceptanceStatus = "Withdrawn";
        po.supplierNotifiedAt = now;
        po.supplierMessage =
            `Purchase order ${po.purchaseOrderNo || ""} was moved to trash by the buyer. It is no longer active.`;
        po.updatedBy = actor;
        await po.save();
    }

    return trash.softDelete(id, actorId);
};

const submitPurchaseOrder = async (id, actorId = null) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Draft") {
        throw new AppError("Only Draft purchase orders can be submitted.", 400);
    }
    if (!po.items?.length) {
        throw new AppError("Add at least one line before submitting.", 400);
    }

    // Owner drafts that somehow stayed Draft
    if (!po.requiresApproval) {
        po.status = "Approved";
        po.approvedBy = toObjectId(actorId) || po.createdBy;
        po.approvedAt = new Date();
    } else {
        po.status = "Pending Approval";
    }
    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const approvePurchaseOrder = async (id, actor = {}) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Pending Approval") {
        throw new AppError(
            "Only Pending Approval purchase orders can be approved.",
            400
        );
    }
    const actorId = toObjectId(actor.id);
    po.status = "Approved";
    po.approvedBy = actorId;
    po.approvedAt = new Date();
    po.rejectionReason = "";
    po.updatedBy = actorId;
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const rejectPurchaseOrder = async (id, reason = "", actor = {}) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Pending Approval") {
        throw new AppError(
            "Only Pending Approval purchase orders can be rejected.",
            400
        );
    }
    const actorId = toObjectId(actor.id);
    po.status = "Cancelled";
    po.rejectedBy = actorId;
    po.rejectedAt = new Date();
    po.rejectionReason =
        String(reason || "").trim() || "Rejected by owner.";
    po.cancelledBy = actorId;
    po.cancelledAt = new Date();
    po.updatedBy = actorId;
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const markOrdered = async (id, actorId = null, payload = {}) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Approved") {
        throw new AppError(
            "Purchase order must be Approved before sending to supplier / marking Ordered.",
            400
        );
    }

    const hasSupplier = !!po.supplierId;
    const message = String(
        payload.supplierMessage || payload.message || po.supplierNote || ""
    ).trim();

    if (hasSupplier) {
        // Supplier must accept before receiving / completing
        po.status = "Awaiting Supplier";
        po.supplierAcceptanceStatus = "Pending";
        po.supplierNotifiedAt = new Date();
        po.supplierMessage =
            message ||
            `Purchase order ${po.purchaseOrderNo || ""} has been sent for your acceptance.`;
        po.supplierRespondedAt = null;
        po.supplierResponseNote = "";
        po.supplierExpectedDeliveryDate = null;
        po.supplierDeliveryType = "";
        po.supplierPaymentType = "";
        po.supplierPaymentMethod = "";
        po.supplierPartialSchedule = [];
        po.supplierPaymentSchedule = [];
    } else {
        // No supplier selected — classic Ordered path (no accept step)
        po.status = "Ordered";
        po.supplierAcceptanceStatus = "Not Required";
        po.supplierNotifiedAt = null;
        po.supplierMessage = "";
    }

    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const supplierAcceptPurchaseOrder = async (id, actorId = null, payload = {}) => {
    const po = await findPoOrFail(id);
    if (!po.supplierId) {
        throw new AppError(
            "This purchase order has no supplier — acceptance is not required.",
            400
        );
    }
    if (po.status !== "Awaiting Supplier") {
        throw new AppError(
            "Only purchase orders awaiting supplier can be accepted.",
            400
        );
    }

    const deliveryType = String(payload.deliveryType || "").trim();
    if (!["Full", "Partial"].includes(deliveryType)) {
        throw new AppError(
            "deliveryType must be Full (complete) or Partial when accepting.",
            400
        );
    }

    const paymentTypeRaw = String(payload.paymentType || "").trim();
    // Normalize labels from UI ("Partial") while keeping legacy "Advance Partial"
    const paymentType =
        paymentTypeRaw === "Partial" || paymentTypeRaw === "Advance Partial"
            ? "Partial"
            : paymentTypeRaw;
    const allowedPaymentTypes = [
        "Advance Full",
        "Partial",
        "Advance Partial",
        "Cash on Delivery",
        "Cash on Delivery Partially",
        "After Delivery"
    ];
    if (!allowedPaymentTypes.includes(paymentTypeRaw)) {
        throw new AppError(
            "paymentType must be Advance Full, Partial, Cash on Delivery, Cash on Delivery Partially, or After Delivery.",
            400
        );
    }

    const paymentMethod = String(payload.paymentMethod || "").trim();
    const allowedMethods = [
        "Cash",
        "Bank",
        "Mobile Banking",
        "Cheque",
        "Card",
        "Other",
        "Cash on Delivery"
    ];
    if (paymentMethod && !allowedMethods.includes(paymentMethod)) {
        throw new AppError("Invalid paymentMethod.", 400);
    }

    const expectedRaw =
        payload.expectedDeliveryDate || payload.deliveryDate || null;
    const expectedDeliveryDate = expectedRaw ? new Date(expectedRaw) : null;
    if (!expectedDeliveryDate || Number.isNaN(expectedDeliveryDate.getTime())) {
        throw new AppError(
            "expectedDeliveryDate is required when accepting.",
            400
        );
    }

    const poLines = po.items || [];
    const mapAllocation = (row, idx) => {
        const quantity = Number(row.quantity) || 0;
        if (quantity < 0) {
            throw new AppError(
                `lineAllocations[${idx}].quantity cannot be negative.`,
                400
            );
        }
        return {
            productId: toObjectId(row.productId) || null,
            productVariantId: toObjectId(row.productVariantId) || null,
            productName: String(row.productName || "").trim(),
            variantLabel: String(row.variantLabel || "").trim(),
            sku: String(row.sku || "").trim(),
            quantity
        };
    };

    let partialSchedule = [];
    if (deliveryType === "Partial") {
        const raw = Array.isArray(payload.partialSchedule)
            ? payload.partialSchedule
            : Array.isArray(payload.deliverySchedule)
              ? payload.deliverySchedule
              : [];
        if (!raw.length) {
            throw new AppError(
                "partialSchedule is required for Partial delivery (phases with delivery dates + line qty).",
                400
            );
        }
        const dayMs = 24 * 60 * 60 * 1000;
        const daysBetween = (from, to) => {
            if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
                return 0;
            }
            return Math.max(0, Math.round((to.getTime() - from.getTime()) / dayMs));
        };
        partialSchedule = raw.map((row, idx) => {
            let dateFrom = row.dateFrom ? new Date(row.dateFrom) : null;
            let dateTo = row.dateTo ? new Date(row.dateTo) : null;
            if (row.dueDate && !dateTo) {
                dateTo = new Date(row.dueDate);
            }
            if ((!dateFrom || Number.isNaN(dateFrom.getTime())) &&
                (row.daysFrom != null || row.days != null)) {
                dateFrom = new Date(expectedDeliveryDate);
                dateFrom.setDate(
                    dateFrom.getDate() +
                        Math.max(0, parseInt(row.daysFrom ?? row.days, 10) || 0)
                );
            }
            if ((!dateTo || Number.isNaN(dateTo.getTime())) &&
                (row.daysTo != null || row.daysFrom != null || row.days != null)) {
                dateTo = new Date(expectedDeliveryDate);
                dateTo.setDate(
                    dateTo.getDate() +
                        Math.max(
                            0,
                            parseInt(row.daysTo ?? row.daysFrom ?? row.days, 10) || 0
                        )
                );
            }
            if (!dateFrom || Number.isNaN(dateFrom.getTime())) {
                dateFrom = new Date(expectedDeliveryDate);
            }
            if (!dateTo || Number.isNaN(dateTo.getTime())) {
                dateTo = new Date(dateFrom);
            }
            if (dateTo < dateFrom) {
                throw new AppError(
                    `partialSchedule[${idx}]: dateTo cannot be before dateFrom.`,
                    400
                );
            }
            const daysFrom = daysBetween(expectedDeliveryDate, dateFrom);
            const daysTo = daysBetween(expectedDeliveryDate, dateTo);
            const allocations = Array.isArray(row.lineAllocations)
                ? row.lineAllocations.map(mapAllocation)
                : [];
            if (!allocations.length) {
                throw new AppError(
                    `partialSchedule[${idx}] must include lineAllocations (product/variant qty).`,
                    400
                );
            }
            return {
                phase: Number(row.phase) || idx + 1,
                amount: 0,
                amountType: "Fixed",
                daysFrom,
                daysTo,
                days: daysTo,
                dateFrom,
                dateTo,
                dueDate: dateTo,
                note: String(row.note || "").trim(),
                lineAllocations: allocations
            };
        });

        // Phase date chain: phase 1 from ≥ today; phase N from ≥ previous dateTo
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        for (let i = 0; i < partialSchedule.length; i++) {
            const phase = partialSchedule[i];
            const minFrom =
                i === 0
                    ? startOfToday
                    : partialSchedule[i - 1].dateTo ||
                      partialSchedule[i - 1].dateFrom;
            if (phase.dateFrom < minFrom) {
                throw new AppError(
                    i === 0
                        ? `partialSchedule[0]: dateFrom cannot be before today.`
                        : `partialSchedule[${i}]: dateFrom cannot be before previous phase dateTo.`,
                    400
                );
            }
        }

        // Qty across phases must equal ordered qty per PO line
        const allocKey = (a) =>
            `${String(a.productId || "")}|${String(a.productVariantId || "")}|${String(a.sku || "")}|${String(a.variantLabel || "")}`;
        const orderedByKey = new Map();
        for (const line of poLines) {
            const key = allocKey(line);
            orderedByKey.set(
                key,
                (orderedByKey.get(key) || 0) + (Number(line.quantity) || 0)
            );
        }
        const allocatedByKey = new Map();
        for (const phase of partialSchedule) {
            for (const a of phase.lineAllocations || []) {
                const key = allocKey(a);
                allocatedByKey.set(
                    key,
                    (allocatedByKey.get(key) || 0) + (Number(a.quantity) || 0)
                );
            }
        }
        for (const [key, orderedQty] of orderedByKey.entries()) {
            const allocated = allocatedByKey.get(key) || 0;
            if (Math.abs(allocated - orderedQty) > 0.0001) {
                throw new AppError(
                    `Partial delivery quantities must total ordered qty for each line (got ${allocated}, expected ${orderedQty}).`,
                    400
                );
            }
        }
        for (const [key, allocated] of allocatedByKey.entries()) {
            if (!orderedByKey.has(key) && allocated > 0) {
                throw new AppError(
                    `Partial delivery includes unknown line allocation (${key}).`,
                    400
                );
            }
        }
    } else {
        // Full delivery — one phase with all ordered lines
        partialSchedule = [
            {
                phase: 1,
                amount: Number(po.grandTotal) || 0,
                amountType: "Fixed",
                daysFrom: 0,
                daysTo: 0,
                days: 0,
                dateFrom: expectedDeliveryDate,
                dateTo: expectedDeliveryDate,
                dueDate: expectedDeliveryDate,
                note: "Complete delivery",
                lineAllocations: poLines.map((i) => ({
                    productId: i.productId || null,
                    productVariantId: i.productVariantId || null,
                    productName: i.productName || "",
                    variantLabel: i.variantLabel || "",
                    sku: i.sku || "",
                    quantity: Number(i.quantity) || 0
                }))
            }
        ];
    }

    let paymentSchedule = [];
    const needsPaymentPhases =
        paymentType === "Partial" ||
        paymentType === "Advance Partial" ||
        paymentType === "Cash on Delivery Partially" ||
        paymentType === "Advance Full";
    if (needsPaymentPhases) {
        const rawPay = Array.isArray(payload.paymentSchedule)
            ? payload.paymentSchedule
            : [];
        const isMultiPartial =
            paymentType === "Partial" ||
            paymentType === "Advance Partial" ||
            paymentType === "Cash on Delivery Partially";
        if (isMultiPartial && !rawPay.length) {
            throw new AppError(
                "paymentSchedule is required for partial payment (phase amounts).",
                400
            );
        }
        if (paymentType === "Advance Full" && !rawPay.length) {
            paymentSchedule = [
                {
                    phase: 1,
                    amount: Number(po.grandTotal) || 0,
                    amountType: "Fixed",
                    days: 0,
                    dueDate: expectedDeliveryDate,
                    method: paymentMethod || "Bank",
                    note: "Full advance"
                }
            ];
        } else {
            const grand = Number(po.grandTotal) || 0;
            let sumFixed = 0;
            let sumPct = 0;
            let scheduleAmountType = null;
            paymentSchedule = rawPay.map((row, idx) => {
                const amountType =
                    String(row.amountType || "Fixed") === "Percentage"
                        ? "Percentage"
                        : "Fixed";
                if (scheduleAmountType == null) scheduleAmountType = amountType;
                if (scheduleAmountType !== amountType) {
                    throw new AppError(
                        "All payment phases must use the same amount type (Fixed or Percentage).",
                        400
                    );
                }
                const amount = Number(row.amount) || 0;
                if (amount < 0) {
                    throw new AppError(
                        `paymentSchedule[${idx}].amount cannot be negative.`,
                        400
                    );
                }
                if (amountType === "Percentage") {
                    sumPct += amount;
                } else {
                    sumFixed += amount;
                }
                let dueDate = row.dueDate ? new Date(row.dueDate) : null;
                let days = Math.max(0, parseInt(row.days, 10) || 0);
                if (dueDate && !Number.isNaN(dueDate.getTime())) {
                    days = Math.max(
                        0,
                        Math.round(
                            (dueDate.getTime() - expectedDeliveryDate.getTime()) /
                                (24 * 60 * 60 * 1000)
                        )
                    );
                } else {
                    dueDate = new Date(expectedDeliveryDate);
                    dueDate.setDate(dueDate.getDate() + days);
                }
                const method = String(
                    row.method ||
                        paymentMethod ||
                        (paymentType === "Cash on Delivery Partially"
                            ? "Cash on Delivery"
                            : "")
                ).trim();
                return {
                    phase: Number(row.phase) || idx + 1,
                    amount,
                    amountType,
                    days,
                    dueDate,
                    method,
                    note: String(row.note || "").trim()
                };
            });
            if (isMultiPartial) {
                if (scheduleAmountType === "Percentage") {
                    if (Math.abs(sumPct - 100) > 0.05) {
                        throw new AppError(
                            `Partial payment percentages must total 100% (got ${sumPct.toFixed(2)}%).`,
                            400
                        );
                    }
                } else if (grand > 0 && Math.abs(sumFixed - grand) > 0.05) {
                    throw new AppError(
                        `Partial payment fixed amounts must total PO grand total (${grand}).`,
                        400
                    );
                }
                const positiveCount = paymentSchedule.filter((p) => p.amount > 0).length;
                if (positiveCount < 1) {
                    throw new AppError(
                        "At least one payment phase must have an amount greater than 0.",
                        400
                    );
                }
            }
        }
    } else if (paymentType === "Cash on Delivery") {
        paymentSchedule = [
            {
                phase: 1,
                amount: Number(po.grandTotal) || 0,
                amountType: "Fixed",
                days: 0,
                dueDate: expectedDeliveryDate,
                method: "Cash on Delivery",
                note: "Pay on delivery"
            }
        ];
    } else if (paymentType === "After Delivery") {
        paymentSchedule = [
            {
                phase: 1,
                amount: Number(po.grandTotal) || 0,
                amountType: "Fixed",
                days: 0,
                dueDate: expectedDeliveryDate,
                method: paymentMethod || "Bank",
                note: "Pay after delivery complete"
            }
        ];
    }

    po.status = "Supplier Accepted";
    po.supplierAcceptanceStatus = "Accepted";
    po.supplierRespondedAt = new Date();
    po.supplierResponseNote = String(
        payload.note || payload.responseNote || ""
    ).trim();
    po.supplierExpectedDeliveryDate = expectedDeliveryDate;
    po.supplierDeliveryType = deliveryType;
    po.supplierPaymentType = paymentType;
    po.supplierPaymentMethod =
        paymentMethod ||
        (paymentType === "Cash on Delivery" ||
        paymentType === "Cash on Delivery Partially"
            ? "Cash on Delivery"
            : "");
    po.supplierPartialSchedule = partialSchedule;
    po.supplierPaymentSchedule = paymentSchedule;
    if (!po.expectedDeliveryDate) {
        po.expectedDeliveryDate = expectedDeliveryDate;
    }
    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const supplierRejectPurchaseOrder = async (id, actorId = null, payload = {}) => {
    const po = await findPoOrFail(id);
    if (!po.supplierId) {
        throw new AppError(
            "This purchase order has no supplier — rejection is not required.",
            400
        );
    }
    if (po.status !== "Awaiting Supplier") {
        throw new AppError(
            "Only purchase orders awaiting supplier can be rejected.",
            400
        );
    }

    const note = String(payload.note || payload.responseNote || payload.reason || "").trim();
    if (!note) {
        throw new AppError("A rejection note/reason is required.", 400);
    }

    po.status = "Supplier Rejected";
    po.supplierAcceptanceStatus = "Rejected";
    po.supplierRespondedAt = new Date();
    po.supplierResponseNote = note;
    po.supplierDeliveryType = "";
    po.supplierPartialSchedule = [];
    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const lineMatchKey = (row) =>
    `${row.productId || ""}|${row.productVariantId || ""}|${row.sku || ""}|${row.variantLabel || ""}`;

/**
 * Supplier marks goods as sent (full or one partial phase).
 * Stores sentAt + transfer day range. Updates supplierSentQuantity and status.
 */
const supplierSendPurchaseOrder = async (id, actorId = null, payload = {}) => {
    const po = await findPoOrFail(id);
    if (!po.supplierId) {
        throw new AppError("This purchase order has no supplier.", 400);
    }
    const sendable = ["Supplier Accepted", "Partially Delivered"];
    if (!sendable.includes(po.status)) {
        throw new AppError(
            "Only Supplier Accepted or Partially Delivered POs can be sent.",
            400
        );
    }

    const transferDaysMin = Math.max(
        0,
        parseInt(payload.transferDaysMin ?? payload.daysMin, 10) || 0
    );
    const transferDaysMax = Math.max(
        transferDaysMin,
        parseInt(payload.transferDaysMax ?? payload.daysMax, 10) || transferDaysMin
    );
    if (
        payload.transferDaysMin == null &&
        payload.daysMin == null &&
        payload.transferDaysMax == null &&
        payload.daysMax == null
    ) {
        throw new AppError(
            "transferDaysMin and transferDaysMax are required (transit time).",
            400
        );
    }

    const deliveryType = po.supplierDeliveryType === "Partial" ? "Partial" : "Full";
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!rawLines.length) {
        throw new AppError("At least one product/variant qty line is required.", 400);
    }

    const varianceReason = String(payload.varianceReason || "").trim();
    const note = String(payload.note || "").trim();
    const sentAt = payload.sentAt ? new Date(payload.sentAt) : new Date();
    if (Number.isNaN(sentAt.getTime())) {
        throw new AppError("Invalid sentAt date/time.", 400);
    }

    let phaseIndex = -1;
    let expectedByKey = new Map();

    if (deliveryType === "Full") {
        for (const item of po.items || []) {
            const remaining =
                Math.max(0, Number(item.quantity) || 0) -
                Math.max(0, Number(item.supplierSentQuantity) || 0);
            if (remaining <= 0) continue;
            expectedByKey.set(lineMatchKey(item), {
                item,
                expected: remaining,
                productName: item.productName || "",
                variantLabel: item.variantLabel || "",
                sku: item.sku || ""
            });
        }
        if (!expectedByKey.size) {
            throw new AppError("All ordered quantities are already sent.", 400);
        }
    } else {
        const schedule = po.supplierPartialSchedule || [];
        phaseIndex = schedule.findIndex((p) => !p.isCompleted);
        if (phaseIndex < 0) {
            throw new AppError("All partial delivery phases are already completed.", 400);
        }
        const phase = schedule[phaseIndex];
        const requestedPhase = payload.phase != null ? Number(payload.phase) : null;
        if (
            requestedPhase != null &&
            !Number.isNaN(requestedPhase) &&
            requestedPhase !== Number(phase.phase)
        ) {
            throw new AppError(
                `Only phase ${phase.phase} can be sent now. Complete it before later phases.`,
                400
            );
        }
        for (const alloc of phase.lineAllocations || []) {
            const expected =
                Math.max(0, Number(alloc.quantity) || 0) -
                Math.max(0, Number(alloc.sentQuantity) || 0);
            if (expected <= 0) continue;
            expectedByKey.set(lineMatchKey(alloc), {
                alloc,
                expected,
                productName: alloc.productName || "",
                variantLabel: alloc.variantLabel || "",
                sku: alloc.sku || ""
            });
        }
        if (!expectedByKey.size) {
            throw new AppError("This phase has no remaining quantity to send.", 400);
        }
    }

    let hasVariance = false;
    const shipmentLines = [];
    const seen = new Set();

    for (const raw of rawLines) {
        const key = lineMatchKey(raw);
        const meta = expectedByKey.get(key);
        if (!meta) {
            // try softer match by product+variant only
            let soft = null;
            for (const [k, v] of expectedByKey.entries()) {
                const pid = String(raw.productId || "");
                const vid = String(raw.productVariantId || "");
                if (
                    k.startsWith(`${pid}|${vid}|`) ||
                    (pid && k.startsWith(`${pid}|`))
                ) {
                    soft = { key: k, meta: v };
                    break;
                }
            }
            if (!soft) {
                throw new AppError(
                    `Unexpected line in send payload: ${raw.productName || key}`,
                    400
                );
            }
            if (seen.has(soft.key)) continue;
            const qty = Number(raw.quantity);
            if (!Number.isFinite(qty) || qty < 0) {
                throw new AppError("Send quantity cannot be negative.", 400);
            }
            if (qty > soft.meta.expected + 0.0001) {
                throw new AppError(
                    `Send quantity cannot exceed PO remaining ${soft.meta.expected} for ${soft.meta.productName || soft.key}.`,
                    400
                );
            }
            if (qty < soft.meta.expected - 0.0001) hasVariance = true;
            seen.add(soft.key);
            shipmentLines.push({
                key: soft.key,
                meta: soft.meta,
                quantity: qty,
                expectedQuantity: soft.meta.expected
            });
            continue;
        }
        if (seen.has(key)) continue;
        const qty = Number(raw.quantity);
        if (!Number.isFinite(qty) || qty < 0) {
            throw new AppError("Send quantity cannot be negative.", 400);
        }
        if (qty > meta.expected + 0.0001) {
            throw new AppError(
                `Send quantity cannot exceed PO remaining ${meta.expected} for ${meta.productName || key}.`,
                400
            );
        }
        if (qty < meta.expected - 0.0001) hasVariance = true;
        seen.add(key);
        shipmentLines.push({
            key,
            meta,
            quantity: qty,
            expectedQuantity: meta.expected
        });
    }

    // Require every expected line to be present (0 allowed only with variance reason)
    for (const [key, meta] of expectedByKey.entries()) {
        if (seen.has(key)) continue;
        hasVariance = true;
        shipmentLines.push({
            key,
            meta,
            quantity: 0,
            expectedQuantity: meta.expected
        });
    }

    if (hasVariance && varianceReason.length < 3) {
        throw new AppError(
            "Sent qty is less than expected. Explain why (varianceReason).",
            400
        );
    }

    const positive = shipmentLines.filter((l) => l.quantity > 0);
    if (!positive.length) {
        throw new AppError("Enter at least one quantity greater than 0.", 400);
    }

    // Apply sent quantities onto PO items
    for (const row of shipmentLines) {
        if (row.quantity <= 0) continue;
        const item =
            row.meta.item ||
            (po.items || []).find((i) => lineMatchKey(i) === row.key) ||
            (po.items || []).find(
                (i) =>
                    String(i.productId || "") ===
                        String(row.meta.alloc?.productId || "") &&
                    String(i.productVariantId || "") ===
                        String(row.meta.alloc?.productVariantId || "")
            );
        if (item) {
            item.supplierSentQuantity =
                Math.max(0, Number(item.supplierSentQuantity) || 0) + row.quantity;
        }
        if (row.meta.alloc) {
            row.meta.alloc.sentQuantity =
                Math.max(0, Number(row.meta.alloc.sentQuantity) || 0) + row.quantity;
        }
    }

    if (deliveryType === "Partial" && phaseIndex >= 0) {
        const phase = po.supplierPartialSchedule[phaseIndex];
        phase.isCompleted = true;
        phase.completedAt = sentAt;
    }

    if (!Array.isArray(po.supplierShipments)) po.supplierShipments = [];
    po.supplierShipments.push({
        sentAt,
        transferDaysMin,
        transferDaysMax,
        deliveryMode: deliveryType,
        phase:
            deliveryType === "Partial" && phaseIndex >= 0
                ? Number(po.supplierPartialSchedule[phaseIndex].phase) ||
                  phaseIndex + 1
                : null,
        varianceReason,
        note,
        lines: shipmentLines.map((row) => ({
            productId: row.meta.item?.productId || row.meta.alloc?.productId || null,
            productVariantId:
                row.meta.item?.productVariantId ||
                row.meta.alloc?.productVariantId ||
                null,
            productName: row.meta.productName || "",
            variantLabel: row.meta.variantLabel || "",
            sku: row.meta.sku || "",
            quantity: row.quantity,
            expectedQuantity: row.expectedQuantity
        }))
    });

    // Derive status from remaining send qty
    let totalOrdered = 0;
    let totalSent = 0;
    for (const item of po.items || []) {
        totalOrdered += Number(item.quantity) || 0;
        totalSent += Number(item.supplierSentQuantity) || 0;
    }
    if (totalSent <= 0) {
        po.status = "Supplier Accepted";
    } else if (totalSent + 0.0001 >= totalOrdered) {
        po.status = "Completely Delivered";
        if (deliveryType === "Partial") {
            for (const p of po.supplierPartialSchedule || []) {
                p.isCompleted = true;
                if (!p.completedAt) p.completedAt = sentAt;
            }
        }
    } else {
        po.status = "Partially Delivered";
    }

    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const cancelPurchaseOrder = async (id, actorId = null, reason = "") => {
    const po = await findPoOrFail(id);
    if (po.status === "Cancelled") {
        throw new AppError("Purchase order is already cancelled.", 400);
    }
    if (["Received", "Completed", "Partially Received"].includes(po.status)) {
        throw new AppError(
            "Fully received / completed / partially received purchase orders cannot be cancelled.",
            400
        );
    }

    po.status = "Cancelled";
    po.cancelledBy = toObjectId(actorId);
    po.cancelledAt = new Date();
    if (reason) po.rejectionReason = String(reason).trim();
    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

/** Friendly trash guidance for Partially Received / locked POs */
const getPurchaseOrderDeleteCheck = async (id) => {
    const po = await PurchaseOrder.findOne({ _id: id, ...NOT_DELETED })
        .populate("items.productId", "name productCode status trackingType")
        .lean();
    if (!po) throw new AppError("Purchase order not found.", 404);

    const canTrash = ["Draft", "Cancelled"].includes(po.status);
    const products = [];
    const seen = new Set();
    for (const item of po.items || []) {
        const p = item.productId;
        if (!p || typeof p !== "object") continue;
        const pid = String(p._id || "");
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        products.push({
            id: pid,
            name: p.name || item.productName || "",
            productCode: p.productCode || "",
            status: p.status || "",
            trackingType: p.trackingType || item.trackingType || ""
        });
    }

    let grns = [];
    try {
        const Grn = mongoose.models.Grn || require("../model/grn");
        grns = await Grn.find({
            purchaseOrderId: po._id,
            isDeleted: { $ne: true }
        })
            .select("grnNumber status createdAt")
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();
    } catch (_) {
        grns = [];
    }

    let tip =
        "Only Draft or Cancelled purchase orders can move to trash.";
    if (po.status === "Partially Received" || po.status === "Ordered") {
        tip =
            "This PO already has (or expects) receipts, so it stays as purchase history and cannot be trashed. " +
            "To remove a catalog product linked here: open Products → Resolve & trash. " +
            "That unlinks the product from this PO and keeps the PO/GRN history intact.";
    } else if (["Received", "Completed"].includes(po.status)) {
        tip =
            "Fully received/completed POs are permanent history and cannot be trashed.";
    }

    return {
        canTrash,
        status: po.status,
        purchaseOrderNo: po.purchaseOrderNo || "",
        tip,
        products,
        grns: grns.map((g) => ({
            id: String(g._id),
            grnNumber: g.grnNumber || "",
            status: g.status || ""
        }))
    };
};

/** Product helper for Existing PO form: stock + linked suppliers + last prices */
const getProductPurchaseContext = async (productId) => {
    const id = toObjectId(productId);
    if (!id) throw new AppError("Invalid product id.", 400);

    const product = await Product.findOne({ _id: id, ...NOT_DELETED })
        .populate(
            "suppliers.supplierId",
            "supplierCode name companyName phone email status paymentTerms creditLimit creditDays currentBalance totalPurchaseAmount totalPaidAmount totalDueAmount openingBalance lastPurchaseDate lastPaymentDate address city country bankAccounts contactPersons"
        )
        .populate(
            "primarySupplierId",
            "supplierCode name companyName phone email paymentTerms totalPaidAmount totalDueAmount currentBalance"
        )
        .lean();

    if (!product) throw new AppError("Product not found.", 404);

    const variants = await ProductVariant.find({
        productId: id,
        isDeleted: { $ne: true }
    })
        .select(
            "sku barcode combinationString purchasePrice costPrice sellingPrice wholesalePrice quantity attributes status isDefaultVariant"
        )
        .populate("attributes.variantTypeId", "type name")
        .populate("attributes.variantId", "name")
        .lean();

    const history = await PurchaseOrder.find({
        ...NOT_DELETED,
        "items.productId": id,
        status: {
            $in: [
                "Ordered",
                "Partially Received",
                "Received",
                "Completed",
                "Approved"
            ]
        }
    })
        .sort({ orderDate: -1 })
        .limit(10)
        .select("purchaseOrderNo orderDate status grandTotal items supplierId")
        .populate("supplierId", "name supplierCode")
        .lean();

    return {
        product,
        variants,
        purchaseHistory: history.map((po) => ({
            id: po._id,
            purchaseOrderNo: po.purchaseOrderNo,
            orderDate: po.orderDate,
            status: po.status,
            grandTotal: po.grandTotal,
            supplier: po.supplierId,
            lines: (po.items || [])
                .filter((i) => String(i.productId) === String(id))
                .map((i) => ({
                    productName: i.productName,
                    sku: i.sku,
                    quantity: i.quantity,
                    purchasePrice: i.purchasePrice
                }))
        }))
    };
};

module.exports = {
    createPurchaseOrder,
    getPurchaseOrders,
    getPurchaseOrderById,
    getPurchaseOrderStats,
    updatePurchaseOrder,
    deletePurchaseOrder,
    restorePurchaseOrder,
    permanentDeletePurchaseOrder,
    bulkDeletePurchaseOrders,
    bulkRestorePurchaseOrders,
    bulkPermanentDeletePurchaseOrders,
    submitPurchaseOrder,
    approvePurchaseOrder,
    rejectPurchaseOrder,
    markOrdered,
    supplierAcceptPurchaseOrder,
    supplierRejectPurchaseOrder,
    supplierSendPurchaseOrder,
    cancelPurchaseOrder,
    getPurchaseOrderDeleteCheck,
    getProductPurchaseContext,
    LOCKED_AFTER
};
