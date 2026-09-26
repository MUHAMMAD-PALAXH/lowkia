const mongoose = require("mongoose");
const Product = require("../../model/product");
const ProductVariant = require("../../model/productVariant");
const Company = require("../../model/company");
const Inventory = require("../../model/inventory");
const AppError = require("../../utils/appError");

const SELLABLE_COMPANY_STATUSES = ["Active", "Trial"];

/** Strict gate for cart / checkout — only live sellable catalog rows. */
const MARKETPLACE_PRODUCT_QUERY = {
    isDeleted: { $ne: true },
    isPublished: true,
    status: "Active",
    $and: [
        {
            $or: [
                { approvalStatus: "Approved" },
                { approvalStatus: { $exists: false } },
                { approvalStatus: null },
            ],
        },
        {
            $or: [
                { visibility: "Public" },
                { visibility: { $exists: false } },
                { visibility: null },
            ],
        },
    ],
};

/**
 * Browse/preview catalog for website + mobile apps.
 * Shows Draft / unpublished / pending products so tenants can preview
 * everything except trash (Archived / deleted).
 */
const MARKETPLACE_CATALOG_QUERY = {
    isDeleted: { $ne: true },
    status: { $nin: ["Archived"] },
};

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const buildLineKey = (productId, variantId = null) =>
    `${productId}:${variantId || "base"}`;

const pickImageUrl = (images = []) => {
    if (!Array.isArray(images) || !images.length) return "";
    const primary = images.find((img) => img?.isPrimary);
    return primary?.url || images[0]?.url || "";
};

const resolveUnitPrice = (doc) => {
    const offer = Number(doc?.offerPrice) || 0;
    const selling = Number(doc?.sellingPrice) || 0;
    return offer > 0 ? offer : selling;
};

const buildSellerSnapshot = (company) => ({
    companyId: company._id,
    companyCode: company.companyCode || "",
    legalName: company.legalName || "",
    tradeName: company.tradeName || company.legalName || "",
    logoUrl: company.logoUrl || "",
});

const assertSellableCompany = (company) => {
    if (!company || company.isDeleted) {
        throw new AppError("Seller is not available.", 404);
    }
    if (!SELLABLE_COMPANY_STATUSES.includes(company.status)) {
        throw new AppError("Seller is not accepting orders.", 400);
    }
};

const getAvailableStock = async (product, variant = null) => {
    const companyId = product.companyId;
    const baseMatch = {
        productId: product._id,
        isDeleted: { $ne: true },
        $and: [
            {
                // Include legacy inventory rows missing companyId (Admin stock does too).
                $or: [
                    ...(companyId ? [{ companyId }] : []),
                    { companyId: null },
                    { companyId: { $exists: false } },
                ],
            },
        ],
    };

    const sumInventory = async (extraAnd = null) => {
        const match = {
            ...baseMatch,
            $and: [
                ...baseMatch.$and,
                ...(extraAnd ? [extraAnd] : []),
            ],
        };
        const [agg] = await Inventory.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    available: {
                        $sum: {
                            $max: [
                                { $ifNull: ["$availableStock", 0] },
                                {
                                    $max: [
                                        {
                                            $subtract: [
                                                { $ifNull: ["$currentStock", 0] },
                                                { $ifNull: ["$reservedStock", 0] },
                                            ],
                                        },
                                        0,
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        ]);
        return Number(agg?.available) || 0;
    };

    if (variant?._id) {
        const exact = await sumInventory({ productVariantId: variant._id });
        if (exact > 0) return exact;
        // Legacy simple stock under null variant while product has a Default id.
        const unscoped = await sumInventory({
            $or: [
                { productVariantId: null },
                { productVariantId: { $exists: false } },
            ],
        });
        if (unscoped > 0) return unscoped;
        return sumInventory();
    }

    const fromInventory = await sumInventory({
        $or: [
            { productVariantId: null },
            { productVariantId: { $exists: false } },
        ],
    });
    if (fromInventory > 0) return fromInventory;

    // Legacy rows may still store stock against orphan variant ids on
    // simple products — include them only when unscoped stock is empty.
    const anyStock = await sumInventory();
    if (anyStock > 0) return anyStock;

    return Math.max(Number(product.availableStock) || 0, 0);
};

const evaluateAvailability = (product, availableStock, requestedQty = 1) => {
    if (availableStock <= 0 && !product.allowBackorder) {
        return { isAvailable: false, reason: "Out of stock" };
    }
    if (availableStock > 0 && requestedQty > availableStock && !product.allowBackorder) {
        return {
            isAvailable: false,
            reason: `Only ${availableStock} left in stock`,
        };
    }
    return { isAvailable: true, reason: "" };
};

/** Batch available stock keyed by productVariantId string. */
const sumAvailableByVariantIds = async (variantIds = []) => {
    const ids = [...new Set(variantIds.map(toObjectId).filter(Boolean))];
    if (!ids.length) return new Map();

    const rows = await Inventory.aggregate([
        {
            $match: {
                productVariantId: { $in: ids },
                isDeleted: { $ne: true },
            },
        },
        {
            $group: {
                _id: "$productVariantId",
                available: { $sum: "$availableStock" },
            },
        },
    ]);

    return new Map(
        rows.map((row) => [String(row._id), Number(row.available) || 0])
    );
};

/**
 * Choose an Active variant that can fulfill [quantity].
 * Prefers [preferredVariantId] when it has stock; otherwise any in-stock
 * option (default first). Used so one-click add still works when the
 * catalog default is sold out but another option remains.
 *
 * When [allowFallback] is false, never swap to a different variant — used for
 * cart refresh/update so existing lines do not silently change identity.
 */
const pickSellableVariant = async ({
    product,
    preferredVariantId = null,
    quantity = 1,
    allowFallback = true,
}) => {
    const pid = product._id;
    const variantScope = {
        productId: pid,
        isDeleted: { $ne: true },
        status: "Active",
        $or: [
            { companyId: product.companyId },
            { companyId: null },
            { companyId: { $exists: false } },
        ],
    };

    const preferredOid = toObjectId(preferredVariantId);

    if (preferredOid && !allowFallback) {
        return ProductVariant.findOne({
            ...variantScope,
            _id: preferredOid,
        }).lean();
    }

    const variants = await ProductVariant.find(variantScope)
        .sort({ isDefaultVariant: -1, createdAt: 1 })
        .lean();

    if (!variants.length) return null;

    const preferredId = preferredOid ? String(preferredOid) : null;

    const stockByVariant = await sumAvailableByVariantIds(
        variants.map((v) => v._id)
    );
    const qty = Math.max(Number(quantity) || 1, 1);
    const allowBackorder = Boolean(product.allowBackorder);

    const hasStock = (variant) => {
        const available = stockByVariant.get(String(variant._id)) || 0;
        return available >= qty || allowBackorder;
    };

    if (preferredId) {
        const preferred = variants.find((v) => String(v._id) === preferredId);
        if (preferred && hasStock(preferred)) return preferred;
        if (preferred && !allowFallback) return preferred;
    }

    if (!allowFallback) {
        return preferredId
            ? variants.find((v) => String(v._id) === preferredId) || null
            : null;
    }

    const inStock = variants.find((v) => hasStock(v));
    if (inStock) return inStock;

    if (preferredId) {
        return (
            variants.find((v) => String(v._id) === preferredId) || variants[0]
        );
    }
    return variants[0];
};

/**
 * Resolve a marketplace product line for cart writes.
 * companyId and seller are always derived server-side.
 *
 * @param {boolean} [allowVariantFallback=true] When false, keep the exact
 *   productVariantId (no auto-pick / swap). Cart add/refresh/qty update all
 *   pass false so stock issues surface instead of silently changing the line.
 */
const resolveMarketplaceLine = async ({
    productId,
    productVariantId = null,
    quantity = 1,
    allowVariantFallback = true,
}) => {
    const pid = toObjectId(productId);
    if (!pid) throw new AppError("Invalid productId.", 400);

    // Match catalog browseability: anything visible in the storefront must be
    // purchasable. Strict publish/approval gates blocked Active-looking stock
    // rows that still appear in MARKETPLACE_CATALOG_QUERY.
    const product = await Product.findOne({
        _id: pid,
        ...MARKETPLACE_CATALOG_QUERY,
    }).lean();

    if (!product) {
        throw new AppError("Product is not available for purchase.", 404);
    }

    if (!product.companyId) {
        throw new AppError("Product seller could not be determined.", 400);
    }

    const company = await Company.findOne({
        _id: product.companyId,
        isDeleted: { $ne: true },
    }).lean();

    assertSellableCompany(company);

    let variant = null;
    const variantId = toObjectId(productVariantId);

    if (product.hasVariants) {
        variant = await pickSellableVariant({
            product,
            preferredVariantId: variantId,
            quantity,
            allowFallback: allowVariantFallback || !variantId,
        });

        if (!variant) {
            throw new AppError(
                variantId
                    ? "Product variant is not available."
                    : "Product variant is required.",
                variantId ? 404 : 400
            );
        }
    } else {
        // Non-variant products must not carry a variant id. Ignore stale client
        // payloads instead of failing with "does not use variants".
        variant = null;
    }

    const availableStock = await getAvailableStock(product, variant);
    const availability = evaluateAvailability(product, availableStock, quantity);
    const unitPrice = variant
        ? resolveUnitPrice(variant)
        : resolveUnitPrice(product);

    const imageUrl = variant
        ? pickImageUrl(variant.images) || pickImageUrl(product.images)
        : pickImageUrl(product.images);

    const productSnapshot = {
        productId: product._id,
        productVariantId: variant?._id || null,
        productCode: product.productCode || "",
        productName: product.name,
        variantLabel: variant?.combinationString || "",
        sku: variant?.sku || product.sku || "",
        imageUrl,
        unitPrice,
        currency: company.defaultCurrency || "BDT",
    };

    return {
        companyId: product.companyId,
        seller: buildSellerSnapshot(company),
        product: productSnapshot,
        lineKey: buildLineKey(product._id, variant?._id),
        availableStock,
        isAvailable: availability.isAvailable,
        unavailableReason: availability.reason,
        allowBackorder: Boolean(product.allowBackorder),
    };
};

const loadSellerSnapshots = async (companyIds = []) => {
    const ids = [...new Set(companyIds.map((id) => String(id)))].filter(Boolean);
    if (!ids.length) return new Map();

    const companies = await Company.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
    }).lean();

    return new Map(
        companies.map((company) => [String(company._id), buildSellerSnapshot(company)])
    );
};

module.exports = {
    MARKETPLACE_PRODUCT_QUERY,
    MARKETPLACE_CATALOG_QUERY,
    SELLABLE_COMPANY_STATUSES,
    toObjectId,
    buildLineKey,
    pickImageUrl,
    resolveUnitPrice,
    buildSellerSnapshot,
    getAvailableStock,
    sumAvailableByVariantIds,
    pickSellableVariant,
    evaluateAvailability,
    resolveMarketplaceLine,
    loadSellerSnapshots,
    assertSellableCompany,
};
