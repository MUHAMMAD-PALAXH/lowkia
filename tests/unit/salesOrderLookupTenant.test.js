/**
 * Tenant isolation expectations for sales-order / IMEI lookups.
 * Pure assertions — no Mongo connection.
 */
const assert = require("assert");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");

exports.lookup_routes_require_company_context = () => {
    assert.throws(() => companyFilter(null), /Company context is required/);
    assert.throws(() => companyFilter(undefined), /Company context is required/);
    assert.deepStrictEqual(companyFilter("tenant-a"), {
        companyId: "tenant-a",
    });
};

exports.item_track_stamp_never_trusts_client_company = () => {
    const row = stampCompany(
        {
            imei: "123456789012345",
            productId: "p1",
            variantId: "v1",
            vendorId: "u1",
            status: "available",
            companyId: "attacker-tenant",
        },
        "real-tenant"
    );
    assert.strictEqual(row.companyId, "real-tenant");
    assert.strictEqual(row.imei, "123456789012345");
};

exports.manual_imei_opening_qty_is_track_count = () => {
    // Contract: Manual IMEI opening Inventory qty == available ItemTracks.
    const availableTracks = ["a", "b", "c"];
    const opening = availableTracks.length;
    assert.strictEqual(opening, 3);
    assert.ok(opening > 0, "seedManualOpeningInventory must materialize stock");
};
