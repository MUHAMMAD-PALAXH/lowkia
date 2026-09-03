const Category = require("../../model/category");
const SubCategory = require("../../model/subCategory");
const Brand = require("../../model/brand");
const Product = require("../../model/product");
const ProductVariant = require("../../model/productVariant");
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

const listProducts = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "catalog",
    });

    // Preview mode: every non-archived product is browsable on web + mobile.
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

    const sortBy = query.sortBy === "price" ? "sellingPrice" : "createdAt";
    const sortOrder = query.order === "asc" ? 1 : -1;

    const [products, total] = await Promise.all([
        Product.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip(skip)
            .limit(limit)
            .select(
                "companyId productCode name description sellingPrice offerPrice images hasVariants availableStock isFeatured isNewArrival isBestSeller proCategoryId proSubCategoryId proBrandId createdAt"
            )
            .lean(),
        Product.countDocuments(filter),
    ]);

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
    };
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
