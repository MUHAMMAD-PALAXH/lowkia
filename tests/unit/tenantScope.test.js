const assert = require("assert");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../../services/companyService");

exports.companyFilter_requires_id = () => {
    assert.throws(() => companyFilter(null), /Company context is required/);
    assert.deepStrictEqual(companyFilter("abc"), { companyId: "abc" });
};

exports.stampCompany_strips_client_spoof = () => {
    const stamped = stampCompany(
        { name: "Branch A", companyId: "spoofed-other-tenant" },
        "real-tenant"
    );
    assert.strictEqual(stamped.companyId, "real-tenant");
    assert.strictEqual(stamped.name, "Branch A");
};

exports.assertDocumentCompany_blocks_cross_tenant = () => {
    assert.throws(
        () =>
            assertDocumentCompany(
                { companyId: "tenant-a" },
                "tenant-b",
                "Branch"
            ),
        /Branch not found/
    );
    const doc = { companyId: "tenant-a", name: "OK" };
    assert.strictEqual(
        assertDocumentCompany(doc, "tenant-a", "Branch"),
        doc
    );
};
