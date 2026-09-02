const ContentPage = require("../model/contentPage");
const AppError = require("../utils/appError");
const { parseMarketplacePagination } = require("../utils/marketplacePagination");

const NOT_DELETED = { isDeleted: { $ne: true } };

const formatContent = (row) => ({
    id: row._id,
    slug: row.slug,
    locale: row.locale,
    type: row.type,
    title: row.title,
    excerpt: row.excerpt || "",
    body: row.body || "",
    coverImageUrl: row.coverImageUrl || "",
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const listBlogPosts = async (query = {}) => {
    const locale = String(query.locale || "en").toLowerCase();
    const { skip, limit, buildPagination } = parseMarketplacePagination(query, {
        surface: "catalog",
    });

    const filter = {
        ...NOT_DELETED,
        type: "blog",
        status: "published",
        locale,
    };

    const [rows, total] = await Promise.all([
        ContentPage.find(filter)
            .sort({ publishedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select("-body")
            .lean(),
        ContentPage.countDocuments(filter),
    ]);

    return {
        data: rows.map(formatContent),
        pagination: buildPagination(total),
    };
};

const getBlogPostBySlug = async (slug, locale = "en") => {
    const row = await ContentPage.findOne({
        ...NOT_DELETED,
        type: "blog",
        status: "published",
        slug: String(slug).toLowerCase(),
        locale: String(locale).toLowerCase(),
    }).lean();

    if (!row) throw new AppError("Blog post not found.", 404);
    return formatContent(row);
};

const getPageBySlug = async (slug, locale = "en") => {
    const row = await ContentPage.findOne({
        ...NOT_DELETED,
        type: "page",
        status: "published",
        slug: String(slug).toLowerCase(),
        locale: String(locale).toLowerCase(),
    }).lean();

    if (!row) throw new AppError("Page not found.", 404);
    return formatContent(row);
};

module.exports = {
    listBlogPosts,
    getBlogPostBySlug,
    getPageBySlug,
};
