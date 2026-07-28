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
 * Branch sales catalog: all Active/Approved products (optional preferred branchIds).
 * Branch stock is annotated (can be 0) so SO can sell products without prior stock.
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
    if (
        warehouseId &&
        !warehouseIds.some((id) => String(id) === String(warehouseId))
    ) {
        warehouseIds.push(warehouseId);
    }

    const invFilter = { isDeleted: { $ne: true } };
    if (warehouseId) {
        invFilter.warehouseId = warehouseId;
    } else if (warehouseIds.length) {
        invFilter.$or = [{ branchId }, { warehouseId: { $in: warehouseIds } }];
    } else {
        invFilter.branchId = branchId;
    }

    const productFilter = {
        ...NOT_DELETED,
        status: "Active",
        $or: [
            { approvalStatus: "Approved" },
            { approvalStatus: { $exists: false } },
            { approvalStatus: "" },
            { approvalStatus: null }
        ]
    };
    if (categoryId) productFilter.proCategoryId = categoryId;
    if (subCategoryId) productFilter.proSubCategoryId = subCategoryId;
    if (brandId) productFilter.proBrandId = brandId;
    if (search) {
        productFilter.$and = [
            {
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { productCode: { $regex: search, $options: "i" } },
                    { sku: { $regex: search, $options: "i" } },
                    { barcode: { $regex: search, $options: "i" } }
                ]
            }
        ];
    }

    const products = await Product.find(productFilter)
        .select(
            "name productCode sku barcode trackingType productType sellingPrice offerPrice discountType discountValue salesTaxType salesTaxValue taxType taxPercentage warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId status approvalStatus hasVariants branchIds"
        )
        .lean();

    const productIds = products.map((p) => p._id);
    const resolveChargeType = (value, fallback = "Fixed") => {
        const v = String(value || "").toLowerCase();
        if (v === "percentage") return "Percentage";
        if (v === "fixed") return "Fixed";
        return fallback;
    };

    const [invRows, variantDocs, imeiRows] = await Promise.all([
        productIds.length
            ? Inventory.find({
                  ...invFilter,
                  productId: { $in: productIds }
              })
                  .populate(
                      "productVariantId",
                      "sku combinationString sellingPrice offerPrice attributes barcode status isDeleted"
                  )
                  .lean()
            : Promise.resolve([]),
        productIds.length
            ? ProductVariant.find({
                  productId: { $in: productIds },
                  isDeleted: { $ne: true }
              })
                  .select(
                      "productId sku combinationString sellingPrice offerPrice barcode attributes status"
                  )
                  .lean()
            : Promise.resolve([]),
        ItemTrack.aggregate([
            {
                $match: {
                    status: "available",
                    currentBranchId: branchId,
                    ...(productIds.length
                        ? { productId: { $in: productIds } }
                        : { productId: { $in: [] } })
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
        ])
    ]);

    const imeiMap = new Map(
        imeiRows.map((r) => [
            `${r._id.productId}::${r._id.variantId || "null"}`,
            r.count
        ])
    );

    const byProduct = new Map();

    for (const product of products) {
        const preferred = Array.isArray(product.branchIds)
            ? product.branchIds.map((id) => String(id))
            : [];
        if (preferred.length && !preferred.includes(String(branchId))) {
            continue;
        }

        byProduct.set(String(product._id), {
            productId: product._id,
            productCode: product.productCode || "",
            name: product.name || "",
            trackingType: resolveTrackingType(product.trackingType),
            productType: product.productType || "Simple",
            hasVariants: !!product.hasVariants,
            sellingPrice: Number(product.sellingPrice) || 0,
            offerPrice: Number(product.offerPrice) || 0,
            discountType: resolveChargeType(product.discountType, "Fixed"),
            discountValue: Number(product.discountValue) || 0,
            salesTaxType: resolveChargeType(
                product.salesTaxType,
                Number(product.taxPercentage) > 0 ? "Percentage" : "Fixed"
            ),
            salesTaxValue:
                Number(product.salesTaxValue) ||
                Number(product.taxPercentage) ||
                0,
            taxType: product.taxType || "No Tax",
            taxPercentage: Number(product.taxPercentage) || 0,
            warrantyType: resolveWarrantyType(product.warrantyType),
            warrantyPeriod: Math.max(Number(product.warrantyPeriod) || 0, 0),
            categoryId: product.proCategoryId || null,
            subCategoryId: product.proSubCategoryId || null,
            brandId: product.proBrandId || null,
            availableStock: 0,
            variants: []
        });
    }

    for (const variant of variantDocs) {
        const entry = byProduct.get(String(variant.productId));
        if (!entry) continue;
        const vid = String(variant._id);
        if (entry.variants.some((v) => String(v.variantId) === vid)) continue;
        entry.variants.push({
            variantId: variant._id,
            sku: variant.sku || "",
            label: variant.combinationString || variant.sku || "Variant",
            sellingPrice:
                Number(variant.sellingPrice) || entry.sellingPrice || 0,
            offerPrice: Number(variant.offerPrice) || 0,
            barcode: variant.barcode || "",
            availableStock: 0,
            imeiAvailable: 0
        });
        if (entry.variants.length > 1 || (variant.attributes || []).length) {
            entry.hasVariants = true;
            entry.productType = "Variant";
        }
    }

    for (const row of invRows) {
        const pid = String(row.productId?._id || row.productId || "");
        const entry = byProduct.get(pid);
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
                    offerPrice: Number(variant.offerPrice) || 0,
                    barcode: variant.barcode || "",
                    availableStock: 0,
                    imeiAvailable: 0
                };
                entry.variants.push(vEntry);
            }
            vEntry.availableStock += qty;
        }
    }

    for (const [key, count] of imeiMap.entries()) {
        const [pid, vid] = key.split("::");
        const entry = byProduct.get(pid);
        if (!entry) continue;
        entry.availableStock += count;
        if (vid && vid !== "null") {
            let vEntry = entry.variants.find((v) => String(v.variantId) === vid);
            if (!vEntry) {
                const variant = variantDocs.find((v) => String(v._id) === vid);
                if (!variant) continue;
                vEntry = {
                    variantId: variant._id,
                    sku: variant.sku || "",
                    label: variant.combinationString || variant.sku || "Variant",
                    sellingPrice:
                        Number(variant.sellingPrice) ||
                        entry.sellingPrice ||
                        0,
                    offerPrice: Number(variant.offerPrice) || 0,
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

    const items = [...byProduct.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
    );

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
