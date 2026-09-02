/**
 * Phase 18 marketplace pagination smoke (no DB).
 */
const assert = require("assert");
const {
    parseMarketplacePagination,
    MARKETPLACE_PAGE_CAPS,
} = require("../utils/marketplacePagination");

const customer = parseMarketplacePagination({ page: "2", limit: "999" }, {
    surface: "customer",
});
assert.strictEqual(customer.page, 2);
assert.strictEqual(customer.limit, MARKETPLACE_PAGE_CAPS.customer);
assert.strictEqual(customer.skip, MARKETPLACE_PAGE_CAPS.customer);

const platform = parseMarketplacePagination({ limit: 0 }, { surface: "platform" });
assert.strictEqual(platform.limit, 20);

const invalid = parseMarketplacePagination({ limit: -3 }, { surface: "platform" });
assert.strictEqual(invalid.limit, 20);

const meta = customer.buildPagination(95);
assert.strictEqual(meta.totalPages, 2);

console.log("smokeMarketplacePagination: ok");
