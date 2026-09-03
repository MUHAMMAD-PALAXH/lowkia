const mongoose = require("mongoose");
const Product = require("../../model/product");
const ProductVariant = require("../../model/productVariant");
const Company = require("../../model/company");
const Inventory = require("../../model/inventory");
const AppError = require("../../utils/appError");

const SELLABLE_COMPANY_STATUSES = ["Active", "Trial"];

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
    const match = {
        productId: product._id,
        companyId: product.companyId,
        isDeleted: { $ne: true },
    };

    if (variant?._id) {
        match.productVariantId = variant._id;
    }

    const [agg] = await Inventory.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                available: { $sum: "$availableStock" },
            },
        },
    ]);

    const fromInventory = Number(agg?.available) || 0;
    if (fromInventory > 0) return fromInventory;

    if (variant) {
        return Math.max(Number(variant.quantity) || 0, 0);
    }

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

/**
 * Resolve a marketplace product line for cart writes.
 * companyId and seller are always derived server-side.
 */
const resolveMarketplaceLine = async ({
    productId,
    productVariantId = null,
    quantity = 1,
}) => {
    const pid = toObjectId(productId);
    if (!pid) throw new AppError("Invalid productId.", 400);

    const product = await Product.findOne({
        _id: pid,
        ...MARKETPLACE_PRODUCT_QUERY,
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
        if (!variantId) {
            throw new AppError("Product variant is required.", 400);
        }

        variant = await ProductVariant.findOne({
            _id: variantId,
            productId: pid,
            companyId: product.companyId,
            isDeleted: false,
            status: "Active",
        }).lean();

        if (!variant) {
            throw new AppError("Product variant is not available.", 404);
        }
    } else if (variantId) {
        throw new AppError("This product does not use variants.", 400);
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
        status: { $in: SELLABLE_COMPANY_STATUSES },
    }).lean();

    return new Map(
        companies.map((company) => [String(company._id), buildSellerSnapshot(company)])
    );
};

module.exports = {
    MARKETPLACE_PRODUCT_QUERY,
    SELLABLE_COMPANY_STATUSES,
    toObjectId,
    buildLineKey,
    pickImageUrl,
    resolveUnitPrice,
    buildSellerSnapshot,
    getAvailableStock,
    evaluateAvailability,
    resolveMarketplaceLine,
    loadSellerSnapshots,
};
