const mongoose = require("mongoose");
const PurchaseOrder = require("../model/purchaseOrder");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Supplier = require("../model/supplier");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const { generatePurchaseOrderCode } = require("./codeGenerator");
const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };

const EDITABLE_STATUSES = ["Draft", "Pending Approval"];
const LOCKED_AFTER = ["Ordered", "Partially Received", "Received", "Completed"];

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
        .populate("branchId", "name code city")
        .populate("supplierId", "supplierCode name phone email status")
        .populate("warehouseId", "warehouseCode warehouseName city status")
        .populate("items.productId", "name productCode trackingType productType totalStock availableStock purchasePrice")
        .populate("items.productVariantId", "sku combinationString sellingPrice purchasePrice attributes")
        .populate("approvedBy", "name email")
        .populate("createdBy", "name email")
        .populate("rejectedBy", "name email")
        .populate("cancelledBy", "name email");

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

    const discount = Math.max(Number(header.discount) || 0, 0);
    const tax = Math.max(Number(header.tax) || 0, 0);
    const shippingCost = Math.max(Number(header.shippingCost) || 0, 0);
    const otherCharges = Math.max(Number(header.otherCharges) || 0, 0);
    const paidAmount = Math.max(Number(header.paidAmount) || 0, 0);
    const grandTotal =
        subtotal - discount + tax + shippingCost + otherCharges;
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

        items.push({
            _id: toObjectId(raw._id || raw.id) || undefined,
            productId: product?._id || null,
            productVariantId: variant?._id || null,
            sku,
            productName:
                product && variant
                    ? `${product.name} (${variant.combinationString || variant.sku || "Variant"})`
                    : productName,
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
                0
        });
    }

    return items;
};

const assertRefs = async ({ supplierId, warehouseId, branchId }) => {
    const supplier = await Supplier.findOne({
        _id: supplierId,
        ...NOT_DELETED
    });
    if (!supplier) throw new AppError("Supplier not found.", 404);

    const warehouse = await Warehouse.findOne({
        _id: warehouseId,
        ...NOT_DELETED
    });
    if (!warehouse) throw new AppError("Warehouse not found.", 404);

    if (branchId) {
        const branch = await Branch.findOne({ _id: branchId, ...NOT_DELETED });
        if (!branch) throw new AppError("Branch not found.", 404);
    }

    return { supplier, warehouse };
};

const findPoOrFail = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid purchase order id.", 400);
    }
    const po = await PurchaseOrder.findOne({ _id: id, ...NOT_DELETED });
    if (!po) throw new AppError("Purchase order not found.", 404);
    return po;
};

const createPurchaseOrder = async (payload = {}, actorId = null) => {
    const purchaseType =
        payload.purchaseType === "New" ? "New" : "Existing";
    const supplierId = toObjectId(payload.supplierId);
    const warehouseId = toObjectId(payload.warehouseId);
    const branchId = toObjectId(payload.branchId);
    const createdBy = toObjectId(actorId) || toObjectId(payload.createdBy);

    if (!supplierId) throw new AppError("Supplier is required.", 400);
    if (!warehouseId) throw new AppError("Warehouse is required.", 400);
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
        tax: totals.tax,
        shippingCost: totals.shippingCost,
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

    const filter = { ...NOT_DELETED };

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

    const [items, total] = await Promise.all([
        populatePo(
            PurchaseOrder.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ),
        PurchaseOrder.countDocuments(filter)
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

const getPurchaseOrderById = async (id) => {
    const po = await populatePo(
        PurchaseOrder.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!po) throw new AppError("Purchase order not found.", 404);
    return po;
};

const getPurchaseOrderStats = async () => {
    const rows = await PurchaseOrder.aggregate([
        { $match: { ...NOT_DELETED } },
        {
            $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: "$grandTotal" }
            }
        }
    ]);

    const stats = {
        total: 0,
        draft: 0,
        pendingApproval: 0,
        approved: 0,
        ordered: 0,
        partiallyReceived: 0,
        completed: 0,
        cancelled: 0,
        totalAmount: 0
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
        toObjectId(payload.supplierId) || po.supplierId;
    const warehouseId =
        toObjectId(payload.warehouseId) || po.warehouseId;
    const branchId =
        payload.branchId === null || payload.branchId === ""
            ? null
            : toObjectId(payload.branchId) || po.branchId;

    await assertRefs({ supplierId, warehouseId, branchId });

    if (payload.items || payload.products) {
        const items = await normalizeItems(
            payload.items || payload.products,
            purchaseType,
            supplierId
        );
        const totals = calculateLines(items, {
            discount: payload.discount ?? po.discount,
            tax: payload.tax ?? po.tax,
            shippingCost: payload.shippingCost ?? po.shippingCost,
            otherCharges: payload.otherCharges ?? po.otherCharges,
            paidAmount: payload.paidAmount ?? po.paidAmount
        });
        po.items = totals.items;
        po.subtotal = totals.subtotal;
        po.discount = totals.discount;
        po.tax = totals.tax;
        po.shippingCost = totals.shippingCost;
        po.otherCharges = totals.otherCharges;
        po.grandTotal = totals.grandTotal;
        po.paidAmount = totals.paidAmount;
        po.dueAmount = totals.dueAmount;
        po.paymentStatus = totals.paymentStatus;
    } else if (
        payload.discount !== undefined ||
        payload.tax !== undefined ||
        payload.shippingCost !== undefined ||
        payload.otherCharges !== undefined ||
        payload.paidAmount !== undefined
    ) {
        const totals = calculateLines(po.items.map((i) => i.toObject()), {
            discount: payload.discount ?? po.discount,
            tax: payload.tax ?? po.tax,
            shippingCost: payload.shippingCost ?? po.shippingCost,
            otherCharges: payload.otherCharges ?? po.otherCharges,
            paidAmount: payload.paidAmount ?? po.paidAmount
        });
        po.items = totals.items;
        po.subtotal = totals.subtotal;
        po.discount = totals.discount;
        po.tax = totals.tax;
        po.shippingCost = totals.shippingCost;
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

const deletePurchaseOrder = async (id, actorId = null) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Draft") {
        throw new AppError("Only Draft purchase orders can be deleted.", 400);
    }
    po.isDeleted = true;
    po.deletedAt = new Date();
    po.deletedBy = toObjectId(actorId);
    po.status = "Cancelled";
    await po.save();
    return { id: po._id, deleted: true };
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

const markOrdered = async (id, actorId = null) => {
    const po = await findPoOrFail(id);
    if (po.status !== "Approved") {
        throw new AppError(
            "Purchase order must be Approved before marking Ordered (sent to supplier).",
            400
        );
    }
    po.status = "Ordered";
    po.updatedBy = toObjectId(actorId);
    await po.save();
    return populatePo(PurchaseOrder.findById(po._id));
};

const cancelPurchaseOrder = async (id, actorId = null, reason = "") => {
    const po = await findPoOrFail(id);
    if (["Received", "Completed"].includes(po.status)) {
        throw new AppError(
            "Fully received / completed purchase orders cannot be cancelled.",
            400
        );
    }
    if (po.status === "Cancelled") {
        throw new AppError("Purchase order is already cancelled.", 400);
    }
    if (po.status === "Partially Received") {
        throw new AppError(
            "Partially received POs cannot be cancelled — complete remaining via GRN.",
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

/** Product helper for Existing PO form: stock + linked suppliers + last prices */
const getProductPurchaseContext = async (productId) => {
    const id = toObjectId(productId);
    if (!id) throw new AppError("Invalid product id.", 400);

    const product = await Product.findOne({ _id: id, ...NOT_DELETED })
        .populate("suppliers.supplierId", "supplierCode name phone email status")
        .populate("primarySupplierId", "supplierCode name phone email")
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
    submitPurchaseOrder,
    approvePurchaseOrder,
    rejectPurchaseOrder,
    markOrdered,
    cancelPurchaseOrder,
    getProductPurchaseContext,
    LOCKED_AFTER
};
