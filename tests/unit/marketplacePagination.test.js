const assert = require("assert");
const {
    parseMarketplacePagination,
    MARKETPLACE_PAGE_CAPS,
} = require("../../utils/marketplacePagination");

exports.customer_cap_enforced = () => {
    const { limit } = parseMarketplacePagination(
        { limit: 500 },
        { surface: "customer" }
    );
    assert.strictEqual(limit, MARKETPLACE_PAGE_CAPS.customer);
};

exports.company_cap_enforced = () => {
    const { limit } = parseMarketplacePagination(
        { limit: 500 },
        { surface: "company" }
    );
    assert.strictEqual(limit, MARKETPLACE_PAGE_CAPS.company);
};

exports.skip_calculated_from_page = () => {
    const { skip, limit } = parseMarketplacePagination(
        { page: 3, limit: 10 },
        { surface: "platform" }
    );
    assert.strictEqual(skip, 20);
    assert.strictEqual(limit, 10);
};

exports.build_pagination_meta = () => {
    const { buildPagination } = parseMarketplacePagination({}, { surface: "catalog" });
    assert.deepStrictEqual(buildPagination(0), {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
    });
    assert.deepStrictEqual(buildPagination(41).totalPages, 3);
};
