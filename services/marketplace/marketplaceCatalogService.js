const Category = require("../../model/category");
const SubCategory = require("../../model/subCategory");
const Brand = require("../../model/brand");
const Product = require("../../model/product");
const ProductVariant = require("../../model/productVariant");
const VariantType = require("../../model/variantType");
const Variant = require("../../model/variant");
const Company = require("../../model/company");
const Poster = require("../../model/poster");
const Review = require("../../model/review");
const AppError = require("../../utils/appError");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");
const {
    MARKETPLACE_CATALOG_QUERY,
    toObjectId,
    pickImageUrl,
    resolveUnitPrice,
    buildSellerSnapshot,
    getAvailableStock,
} = require("./marketplaceProductService");

/** Companies whose products may appear in browse/preview catalog. */
const catalogCompanyFilter = {
    isDeleted: { $ne: true },
};

const formatCatalogProduct = (product, seller, availableStock = null, ratingStats = null) => ({
    id: product._id,
    productCode: product.productCode,
    name: product.name,
    description: product.description || "",
    sellingPrice: resolveUnitPrice(product),
    offerPrice:
        product.offerPrice != null && Number(product.offerPrice) > 0
            ? Number(product.offerPrice)
            : null,
    imageUrl: pickImageUrl(product.images),
    images: Array.isArray(product.images)
        ? product.images
              .filter((img) => img && img.url)
              .map((img) => ({
                  url: img.url,
                  isPrimary: Boolean(img.isPrimary),
                  _id: img._id || undefined,
              }))
        : [],
    hasVariants: Boolean(product.hasVariants),
    availableStock:
        availableStock !== null
            ? availableStock
            : Math.max(Number(product.availableStock) || 0, 0),
    isFeatured: Boolean(product.isFeatured),
    isNewArrival: Boolean(product.isNewArrival),
    isBestSeller: Boolean(product.isBestSeller),
    averageRating: ratingStats?.averageRating ?? 0,
    reviewCount: ratingStats?.reviewCount ?? 0,
    proCategoryId: product.proCategoryId || null,
    proSubCategoryId: product.proSubCategoryId || null,
    proBrandId: product.proBrandId || null,
    seller,
});

const getRatingStatsMap = async (productIds = []) => {
    if (!productIds.length) return new Map();
    const rows = await Review.aggregate([
        { $match: { productId: { $in: productIds } } },
        {
            $group: {
                _id: "$productId",
                averageRating: { $avg: "$rating" },
                reviewCount: { $sum: 1 },
            },
        },
    ]);
    return new Map(
        rows.map((row) => [
            String(row._id),
            {
                averageRating: Math.round((Number(row.averageRating) || 0) * 10) / 10,
                reviewCount: Number(row.reviewCount) || 0,
            },
        ])
    );
};

const truthyFlag = (value) =>
    value === true || value === "true" || value === "1" || value === 1;

const applyIdIntersection = (filter, ids) => {
    const next = (ids || []).filter(Boolean);
    if (!next.length) {
        filter._id = { $in: [] };
        return;
    }
    if (filter._id && filter._id.$in) {
        const allow = new Set(next.map(String));
        filter._id = {
            $in: filter._id.$in.filter((id) => allow.has(String(id))),
        };
        return;
    }
    filter._id = { $in: next };
};

/**
 * Parse attrs query: "typeId:varId1,varId2;typeId2:varId3"
 * Within a type = OR; across types = AND.
 */
const parseAttrsQuery = (raw) => {
    if (!raw || typeof raw !== "string") return [];
    return raw
        .split(";")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const [typePart, valuesPart] = chunk.split(":");
            const typeId = toObjectId((typePart || "").trim());
            const variantIds = String(valuesPart || "")
                .split(",")
                .map((v) => toObjectId(v.trim()))
                .filter(Boolean);
            return typeId && variantIds.length
                ? { typeId, variantIds }
                : null;
        })
        .filter(Boolean);
};

const productIdsForAttrGroups = async (groups) => {
    if (!groups.length) return null;
    let intersection = null;
    for (const group of groups) {
        const ids = await ProductVariant.distinct("productId", {
            isDeleted: { $ne: true },
            status: { $nin: ["Archived"] },
            "attributes.variantTypeId": group.typeId,
            "attributes.variantId": { $in: group.variantIds },
        });
        const asStrings = ids.map(String);
        if (intersection === null) {
            intersection = new Set(asStrings);
        } else {
            intersection = new Set(
                asStrings.filter((id) => intersection.has(id))
            );
        }
        if (intersection.size === 0) return [];
    }
    return [...intersection].map((id) => toObjectId(id)).filter(Boolean);
};

const productIdsWithMinRating = async (minRating) => {
    const rows = await Review.aggregate([
        {
            $group: {
                _id: "$productId",
                averageRating: { $avg: "$rating" },
                reviewCount: { $sum: 1 },
            },
        },
        {
            $match: {
                averageRating: { $gte: minRating },
                reviewCount: { $gte: 1 },
            },
        },
    ]);
    return rows.map((r) => r._id);
};

const listProducts = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "catalog",
    });

    const filter = {
        ...MARKETPLACE_CATALOG_QUERY,
    };

    if (query.search) {
        const term = String(query.search).trim();
        filter.$or = [
            { name: { $regex: term, $options: "i" } },
            { productCode: { $regex: term, $options: "i" } },
            { sku: { $regex: term, $options: "i" } },
        ];
    }

    if (query.companyId) {
        const cid = toObjectId(query.companyId);
        if (!cid) {
            return {
                data: [],
                pagination: buildPagination(0),
            };
        }
        filter.companyId = cid;
    }

    if (query.proCategoryId) filter.proCategoryId = toObjectId(query.proCategoryId);
    if (query.proSubCategoryId) {
        filter.proSubCategoryId = toObjectId(query.proSubCategoryId);
    }
    if (query.proBrandId) filter.proBrandId = toObjectId(query.proBrandId);

    if (query.minPrice || query.maxPrice) {
        filter.sellingPrice = {};
        if (query.minPrice) filter.sellingPrice.$gte = Number(query.minPrice);
        if (query.maxPrice) filter.sellingPrice.$lte = Number(query.maxPrice);
    }

    if (truthyFlag(query.hasDiscount)) {
        filter.$expr = {
            $and: [
                { $gt: [{ $ifNull: ["$offerPrice", 0] }, 0] },
                { $lt: ["$offerPrice", "$sellingPrice"] },
            ],
        };
    }

    const availability = String(query.availability || "all");
    if (availability === "in_stock") {
        filter.availableStock = { $gt: 0 };
    } else if (availability === "out_of_stock") {
        filter.availableStock = { $lte: 0 };
    }

    const attrGroups = parseAttrsQuery(query.attrs);
    if (attrGroups.length) {
        const matched = await productIdsForAttrGroups(attrGroups);
        applyIdIntersection(filter, matched || []);
    }

    if (query.minRating != null && query.minRating !== "") {
        const minRating = Number(query.minRating);
        if (!Number.isNaN(minRating) && minRating > 0) {
            const ratedIds = await productIdsWithMinRating(minRating);
            applyIdIntersection(filter, ratedIds);
        }
    }

    const sortKey = String(query.sortBy || "createdAt");
    const sortOrder = query.order === "asc" ? 1 : -1;

    let products;
    let total;

    if (sortKey === "rating" || sortKey === "discount") {
        const pipeline = [
            { $match: filter },
            {
                $lookup: {
                    from: Review.collection.name,
                    localField: "_id",
                    foreignField: "productId",
                    as: "_reviews",
                },
            },
            {
                $addFields: {
                    _averageRating: {
                        $cond: [
                            { $gt: [{ $size: "$_reviews" }, 0] },
                            { $avg: "$_reviews.rating" },
                            0,
                        ],
                    },
                    _discountPct: {
                        $cond: [
                            {
                                $and: [
                                    { $gt: [{ $ifNull: ["$offerPrice", 0] }, 0] },
                                    { $gt: ["$sellingPrice", 0] },
                                    { $lt: ["$offerPrice", "$sellingPrice"] },
                                ],
                            },
                            {
                                $multiply: [
                                    {
                                        $divide: [
                                            {
                                                $subtract: [
                                                    "$sellingPrice",
                                                    "$offerPrice",
                                                ],
                                            },
                                            "$sellingPrice",
                                        ],
                                    },
                                    100,
                                ],
                            },
                            0,
                        ],
                    },
                },
            },
            {
                $sort: {
                    [sortKey === "rating" ? "_averageRating" : "_discountPct"]:
                        sortOrder,
                    createdAt: -1,
                },
            },
            {
                $facet: {
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                companyId: 1,
                                productCode: 1,
                                name: 1,
                                description: 1,
                                sellingPrice: 1,
                                offerPrice: 1,
                                images: 1,
                                hasVariants: 1,
                                availableStock: 1,
                                isFeatured: 1,
                                isNewArrival: 1,
                                isBestSeller: 1,
                                proCategoryId: 1,
                                proSubCategoryId: 1,
                                proBrandId: 1,
                                createdAt: 1,
                            },
                        },
                    ],
                    total: [{ $count: "count" }],
                },
            },
        ];

        const [facet] = await Product.aggregate(pipeline);
        products = facet?.data || [];
        total = facet?.total?.[0]?.count || 0;
    } else {
        const mongoSortField =
            sortKey === "price"
                ? "sellingPrice"
                : sortKey === "name"
                  ? "name"
                  : "createdAt";

        [products, total] = await Promise.all([
            Product.find(filter)
                .sort({ [mongoSortField]: sortOrder })
                .skip(skip)
                .limit(limit)
                .select(
                    "companyId productCode name description sellingPrice offerPrice images hasVariants availableStock isFeatured isNewArrival isBestSeller proCategoryId proSubCategoryId proBrandId createdAt"
                )
                .lean(),
            Product.countDocuments(filter),
        ]);
    }

    const pageCompanyIds = [
        ...new Set(products.map((product) => String(product.companyId))),
    ];
    const companies = pageCompanyIds.length
        ? await Company.find({
              _id: { $in: pageCompanyIds },
              ...catalogCompanyFilter,
          })
              .select("_id companyCode legalName tradeName logoUrl defaultCurrency status")
              .lean()
        : [];
    const companyMap = new Map(
        companies.map((company) => [String(company._id), buildSellerSnapshot(company)])
    );

    const ratingMap = await getRatingStatsMap(products.map((p) => p._id));

    const data = products.map((product) =>
        formatCatalogProduct(
            product,
            companyMap.get(String(product.companyId)) || null,
            null,
            ratingMap.get(String(product._id)) || null
        )
    );

    return {
        data,
        pagination: buildPagination(total),
    };
};

const getProductById = async (productId) => {
    const pid = toObjectId(productId);
    if (!pid) throw new AppError("Invalid product id.", 400);

    const product = await Product.findOne({
        _id: pid,
        ...MARKETPLACE_CATALOG_QUERY,
    })
        .populate("proCategoryId", "name")
        .populate("proSubCategoryId", "name")
        .populate("proBrandId", "name")
        .lean();

    if (!product) throw new AppError("Product not found.", 404);

    let company = null;
    if (product.companyId) {
        company = await Company.findOne({
            _id: product.companyId,
            ...catalogCompanyFilter,
        }).lean();
    }

    const seller = company ? buildSellerSnapshot(company) : null;
    const availableStock = await getAvailableStock(product);

    // Always load live variant rows by productId. Do not rely only on
    // hasVariants / companyId — older or mismatched rows were being hidden.
    const variantFilter = {
        productId: pid,
        isDeleted: { $ne: true },
        status: { $nin: ["Archived"] },
    };
    if (product.companyId) {
        variantFilter.$or = [
            { companyId: product.companyId },
            { companyId: null },
            { companyId: { $exists: false } },
        ];
    }

    const rows = await ProductVariant.find(variantFilter)
        .select(
            "combinationString sku sellingPrice offerPrice images quantity status attributes"
        )
        .populate({
            path: "attributes.variantId",
            select: "name",
        })
        .populate({
            path: "attributes.variantTypeId",
            select: "type name",
        })
        .sort({ isDefaultVariant: -1, createdAt: 1 })
        .lean();

    const variants = await Promise.all(
        rows.map(async (variant, index) => {
            const attrLabel = Array.isArray(variant.attributes)
                ? variant.attributes
                      .map((attr) => {
                          const name =
                              attr?.variantId?.name ||
                              attr?.variantId?.type ||
                              "";
                          return String(name).trim();
                      })
                      .filter(Boolean)
                      .join(" / ")
                : "";
            const label =
                (variant.combinationString || "").toString().trim() ||
                attrLabel ||
                (variant.sku || "").toString().trim() ||
                `Option ${index + 1}`;

            return {
                id: variant._id,
                label,
                sku: variant.sku || "",
                sellingPrice: resolveUnitPrice(variant),
                offerPrice:
                    variant.offerPrice != null && Number(variant.offerPrice) > 0
                        ? Number(variant.offerPrice)
                        : null,
                imageUrl:
                    pickImageUrl(variant.images) || pickImageUrl(product.images),
                availableStock: await getAvailableStock(product, variant),
                attributes: Array.isArray(variant.attributes)
                    ? variant.attributes.map((attr) => ({
                          variantTypeId:
                              attr?.variantTypeId?._id ||
                              attr?.variantTypeId ||
                              null,
                          variantTypeName:
                              attr?.variantTypeId?.type ||
                              attr?.variantTypeId?.name ||
                              "",
                          variantId:
                              attr?.variantId?._id || attr?.variantId || null,
                          variantName: attr?.variantId?.name || "",
                      }))
                    : [],
            };
        })
    );

    const ratingMap = await getRatingStatsMap([product._id]);

    return {
        ...formatCatalogProduct(
            product,
            seller,
            availableStock,
            ratingMap.get(String(product._id)) || null
        ),
        hasVariants: variants.length > 0 || Boolean(product.hasVariants),
        variants,
    };
};

const getTaxonomy = async () => {
    const productMatch = {
        ...MARKETPLACE_CATALOG_QUERY,
    };

    const [countFacet] = await Product.aggregate([
        { $match: productMatch },
        {
            $facet: {
                categories: [
                    { $match: { proCategoryId: { $ne: null } } },
                    { $group: { _id: "$proCategoryId", productCount: { $sum: 1 } } },
                ],
                subCategories: [
                    { $match: { proSubCategoryId: { $ne: null } } },
                    { $group: { _id: "$proSubCategoryId", productCount: { $sum: 1 } } },
                ],
                brands: [
                    { $match: { proBrandId: { $ne: null } } },
                    { $group: { _id: "$proBrandId", productCount: { $sum: 1 } } },
                ],
            },
        },
    ]);

    const categoryCountMap = new Map(
        (countFacet?.categories || []).map((r) => [String(r._id), r.productCount])
    );
    const subCategoryCountMap = new Map(
        (countFacet?.subCategories || []).map((r) => [String(r._id), r.productCount])
    );
    const brandCountMap = new Map(
        (countFacet?.brands || []).map((r) => [String(r._id), r.productCount])
    );

    const [categories, subCategories, brands] = await Promise.all([
        Category.find({
            isDeleted: { $ne: true },
            status: { $nin: ["Inactive", "Archived"] },
        })
            .select("name image slug sortOrder")
            .sort({ sortOrder: 1, name: 1 })
            .lean(),
        SubCategory.find({
            isDeleted: { $ne: true },
            status: { $nin: ["Inactive", "Archived"] },
        })
            .select("name categoryId image slug sortOrder")
            .populate("categoryId", "name slug")
            .sort({ sortOrder: 1, name: 1 })
            .lean(),
        Brand.find({
            isDeleted: { $ne: true },
            status: { $nin: ["Inactive", "Archived"] },
        })
            .select("name subcategoryId logo slug sortOrder")
            .populate("subcategoryId", "name categoryId")
            .sort({ sortOrder: 1, name: 1 })
            .lean(),
    ]);

    const withCount = (rows, map) =>
        rows.map((row) => ({
            ...row,
            productCount: map.get(String(row._id)) || 0,
        }));

    return {
        categories: withCount(categories, categoryCountMap),
        subCategories: withCount(subCategories, subCategoryCountMap),
        brands: withCount(brands, brandCountMap),
        variantTypes: await getFilterableVariantTypes(),
    };
};

const getFilterableVariantTypes = async () => {
    const types = await VariantType.find({
        isDeleted: { $ne: true },
        status: "Active",
        isFilterable: true,
    })
        .select("name type displayOrder")
        .sort({ displayOrder: 1, name: 1 })
        .lean();

    if (!types.length) return [];

    const typeIds = types.map((t) => t._id);
    const variants = await Variant.find({
        variantTypeId: { $in: typeIds },
        isDeleted: { $ne: true },
        status: "Active",
    })
        .select("name variantTypeId colorCode displayOrder")
        .sort({ displayOrder: 1, name: 1 })
        .lean();

    const byType = new Map();
    for (const v of variants) {
        const key = String(v.variantTypeId);
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key).push({
            id: v._id,
            name: v.name,
            colorCode: v.colorCode || "",
        });
    }

    return types
        .map((t) => ({
            id: t._id,
            name: t.name,
            type: t.type,
            options: byType.get(String(t._id)) || [],
        }))
        .filter((t) => t.options.length > 0);
};

const listSellers = async () => {
    const companies = await Company.find(catalogCompanyFilter)
        .select("_id companyCode legalName tradeName logoUrl status")
        .sort({ tradeName: 1, legalName: 1 })
        .lean();

    const companyIds = companies.map((c) => c._id);
    const productCounts = companyIds.length
        ? await Product.aggregate([
              {
                  $match: {
                      ...MARKETPLACE_CATALOG_QUERY,
                      companyId: { $in: companyIds },
                  },
              },
              { $group: { _id: "$companyId", productCount: { $sum: 1 } } },
          ])
        : [];

    const countMap = new Map(
        productCounts.map((r) => [String(r._id), r.productCount])
    );

    return companies.map((company) => ({
        id: company._id,
        companyCode: company.companyCode,
        name: company.tradeName || company.legalName,
        legalName: company.legalName,
        logoUrl: company.logoUrl || "",
        status: company.status,
        productCount: countMap.get(String(company._id)) || 0,
    }));
};

/** Public storefront banners from sellable companies (no auth required). */
const listPosters = async () => {
    const companies = await Company.find(catalogCompanyFilter).select("_id").lean();
    const companyIds = companies.map((c) => c._id);

    const filter = {
        imageUrl: { $nin: [null, "", "no_url", "no_data"] },
    };
    if (companyIds.length > 0) {
        filter.$or = [
            { companyId: { $in: companyIds } },
            { companyId: null },
            { companyId: { $exists: false } },
        ];
    }

    const posters = await Poster.find(filter)
        .sort({ createdAt: -1 })
        .limit(24)
        .lean();

    return posters.map((poster) => ({
        _id: poster._id,
        posterName: poster.posterName || "",
        imageUrl: poster.imageUrl || "",
        navigationTo: poster.navigationTo || "none",
        targetId: poster.targetId || null,
        companyId: poster.companyId || null,
        createdAt: poster.createdAt,
        updatedAt: poster.updatedAt,
    }));
};

module.exports = {
    listProducts,
    getProductById,
    getTaxonomy,
    listSellers,
    listPosters,
};
