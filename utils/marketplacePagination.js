const DEFAULT_LIMIT = 20;

const MARKETPLACE_PAGE_CAPS = Object.freeze({
    customer: 50,
    company: 100,
    platform: 100,
    catalog: 50,
});

/**
 * Normalize marketplace list pagination params.
 */
const parseMarketplacePagination = (
    query = {},
    { surface = "customer", defaultLimit = DEFAULT_LIMIT } = {}
) => {
    const maxLimit = MARKETPLACE_PAGE_CAPS[surface] || MARKETPLACE_PAGE_CAPS.customer;
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const rawLimit = parseInt(query.limit, 10);
    const resolvedLimit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
    const limit = Math.min(Math.max(resolvedLimit, 1), maxLimit);
    const skip = (page - 1) * limit;

    const buildPagination = (total = 0) => ({
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
    });

    return { page, limit, skip, buildPagination };
};

module.exports = {
    DEFAULT_LIMIT,
    MARKETPLACE_PAGE_CAPS,
    parseMarketplacePagination,
};
