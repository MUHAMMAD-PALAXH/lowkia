const Category = require("../../model/category");
const SubCategory = require("../../model/subCategory");
const Brand = require("../../model/brand");
const Product = require("../../model/product");
const ProductVariant = require("../../model/productVariant");
const Company = require("../../model/company");
const AppError = require("../../utils/appError");
const { parseMarketplacePagination } = require("../../utils/marketplacePagination");
const {
    MARKETPLACE_PRODUCT_QUERY,
    SELLABLE_COMPANY_STATUSES,
    toObjectId,
    pickImageUrl,
    resolveUnitPrice,
    buildSellerSnapshot,
    getAvailableStock,
} = require("./marketplaceProductService");

const formatCatalogProduct = (product, seller, availableStock = null) => ({
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
    hasVariants: Boolean(product.hasVariants),
    availableStock:
        availableStock !== null
            ? availableStock
            : Math.max(Number(product.availableStock) || 0, 0),
    isFeatured: Boolean(product.isFeatured),
    isNewArrival: Boolean(product.isNewArrival),
    isBestSeller: Boolean(product.isBestSeller),
    proCategoryId: product.proCategoryId || null,
    proSubCategoryId: product.proSubCategoryId || null,
    proBrandId: product.proBrandId || null,
    seller,
});

const listProducts = async (query = {}) => {
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "catalog",
    });

    const sellableCompanyIds = await Company.distinct("_id", {
        isDeleted: { $ne: true },
        status: { $in: SELLABLE_COMPANY_STATUSES },
    });

    const filter = {
        ...MARKETPLACE_PRODUCT_QUERY,
        companyId: { $in: sellableCompanyIds },
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
        if (!cid || !sellableCompanyIds.some((id) => String(id) === String(cid))) {
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
              isDeleted: { $ne: true },
              status: { $in: SELLABLE_COMPANY_STATUSES },
          })
              .select("_id companyCode legalName tradeName logoUrl defaultCurrency status")
              .lean()
        : [];
    const companyMap = new Map(
        companies.map((company) => [String(company._id), buildSellerSnapshot(company)])
    );

    const data = products.map((product) =>
        formatCatalogProduct(product, companyMap.get(String(product.companyId)) || null)
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
        ...MARKETPLACE_PRODUCT_QUERY,
    })
        .populate("proCategoryId", "name")
        .populate("proSubCategoryId", "name")
        .populate("proBrandId", "name")
        .lean();

    if (!product) throw new AppError("Product not found.", 404);

    const company = await Company.findOne({
        _id: product.companyId,
        isDeleted: { $ne: true },
        status: { $in: SELLABLE_COMPANY_STATUSES },
    }).lean();

    if (!company) throw new AppError("Product seller is not available.", 404);

    const seller = buildSellerSnapshot(company);
    const availableStock = await getAvailableStock(product);

    let variants = [];
    if (product.hasVariants) {
        const rows = await ProductVariant.find({
            productId: pid,
            companyId: product.companyId,
            isDeleted: false,
            status: "Active",
        })
            .select(
                "combinationString sku sellingPrice offerPrice images quantity status"
            )
            .lean();

        variants = await Promise.all(
            rows.map(async (variant) => ({
                id: variant._id,
                label: variant.combinationString || "",
                sku: variant.sku || "",
                sellingPrice: resolveUnitPrice(variant),
                offerPrice:
                    variant.offerPrice != null && Number(variant.offerPrice) > 0
                        ? Number(variant.offerPrice)
                        : null,
                imageUrl:
                    pickImageUrl(variant.images) || pickImageUrl(product.images),
                availableStock: await getAvailableStock(product, variant),
            }))
        );
    }

    return {
        ...formatCatalogProduct(product, seller, availableStock),
        variants,
    };
};

const getTaxonomy = async () => {
    const sellableCompanyIds = await Company.distinct("_id", {
        isDeleted: { $ne: true },
        status: { $in: SELLABLE_COMPANY_STATUSES },
    });

    const productMatch = {
        ...MARKETPLACE_PRODUCT_QUERY,
        companyId: { $in: sellableCompanyIds },
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
            isDeleted: false,
            status: "Active",
        })
            .select("name image slug sortOrder")
            .sort({ sortOrder: 1, name: 1 })
            .lean(),
        SubCategory.find({
            isDeleted: false,
            status: "Active",
        })
            .select("name categoryId image slug sortOrder")
            .populate("categoryId", "name slug")
            .sort({ sortOrder: 1, name: 1 })
            .lean(),
        Brand.find({
            isDeleted: false,
            status: "Active",
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
    const companies = await Company.find({
        isDeleted: { $ne: true },
        status: { $in: SELLABLE_COMPANY_STATUSES },
    })
        .select("_id companyCode legalName tradeName logoUrl status")
        .sort({ tradeName: 1, legalName: 1 })
        .lean();

    const companyIds = companies.map((c) => c._id);
    const productCounts = companyIds.length
        ? await Product.aggregate([
              {
                  $match: {
                      ...MARKETPLACE_PRODUCT_QUERY,
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

module.exports = {
    listProducts,
    getProductById,
    getTaxonomy,
    listSellers,
};
