const mongoose = require("mongoose");
const SalesOrder = require("../model/salesOrder");
const Customer = require("../model/customer");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const Inventory = require("../model/inventory");
const StockMovement = require("../model/StockMovement");
const ItemTrack = require("../model/itemTrack");
const {
    generateSalesOrderCode,
    generateStockMovementCode,
    generateCustomerCode
} = require("./codeGenerator");
const productService = require("./productService");
const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };
const EDITABLE_STATUSES = ["Draft", "Pending Approval"];

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveTrackingType = (value) =>
    String(value || "").toUpperCase().includes("IMEI") &&
    !String(value || "").toUpperCase().includes("NON")
        ? "IMEI"
        : "Non-IMEI";

const populateSo = (query) =>
    query
        .populate("branchId", "name code city branchCode")
        .populate("warehouseId", "warehouseCode warehouseName city status")
        .populate(
            "customerId",
            "customerCode name companyName phone email status paymentTerms creditLimit"
        )
        .populate(
            "items.productId",
            "name productCode trackingType productType totalStock availableStock sellingPrice"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString sellingPrice attributes quantity"
        )
        .populate("approvedBy", "name email")
        .populate("createdBy", "name email");

const chargeType = (value) =>
    String(value || "Fixed").toLowerCase() === "percentage"
        ? "Percentage"
        : "Fixed";

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
        const unitPrice = Math.max(Number(raw.unitPrice) || 0, 0);
        const discount = Math.max(Number(raw.discount) || 0, 0);
        const tax = Math.max(Number(raw.tax) || 0, 0);
        const deliveredQuantity = Math.max(Number(raw.deliveredQuantity) || 0, 0);
        const total = quantity * unitPrice - discount + tax;
        subtotal += total;
        return {
            ...raw,
            quantity,
            unitPrice,
            discount,
            tax,
            total,
            deliveredQuantity,
            pendingQuantity: Math.max(quantity - deliveredQuantity, 0)
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
    const appliedShipping = resolveCharge(shippingValue, shippingType, subtotal);

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

const WARRANTY_TYPES = ["No Warranty", "Days", "Months", "Years", "Lifetime"];

const resolveWarrantyType = (value) => {
    const v = String(value || "No Warranty").trim();
    return WARRANTY_TYPES.includes(v) ? v : "No Warranty";
};

/**
 * Compute warranty end date from start + type/period.
 * Returns null for No Warranty / Lifetime.
 */
const computeWarrantyEndDate = (startDate, warrantyType, warrantyPeriod) => {
    const type = resolveWarrantyType(warrantyType);
    if (type === "No Warranty" || type === "Lifetime") return null;
    const period = Math.max(Number(warrantyPeriod) || 0, 0);
    if (period <= 0) return null;
    const start = startDate ? new Date(startDate) : new Date();
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    if (type === "Days") end.setDate(end.getDate() + period);
    else if (type === "Months") end.setMonth(end.getMonth() + period);
    else if (type === "Years") end.setFullYear(end.getFullYear() + period);
    return end;
};

const resolveWarrantyStatus = (warrantyType, warrantyEndDate, now = new Date()) => {
    const type = resolveWarrantyType(warrantyType);
    if (type === "No Warranty") return "None";
    if (type === "Lifetime") return "Lifetime";
    if (!warrantyEndDate) return "None";
    return new Date(warrantyEndDate) > now ? "Active" : "Expired";
};

const normalizeItems = async (itemsInput = []) => {
    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
        throw new AppError("At least one sales line is required.", 400);
    }

    const items = [];

    for (const raw of itemsInput) {
        const productId = toObjectId(raw.productId);
        if (!productId) {
            throw new AppError("Every sales line requires a product.", 400);
        }

        const product = await Product.findOne({ _id: productId, ...NOT_DELETED });
        if (!product) {
            throw new AppError("One or more products were not found.", 404);
        }

        const productVariantId = toObjectId(raw.productVariantId);
        let variant = null;

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
        } else if (productVariantId) {
            variant = await ProductVariant.findOne({
                _id: productVariantId,
                productId,
                isDeleted: { $ne: true }
            });
        }

        const trackingType = resolveTrackingType(
            raw.trackingType || product.trackingType
        );
        const quantity = Math.max(Number(raw.quantity) || 0, 0);
        if (quantity <= 0) {
            throw new AppError(
                `Quantity must be greater than 0 for "${product.name}".`,
                400
            );
        }

        let imeis = Array.isArray(raw.imeis)
            ? raw.imeis.map((e) => String(e).trim()).filter(Boolean)
            : [];
        imeis = [...new Set(imeis)];

        if (trackingType === "IMEI") {
            if (imeis.length === 0) {
                throw new AppError(
                    `IMEI list required for "${product.name}".`,
                    400
                );
            }
            if (imeis.length !== quantity) {
                throw new AppError(
                    `IMEI count (${imeis.length}) must match quantity (${quantity}) for "${product.name}".`,
                    400
                );
            }
        }

        const unitPrice =
            Math.max(Number(raw.unitPrice) || 0, 0) ||
            Number(variant?.sellingPrice) ||
            Number(product.sellingPrice) ||
            0;

        const warrantyType = resolveWarrantyType(
            raw.warrantyType != null && String(raw.warrantyType).trim() !== ""
                ? raw.warrantyType
                : product.warrantyType
        );
        let warrantyPeriod = Math.max(
            Number(
                raw.warrantyPeriod != null
                    ? raw.warrantyPeriod
                    : product.warrantyPeriod
            ) || 0,
            0
        );
        if (warrantyType === "No Warranty" || warrantyType === "Lifetime") {
            warrantyPeriod = warrantyType === "Lifetime" ? warrantyPeriod : 0;
        }

        // Provisional dates (finalized on stock OUT / sale)
        const provisionalStart = raw.warrantyStartDate
            ? new Date(raw.warrantyStartDate)
            : null;
        let warrantyStartDate =
            provisionalStart && !Number.isNaN(provisionalStart.getTime())
                ? provisionalStart
                : null;
        let warrantyEndDate = raw.warrantyEndDate
            ? new Date(raw.warrantyEndDate)
            : null;
        if (warrantyEndDate && Number.isNaN(warrantyEndDate.getTime())) {
            warrantyEndDate = null;
        }
        if (!warrantyEndDate && warrantyStartDate) {
            warrantyEndDate = computeWarrantyEndDate(
                warrantyStartDate,
                warrantyType,
                warrantyPeriod
            );
        }

        items.push({
            productId,
            productVariantId: variant?._id || null,
            sku: (raw.sku || variant?.sku || "").toString().trim(),
            productName:
                (raw.productName || product.name || "").toString().trim() ||
                product.name,
            quantity,
            deliveredQuantity: 0,
            pendingQuantity: quantity,
            unitId: toObjectId(raw.unitId),
            unitPrice,
            discount: Math.max(Number(raw.discount) || 0, 0),
            tax: Math.max(Number(raw.tax) || 0, 0),
            total: 0,
            remarks: (raw.remarks || "").toString(),
            trackingType,
            imeis: trackingType === "IMEI" ? imeis : [],
            warrantyType,
            warrantyPeriod,
            warrantyStartDate,
            warrantyEndDate,
            warrantyNote: (raw.warrantyNote || "").toString().trim()
        });
    }

    return items;
};

const resolveHeaderRefs = async (payload) => {
    const warehouseId = toObjectId(payload.warehouseId);
    const branchId = toObjectId(payload.branchId);

    if (!warehouseId) throw new AppError("Warehouse is required.", 400);
    if (!branchId) throw new AppError("Branch is required.", 400);

    let customerId = toObjectId(payload.customerId);
    let customer = null;

    const isWalkIn =
        payload.walkIn === true ||
        payload.isWalkIn === true ||
        String(payload.customerMode || "").toLowerCase() === "walkin";

    if (isWalkIn || !customerId) {
        const name =
            (payload.customerName || payload.walkInName || "Walk-in Customer")
                .toString()
                .trim() || "Walk-in Customer";
        const phone = (payload.customerPhone || payload.walkInPhone || "")
            .toString()
            .trim();

        if (phone) {
            customer = await Customer.findOne({
                phone,
                isDeleted: false
            });
        }
        if (!customer) {
            const customerCode = await generateCustomerCode();
            customer = await Customer.create({
                name,
                phone,
                customerCode,
                customerId: customerCode,
                customerType: "Retail",
                paymentTerms: "Cash",
                status: "Active",
                isApproved: true,
                approvedAt: new Date(),
                note: "Walk-in / showroom customer"
            });
        }
        customerId = customer._id;
    } else {
        customer = await Customer.findOne({ _id: customerId, isDeleted: false });
        if (!customer) throw new AppError("Customer not found.", 404);
    }

    if (customer.status === "Blocked") {
        throw new AppError("Cannot sell to a blocked customer.", 400);
    }

    const [warehouse, branch] = await Promise.all([
        Warehouse.findOne({ _id: warehouseId, ...NOT_DELETED }),
        Branch.findOne({ _id: branchId, ...NOT_DELETED })
    ]);

    if (!warehouse) throw new AppError("Warehouse not found.", 404);
    if (!branch) throw new AppError("Branch not found.", 404);

    const displayName =
        (payload.customerName || payload.walkInName || customer.name || "")
            .toString()
            .trim() || customer.name;
    const displayPhone =
        (payload.customerPhone || payload.walkInPhone || customer.phone || "")
            .toString()
            .trim() ||
        customer.phone ||
        "";

    return {
        customer: {
            _id: customer._id,
            name: displayName,
            phone: displayPhone,
            email: customer.email || "",
            address: customer.address || ""
        },
        warehouse,
        branch,
        customerId,
        warehouseId,
        branchId
    };
};

const findOrderOrFail = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid sales order id.", 400);
    }
    const order = await SalesOrder.findOne({ _id: id, ...NOT_DELETED });
    if (!order) throw new AppError("Sales order not found.", 404);
    return order;
};

const createSalesOrder = async (payload, actorId = null) => {
    const refs = await resolveHeaderRefs(payload);
    const items = await normalizeItems(payload.items);
    const totals = calculateLines(items, payload);
    const orderNumber = await generateSalesOrderCode();

    const order = await SalesOrder.create({
        branchId: refs.branchId,
        warehouseId: refs.warehouseId,
        orderNumber,
        referenceNumber: (payload.referenceNumber || "").toString().trim(),
        orderDate: payload.orderDate ? new Date(payload.orderDate) : new Date(),
        expectedDeliveryDate: payload.expectedDeliveryDate
            ? new Date(payload.expectedDeliveryDate)
            : undefined,
        customerId: refs.customerId,
        customerName: refs.customer.name,
        customerPhone: refs.customer.phone || "",
        customerEmail: refs.customer.email || "",
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
        paymentMethod: payload.paymentMethod || "Cash",
        deliveryAddress:
            payload.deliveryAddress || refs.customer.address || "",
        customerNote: payload.customerNote || "",
        internalNote: payload.internalNote || "",
        status: "Draft",
        createdBy: actorId || null
    });

    return populateSo(SalesOrder.findById(order._id));
};

const getSalesOrders = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.customerId && toObjectId(query.customerId)) {
        filter.customerId = toObjectId(query.customerId);
    }
    if (query.warehouseId && toObjectId(query.warehouseId)) {
        filter.warehouseId = toObjectId(query.warehouseId);
    }
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }
    if (query.search) {
        const search = query.search.trim();
        filter.$or = [
            { orderNumber: { $regex: escapeRegex(search), $options: "i" } },
            { customerName: { $regex: escapeRegex(search), $options: "i" } },
            { referenceNumber: { $regex: escapeRegex(search), $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        populateSo(
            SalesOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        ),
        SalesOrder.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
};

const getSalesOrderById = async (id) => {
    const order = await populateSo(
        SalesOrder.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!order) throw new AppError("Sales order not found.", 404);
    return order;
};

const updateSalesOrder = async (id, payload, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!EDITABLE_STATUSES.includes(order.status)) {
        throw new AppError(
            `Cannot edit a sales order in "${order.status}" status.`,
            400
        );
    }

    if (payload.customerId || payload.warehouseId || payload.branchId) {
        const refs = await resolveHeaderRefs({
            customerId: payload.customerId || order.customerId,
            warehouseId: payload.warehouseId || order.warehouseId,
            branchId: payload.branchId || order.branchId
        });
        order.customerId = refs.customerId;
        order.warehouseId = refs.warehouseId;
        order.branchId = refs.branchId;
        order.customerName = refs.customer.name;
        order.customerPhone = refs.customer.phone || "";
        order.customerEmail = refs.customer.email || "";
    }

    if (payload.items) {
        const items = await normalizeItems(payload.items);
        const totals = calculateLines(items, {
            discount: payload.discount ?? order.discount,
            discountType: payload.discountType ?? order.discountType,
            tax: payload.tax ?? order.tax,
            taxType: payload.taxType ?? order.taxType,
            shippingCost: payload.shippingCost ?? order.shippingCost,
            shippingType: payload.shippingType ?? order.shippingType,
            otherCharges: payload.otherCharges ?? order.otherCharges,
            paidAmount: payload.paidAmount ?? order.paidAmount
        });
        order.items = totals.items;
        order.subtotal = totals.subtotal;
        order.discount = totals.discount;
        order.discountType = totals.discountType;
        order.tax = totals.tax;
        order.taxType = totals.taxType;
        order.shippingCost = totals.shippingCost;
        order.shippingType = totals.shippingType;
        order.otherCharges = totals.otherCharges;
        order.paidAmount = totals.paidAmount;
        order.grandTotal = totals.grandTotal;
        order.dueAmount = totals.dueAmount;
        order.paymentStatus = totals.paymentStatus;
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
        const totals = calculateLines(order.items, {
            discount: payload.discount ?? order.discount,
            discountType: payload.discountType ?? order.discountType,
            tax: payload.tax ?? order.tax,
            taxType: payload.taxType ?? order.taxType,
            shippingCost: payload.shippingCost ?? order.shippingCost,
            shippingType: payload.shippingType ?? order.shippingType,
            otherCharges: payload.otherCharges ?? order.otherCharges,
            paidAmount: payload.paidAmount ?? order.paidAmount
        });
        order.subtotal = totals.subtotal;
        order.discount = totals.discount;
        order.discountType = totals.discountType;
        order.tax = totals.tax;
        order.taxType = totals.taxType;
        order.shippingCost = totals.shippingCost;
        order.shippingType = totals.shippingType;
        order.otherCharges = totals.otherCharges;
        order.paidAmount = totals.paidAmount;
        order.grandTotal = totals.grandTotal;
        order.dueAmount = totals.dueAmount;
        order.paymentStatus = totals.paymentStatus;
    }

    if (payload.referenceNumber !== undefined) {
        order.referenceNumber = String(payload.referenceNumber || "").trim();
    }
    if (payload.orderDate) order.orderDate = new Date(payload.orderDate);
    if (payload.expectedDeliveryDate) {
        order.expectedDeliveryDate = new Date(payload.expectedDeliveryDate);
    }
    if (payload.paymentMethod) order.paymentMethod = payload.paymentMethod;
    if (payload.deliveryAddress !== undefined) {
        order.deliveryAddress = String(payload.deliveryAddress || "");
    }
    if (payload.customerNote !== undefined) {
        order.customerNote = String(payload.customerNote || "");
    }
    if (payload.internalNote !== undefined) {
        order.internalNote = String(payload.internalNote || "");
    }

    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const deleteSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!EDITABLE_STATUSES.includes(order.status) && order.status !== "Cancelled") {
        throw new AppError(
            `Cannot delete a sales order in "${order.status}" status.`,
            400
        );
    }
    order.isDeleted = true;
    order.deletedAt = new Date();
    order.deletedBy = actorId || null;
    await order.save();
    return order;
};

const submitSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (order.status !== "Draft") {
        throw new AppError("Only Draft orders can be submitted.", 400);
    }
    if (!order.items?.length) {
        throw new AppError("Add at least one line before submit.", 400);
    }
    order.status = "Pending Approval";
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const approveSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (!["Draft", "Pending Approval"].includes(order.status)) {
        throw new AppError(
            `Cannot approve a sales order in "${order.status}" status.`,
            400
        );
    }
    order.status = "Approved";
    order.approvedBy = actorId || null;
    order.approvedAt = new Date();
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const cancelSalesOrder = async (id, actorId = null, reason = "") => {
    const order = await findOrderOrFail(id);
    if (["Completed", "Cancelled"].includes(order.status)) {
        throw new AppError(
            `Cannot cancel a sales order in "${order.status}" status.`,
            400
        );
    }
    if (order.stockUpdated) {
        throw new AppError(
            "Stock already deducted. Cancel is blocked — use Sales Return later.",
            400
        );
    }
    order.status = "Cancelled";
    order.cancelledBy = actorId || null;
    order.cancelledAt = new Date();
    if (order.internalNote) {
        order.internalNote = `${order.internalNote}\nCancel: ${reason || ""}`.trim();
    } else if (reason) {
        order.internalNote = `Cancel: ${reason}`;
    }
    order.updatedBy = actorId || null;
    await order.save();
    return populateSo(SalesOrder.findById(order._id));
};

const findInventoryRow = async ({
    warehouseId,
    productId,
    productVariantId,
    session
}) => {
    const filter = {
        warehouseId,
        productId,
        isDeleted: { $ne: true }
    };
    if (productVariantId) {
        filter.productVariantId = productVariantId;
    } else {
        filter.$or = [
            { productVariantId: null },
            { productVariantId: { $exists: false } }
        ];
    }

    return Inventory.findOne(filter).session(session || null);
};

const deductInventory = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    sku,
    productName,
    qty,
    unitCost,
    salesOrderId,
    actorId,
    orderCreatedBy,
    session
}) => {
    const inv = await findInventoryRow({
        warehouseId,
        productId,
        productVariantId,
        session
    });

    if (!inv) {
        throw new AppError(
            `No inventory for "${productName}" in this warehouse.`,
            400
        );
    }

    const available = Number(inv.availableStock) || 0;
    const current = Number(inv.currentStock) || 0;
    if (available < qty) {
        throw new AppError(
            `Insufficient stock for "${productName}". Available: ${available}, required: ${qty}.`,
            400
        );
    }

    const previous = current;
    inv.currentStock = Math.max(current - qty, 0);
    inv.availableStock = Math.max(available - qty, 0);
    inv.inventoryValue =
        (Number(inv.averageCost) || unitCost || 0) * inv.currentStock;
    inv.lastMovementDate = new Date();
    await inv.save({ session });

    const movementNumber = await generateStockMovementCode();
    const [movement] = await StockMovement.create(
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
                movementType: "Sale",
                movementDirection: "OUT",
                quantity: qty,
                previousStock: previous,
                currentStock: inv.currentStock,
                unitCost: Number(inv.averageCost) || unitCost || 0,
                totalCost:
                    (Number(inv.averageCost) || unitCost || 0) * qty,
                referenceType: "Sales Order",
                salesOrderId,
                remarks: "Stock out from Sales Order confirm",
                createdBy: actorId || orderCreatedBy || new mongoose.Types.ObjectId()
            }
        ],
        { session }
    );

    return { inv, movement };
};

const markImeisSold = async ({
    productId,
    variantId,
    imeis,
    salesOrderId,
    customerPhone,
    warrantyExpiry,
    warrantyType,
    warrantyPeriod,
    session
}) => {
    for (const imei of imeis) {
        const track = await ItemTrack.findOne({
            productId,
            ...(variantId ? { variantId } : {}),
            imei,
            status: "available"
        }).session(session || null);

        if (!track) {
            throw new AppError(
                `IMEI ${imei} is not available in inventory.`,
                400
            );
        }

        track.status = "sold";
        track.saleInfo = {
            ...(track.saleInfo || {}),
            orderId: salesOrderId,
            soldDate: new Date(),
            customerPhone: customerPhone || track.saleInfo?.customerPhone || ""
        };
        if (warrantyExpiry) {
            track.warrantyExpiry = warrantyExpiry;
        } else if (resolveWarrantyType(warrantyType) === "Lifetime") {
            // Far-future sentinel so lookup treats Lifetime as active
            track.warrantyExpiry = new Date("9999-12-31T00:00:00.000Z");
        } else if (resolveWarrantyType(warrantyType) === "No Warranty") {
            track.warrantyExpiry = undefined;
        }
        track.history = track.history || [];
        const periodLabel =
            resolveWarrantyType(warrantyType) === "Lifetime"
                ? "Lifetime"
                : resolveWarrantyType(warrantyType) === "No Warranty"
                  ? "No Warranty"
                  : `${warrantyPeriod || 0} ${warrantyType}`;
        track.history.push({
            status: "sold",
            date: new Date(),
            notes: `Sold via Sales Order • Warranty: ${periodLabel}`
        });
        await track.save({ session });
    }
};

/**
 * Confirm = lock order + deduct warehouse stock (ERP stock OUT).
 * Accepts Draft / Pending Approval / Approved.
 */
const confirmSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);

    if (order.stockUpdated) {
        throw new AppError("Stock already deducted for this order.", 400);
    }
    if (["Completed", "Cancelled"].includes(order.status)) {
        throw new AppError(
            `Cannot confirm a sales order in "${order.status}" status.`,
            400
        );
    }
    if (["Confirmed", "Processing"].includes(order.status) && order.stockUpdated) {
        throw new AppError("Sales order is already confirmed.", 400);
    }
    if (!order.items?.length) {
        throw new AppError("Sales order has no lines.", 400);
    }
    if (!order.warehouseId) {
        throw new AppError("Warehouse is required to confirm sale.", 400);
    }

    await applyStockOut(order, actorId, {
        setStatus: "Confirmed",
        setDeliveryStatus: "Processing"
    });

    try {
        const customer = await Customer.findById(order.customerId);
        if (customer && typeof customer.updateBalance === "function") {
            await customer.updateBalance(order.grandTotal, order.paidAmount || 0);
        }
    } catch (_) {
        /* ignore */
    }

    return populateSo(SalesOrder.findById(order._id));
};

/**
 * Shared stock OUT + IMEI sold. Idempotent via order.stockUpdated.
 */
const applyStockOut = async (
    order,
    actorId = null,
    { setStatus, setDeliveryStatus } = {}
) => {
    if (order.stockUpdated) return order;
    if (!order.items?.length) {
        throw new AppError("Sales order has no lines.", 400);
    }
    if (!order.warehouseId) {
        throw new AppError("Warehouse is required for stock out.", 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    const movementIds = [];
    const productIds = new Set();

    try {
        for (const line of order.items) {
            const qty = Number(line.quantity) || 0;
            if (qty <= 0) continue;

            const trackingType = resolveTrackingType(line.trackingType);

            // Finalize warranty dates at stock OUT (sale start)
            const soldAt = new Date();
            line.warrantyType = resolveWarrantyType(line.warrantyType);
            line.warrantyPeriod = Math.max(Number(line.warrantyPeriod) || 0, 0);
            line.warrantyStartDate = line.warrantyStartDate || soldAt;
            if (
                !line.warrantyEndDate &&
                line.warrantyType !== "No Warranty" &&
                line.warrantyType !== "Lifetime"
            ) {
                line.warrantyEndDate = computeWarrantyEndDate(
                    line.warrantyStartDate,
                    line.warrantyType,
                    line.warrantyPeriod
                );
            }

            if (trackingType === "IMEI") {
                await markImeisSold({
                    productId: line.productId,
                    variantId: line.productVariantId,
                    imeis: line.imeis || [],
                    salesOrderId: order._id,
                    customerPhone: order.customerPhone || "",
                    warrantyExpiry: line.warrantyEndDate || null,
                    warrantyType: line.warrantyType,
                    warrantyPeriod: line.warrantyPeriod,
                    session
                });
            }

            const result = await deductInventory({
                warehouseId: order.warehouseId,
                branchId: order.branchId,
                productId: line.productId,
                productVariantId: line.productVariantId,
                sku: line.sku,
                productName: line.productName,
                qty,
                unitCost: line.unitPrice,
                salesOrderId: order._id,
                actorId,
                orderCreatedBy: order.createdBy,
                session
            });

            if (result.movement?._id) movementIds.push(result.movement._id);
            if (line.productId) productIds.add(String(line.productId));

            line.deliveredQuantity = qty;
            line.pendingQuantity = 0;
        }

        if (setStatus) order.status = setStatus;
        if (setDeliveryStatus) order.deliveryStatus = setDeliveryStatus;
        order.stockUpdated = true;
        order.stockUpdatedAt = new Date();
        order.stockMovementIds = [
            ...(order.stockMovementIds || []),
            ...movementIds
        ];
        order.updatedBy = actorId || null;
        if (!order.approvedAt) {
            order.approvedBy = actorId || null;
            order.approvedAt = new Date();
        }

        order.markModified("items");
        await order.save({ session });
        await session.commitTransaction();
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }

    for (const pid of productIds) {
        try {
            await productService.refreshStockSummary(pid);
        } catch (e) {
            console.warn("[SO] refreshStockSummary failed:", pid, e?.message || e);
        }
    }

    return order;
};

/**
 * Stock OUT when payment is successful (Paid) OR goods are delivered.
 * Showroom one-shot: mark paid + delivered + stock out.
 */
const completeSale = async (id, payload = {}, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (["Cancelled"].includes(order.status)) {
        throw new AppError("Cannot complete a cancelled sales order.", 400);
    }
    if (!order.items?.length) {
        throw new AppError("Sales order has no lines.", 400);
    }

    const method = payload.paymentMethod || order.paymentMethod || "Cash";
    const isCredit = String(method).toLowerCase() === "credit";
    let paidAmount =
        payload.paidAmount !== undefined
            ? Math.max(Number(payload.paidAmount) || 0, 0)
            : Number(order.paidAmount) || 0;

    if (!isCredit && payload.markFullyPaid !== false && paidAmount <= 0) {
        paidAmount = Number(order.grandTotal) || 0;
    }
    if (!isCredit && payload.markFullyPaid === true) {
        paidAmount = Number(order.grandTotal) || 0;
    }

    order.paymentMethod = method;
    order.paidAmount = paidAmount;
    order.dueAmount = Math.max((Number(order.grandTotal) || 0) - paidAmount, 0);
    if (paidAmount <= 0) order.paymentStatus = isCredit ? "Pending" : "Pending";
    else if (paidAmount < (Number(order.grandTotal) || 0)) {
        order.paymentStatus = "Partial";
    } else {
        order.paymentStatus = "Paid";
    }

    const markDelivered = payload.markDelivered !== false;
    if (markDelivered) {
        order.deliveryStatus = "Delivered";
        order.deliveryDate = new Date();
        order.status = "Completed";
    } else if (!["Confirmed", "Processing", "Completed"].includes(order.status)) {
        order.status = "Confirmed";
        order.deliveryStatus = order.deliveryStatus || "Processing";
    }

    const shouldStockOut =
        order.paymentStatus === "Paid" ||
        order.deliveryStatus === "Delivered" ||
        isCredit; // credit: goods leave on complete-sale

    if (shouldStockOut && !order.stockUpdated) {
        await applyStockOut(order, actorId, {
            setStatus: order.status,
            setDeliveryStatus: order.deliveryStatus
        });
    } else {
        order.updatedBy = actorId || null;
        await order.save();
    }

    try {
        const customer = await Customer.findById(order.customerId);
        if (customer && typeof customer.updateBalance === "function") {
            await customer.updateBalance(
                order.grandTotal,
                order.paidAmount || 0
            );
        }
    } catch (_) {
        /* ignore */
    }

    return populateSo(SalesOrder.findById(order._id));
};

const markPaid = async (id, payload = {}, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (order.status === "Cancelled") {
        throw new AppError("Cannot pay a cancelled order.", 400);
    }
    const paidAmount =
        payload.paidAmount !== undefined
            ? Math.max(Number(payload.paidAmount) || 0, 0)
            : Number(order.grandTotal) || 0;
    order.paidAmount = paidAmount;
    order.dueAmount = Math.max((Number(order.grandTotal) || 0) - paidAmount, 0);
    if (payload.paymentMethod) order.paymentMethod = payload.paymentMethod;
    if (paidAmount <= 0) order.paymentStatus = "Pending";
    else if (paidAmount < (Number(order.grandTotal) || 0)) {
        order.paymentStatus = "Partial";
    } else order.paymentStatus = "Paid";

    order.updatedBy = actorId || null;

    if (order.paymentStatus === "Paid" && !order.stockUpdated) {
        await applyStockOut(order, actorId, {
            setStatus: order.status === "Draft" ? "Confirmed" : order.status,
            setDeliveryStatus:
                order.deliveryStatus === "Pending"
                    ? "Processing"
                    : order.deliveryStatus
        });
    } else {
        await order.save();
    }

    return populateSo(SalesOrder.findById(order._id));
};

const deliverSalesOrder = async (id, actorId = null) => {
    const order = await findOrderOrFail(id);
    if (order.status === "Cancelled") {
        throw new AppError("Cannot deliver a cancelled order.", 400);
    }

    order.deliveryStatus = "Delivered";
    order.deliveryDate = new Date();
    order.status = "Completed";
    order.updatedBy = actorId || null;

    if (!order.stockUpdated) {
        await applyStockOut(order, actorId, {
            setStatus: "Completed",
            setDeliveryStatus: "Delivered"
        });
    } else {
        await order.save();
    }

    return populateSo(SalesOrder.findById(order._id));
};

const completeSalesOrder = async (id, actorId = null) => {
    return deliverSalesOrder(id, actorId);
};

const lookupByBarcode = async (barcode, warehouseId = null) => {
    const value = String(barcode || "").trim();
    if (!value) throw new AppError("Barcode is required.", 400);

    let matchedVariant = await ProductVariant.findOne({
        barcode: value,
        isDeleted: { $ne: true }
    });

    let product = null;
    if (matchedVariant) {
        product = await Product.findOne({
            _id: matchedVariant.productId,
            ...NOT_DELETED
        });
    } else {
        product = await Product.findOne({ barcode: value, ...NOT_DELETED });
        if (product) {
            matchedVariant = await ProductVariant.findOne({
                productId: product._id,
                isDeleted: { $ne: true },
                isDefaultVariant: true
            });
            if (!matchedVariant) {
                matchedVariant = await ProductVariant.findOne({
                    productId: product._id,
                    isDeleted: { $ne: true }
                });
            }
        }
    }

    if (!product) throw new AppError("No product found for this barcode.", 404);

    const trackingType = resolveTrackingType(product.trackingType);
    if (trackingType === "IMEI") {
        throw new AppError(
            "This barcode belongs to an IMEI product. Scan IMEI instead.",
            400
        );
    }

    let availableStock = 0;
    if (warehouseId && toObjectId(warehouseId)) {
        const inv = await Inventory.findOne({
            warehouseId: toObjectId(warehouseId),
            productId: product._id,
            ...(matchedVariant
                ? { productVariantId: matchedVariant._id }
                : {}),
            isDeleted: { $ne: true }
        });
        availableStock = Number(inv?.availableStock) || 0;
    }

    return {
        productId: product._id,
        productVariantId: matchedVariant?._id || null,
        productName: product.name,
        sku: matchedVariant?.sku || product.sku || "",
        barcode: value,
        trackingType: "Non-IMEI",
        unitPrice:
            Number(matchedVariant?.sellingPrice) ||
            Number(product.sellingPrice) ||
            0,
        availableStock,
        warrantyType: resolveWarrantyType(product.warrantyType),
        warrantyPeriod: Math.max(Number(product.warrantyPeriod) || 0, 0)
    };
};

const lookupByImei = async (imei, warehouseId = null) => {
    const value = String(imei || "").trim();
    if (!value) throw new AppError("IMEI is required.", 400);

    const track = await ItemTrack.findOne({ imei: value }).populate(
        "productId",
        "name productCode trackingType sellingPrice warrantyType warrantyPeriod"
    );
    if (!track) throw new AppError("IMEI not found.", 404);
    if (track.status !== "available") {
        throw new AppError(
            `IMEI is not available (status: ${track.status}).`,
            400
        );
    }

    const variant = await ProductVariant.findById(track.variantId);
    const product = track.productId;

    return {
        productId: product?._id || track.productId,
        productVariantId: track.variantId,
        productName: product?.name || "",
        sku: variant?.sku || "",
        imei: value,
        trackingType: "IMEI",
        unitPrice:
            Number(variant?.sellingPrice) ||
            Number(product?.sellingPrice) ||
            0,
        status: track.status,
        branchId: track.currentBranchId,
        warrantyType: resolveWarrantyType(product?.warrantyType),
        warrantyPeriod: Math.max(Number(product?.warrantyPeriod) || 0, 0)
    };
};

/**
 * Products / variants available to sell from a branch (and optional warehouse).
 * Only rows with available stock (Inventory) or available IMEIs at the branch.
 */
const getBranchCatalog = async (query = {}) => {
    const branchId = toObjectId(query.branchId);
    if (!branchId) throw new AppError("Branch is required.", 400);

    const warehouseId = toObjectId(query.warehouseId);
    const categoryId = toObjectId(query.categoryId);
    const subCategoryId = toObjectId(query.subCategoryId);
    const brandId = toObjectId(query.brandId);
    const search = String(query.search || "").trim();

    const warehouses = await Warehouse.find({
        ...NOT_DELETED,
        branchIds: branchId,
        ...(warehouseId ? { _id: warehouseId } : {})
    }).select("_id");

    const warehouseIds = warehouses.map((w) => w._id);
    if (warehouseId && !warehouseIds.some((id) => String(id) === String(warehouseId))) {
        warehouseIds.push(warehouseId);
    }

    const invFilter = {
        isDeleted: { $ne: true },
        availableStock: { $gt: 0 }
    };
    if (warehouseId) {
        invFilter.warehouseId = warehouseId;
    } else if (warehouseIds.length) {
        invFilter.$or = [
            { branchId },
            { warehouseId: { $in: warehouseIds } }
        ];
    } else {
        invFilter.branchId = branchId;
    }

    const invRows = await Inventory.find(invFilter)
        .populate(
            "productId",
            "name productCode sku barcode trackingType productType sellingPrice warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId status approvalStatus hasVariants"
        )
        .populate(
            "productVariantId",
            "sku combinationString sellingPrice attributes barcode status isDeleted"
        )
        .lean();

    // IMEI available counts at this branch
    const imeiRows = await ItemTrack.aggregate([
        {
            $match: {
                status: "available",
                currentBranchId: branchId
            }
        },
        {
            $group: {
                _id: {
                    productId: "$productId",
                    variantId: "$variantId"
                },
                count: { $sum: 1 }
            }
        }
    ]);
    const imeiMap = new Map(
        imeiRows.map((r) => [
            `${r._id.productId}::${r._id.variantId || "null"}`,
            r.count
        ])
    );

    const byProduct = new Map();

    const ensureProduct = (product) => {
        if (!product || !product._id) return null;
        if (product.status && product.status !== "Active") return null;
        if (
            product.approvalStatus &&
            product.approvalStatus !== "Approved" &&
            product.approvalStatus !== ""
        ) {
            return null;
        }
        if (categoryId && String(product.proCategoryId) !== String(categoryId)) {
            return null;
        }
        if (
            subCategoryId &&
            String(product.proSubCategoryId) !== String(subCategoryId)
        ) {
            return null;
        }
        if (brandId && String(product.proBrandId) !== String(brandId)) {
            return null;
        }
        if (search) {
            const s = search.toLowerCase();
            const hay = `${product.name || ""} ${product.productCode || ""} ${product.sku || ""} ${product.barcode || ""}`.toLowerCase();
            if (!hay.includes(s)) return null;
        }

        const pid = String(product._id);
        if (!byProduct.has(pid)) {
            byProduct.set(pid, {
                productId: product._id,
                productCode: product.productCode || "",
                name: product.name || "",
                trackingType: resolveTrackingType(product.trackingType),
                productType: product.productType || "Simple",
                hasVariants: !!product.hasVariants,
                sellingPrice: Number(product.sellingPrice) || 0,
                warrantyType: resolveWarrantyType(product.warrantyType),
                warrantyPeriod: Math.max(Number(product.warrantyPeriod) || 0, 0),
                categoryId: product.proCategoryId || null,
                subCategoryId: product.proSubCategoryId || null,
                brandId: product.proBrandId || null,
                availableStock: 0,
                variants: []
            });
        }
        return byProduct.get(pid);
    };

    for (const row of invRows) {
        const product = row.productId;
        const entry = ensureProduct(product);
        if (!entry) continue;

        const qty = Number(row.availableStock) || 0;
        entry.availableStock += qty;

        const variant = row.productVariantId;
        if (variant && variant._id && variant.isDeleted !== true) {
            const vid = String(variant._id);
            let vEntry = entry.variants.find((v) => String(v.variantId) === vid);
            if (!vEntry) {
                vEntry = {
                    variantId: variant._id,
                    sku: variant.sku || "",
                    label: variant.combinationString || variant.sku || "Variant",
                    sellingPrice:
                        Number(variant.sellingPrice) ||
                        entry.sellingPrice ||
                        0,
                    barcode: variant.barcode || "",
                    availableStock: 0,
                    imeiAvailable: 0
                };
                entry.variants.push(vEntry);
            }
            vEntry.availableStock += qty;
        }
    }

    // Merge IMEI availability (even if inventory qty is 0 for some setups)
    for (const [key, count] of imeiMap.entries()) {
        const [pid, vid] = key.split("::");
        let entry = byProduct.get(pid);
        if (!entry) {
            const product = await Product.findOne({
                _id: pid,
                ...NOT_DELETED
            }).lean();
            entry = ensureProduct(product);
            if (!entry) continue;
        }
        entry.availableStock += count;
        if (vid && vid !== "null") {
            let vEntry = entry.variants.find((v) => String(v.variantId) === vid);
            if (!vEntry) {
                const variant = await ProductVariant.findOne({
                    _id: vid,
                    isDeleted: { $ne: true }
                }).lean();
                if (!variant) continue;
                vEntry = {
                    variantId: variant._id,
                    sku: variant.sku || "",
                    label: variant.combinationString || variant.sku || "Variant",
                    sellingPrice:
                        Number(variant.sellingPrice) ||
                        entry.sellingPrice ||
                        0,
                    barcode: variant.barcode || "",
                    availableStock: 0,
                    imeiAvailable: 0
                };
                entry.variants.push(vEntry);
            }
            vEntry.imeiAvailable = count;
            vEntry.availableStock = Math.max(vEntry.availableStock, count);
        }
    }

    // Keep only products that still have sellable stock after filters
    const items = [...byProduct.values()]
        .map((p) => {
            if (p.trackingType === "IMEI") {
                p.variants = p.variants.filter(
                    (v) => (v.imeiAvailable || v.availableStock) > 0
                );
            } else {
                p.variants = p.variants.filter((v) => v.availableStock > 0);
            }
            // Variant products must have at least one in-stock variant
            if (
                (p.hasVariants || p.productType === "Variant") &&
                p.variants.length === 0
            ) {
                return null;
            }
            if (p.availableStock <= 0 && p.variants.length === 0) return null;
            return p;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

    return { items, total: items.length };
};

const getSalesOrderStats = async () => {
    const [rows] = await SalesOrder.aggregate([
        { $match: NOT_DELETED },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                draft: {
                    $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] }
                },
                pending: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "Pending Approval"] }, 1, 0]
                    }
                },
                approved: {
                    $sum: { $cond: [{ $eq: ["$status", "Approved"] }, 1, 0] }
                },
                confirmed: {
                    $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] }
                },
                completed: {
                    $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] }
                },
                cancelled: {
                    $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] }
                },
                salesValue: { $sum: "$grandTotal" },
                dueAmount: { $sum: "$dueAmount" }
            }
        }
    ]);

    return (
        rows || {
            total: 0,
            draft: 0,
            pending: 0,
            approved: 0,
            confirmed: 0,
            completed: 0,
            cancelled: 0,
            salesValue: 0,
            dueAmount: 0
        }
    );
};

module.exports = {
    createSalesOrder,
    getSalesOrders,
    getSalesOrderById,
    updateSalesOrder,
    deleteSalesOrder,
    submitSalesOrder,
    approveSalesOrder,
    confirmSalesOrder,
    completeSalesOrder,
    completeSale,
    markPaid,
    deliverSalesOrder,
    cancelSalesOrder,
    getSalesOrderStats,
    lookupByBarcode,
    lookupByImei,
    getBranchCatalog
};
