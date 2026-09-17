/**
 * G-2a — Cross-company write-path isolation (pure unit tests, no Mongo).
 */
const assert = require("assert");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../../services/companyService");
const { createTrashOps } = require("../../utils/softDeleteTrash");

exports.company_a_cannot_assert_company_b_document = () => {
    assert.throws(
        () =>
            assertDocumentCompany(
                { _id: "so1", companyId: "company-b" },
                "company-a",
                "Sales order"
            ),
        /Sales order not found/
    );
};

exports.company_a_can_assert_own_document = () => {
    const doc = { _id: "so1", companyId: "company-a" };
    assert.strictEqual(
        assertDocumentCompany(doc, "company-a", "Sales order"),
        doc
    );
};

exports.bulk_trash_filter_includes_companyId = async () => {
    const saved = [];
    const Model = {
        find: async (filter) => {
            saved.push(filter);
            return [];
        },
        findOne: async () => null,
        deleteMany: async () => ({ deletedCount: 0 }),
        countDocuments: async () => 0,
    };
    const trash = createTrashOps(Model, { label: "Sales Order" });

    let threw = false;
    try {
        await trash.bulkSoftDelete({ scope: "all" }, null, "company-a");
    } catch (err) {
        threw = true;
        assert.match(String(err.message), /No matching active/i);
    }
    assert.ok(threw, "expected 404 when no docs");
    assert.ok(
        saved.some(
            (f) =>
                f &&
                String(f.companyId) === "company-a" &&
                f.isDeleted &&
                f.isDeleted.$ne === true
        ),
        "bulk soft-delete filter must include companyId"
    );

    // ids scope with empty list throws synchronously via rejected promise
    let emptyIdsThrew = false;
    try {
        await trash.bulkSoftDelete(
            { ids: [], scope: "ids" },
            null,
            "company-a"
        );
    } catch (err) {
        emptyIdsThrew = true;
        assert.match(String(err.message), /Select at least one/i);
    }
    assert.ok(emptyIdsThrew, "empty ids must reject");
};

exports.bulk_trash_scope_all_without_company_is_unscoped_compat = async () => {
    const saved = [];
    const Model = {
        find: async (filter) => {
            saved.push(filter);
            return [
                {
                    _id: "x",
                    isDeleted: false,
                    save: async function save() {
                        this.isDeleted = true;
                    },
                },
            ];
        },
    };
    const trash = createTrashOps(Model, { label: "Item" });
    await trash.bulkSoftDelete({ scope: "all" }, "actor");
    assert.ok(saved[0]);
    assert.strictEqual(saved[0].companyId, undefined);
};

exports.receive_return_requires_company_context = () => {
    assert.throws(() => companyFilter(null), /Company context is required/);
};

exports.issue_ticket_stamp_never_trusts_client_company = () => {
    const stamped = stampCompany(
        { imei: "111", companyId: "attacker" },
        "company-a"
    );
    assert.strictEqual(stamped.companyId, "company-a");
};

exports.cross_company_imei_mutation_filter_shape = () => {
    const tenantA = companyFilter("company-a");
    const query = { imei: "359999999999999", ...tenantA };
    assert.deepStrictEqual(query, {
        imei: "359999999999999",
        companyId: "company-a",
    });
    assert.notDeepStrictEqual(query, {
        imei: "359999999999999",
        companyId: "company-b",
    });
};

/** Mirrors G-2a controlled null-company fallback: never matches stamped foreign tenants. */
exports.unstamped_fallback_cannot_select_stamped_foreign_track = () => {
    const companyId = "company-a";
    const stampedForeign = {
        imei: "359999999999999",
        companyId: "company-b",
        productId: { companyId: "company-b" },
    };
    const unstampedOwnProduct = {
        imei: "359999999999999",
        companyId: null,
        productId: { companyId: "company-a" },
    };
    const unstampedForeignProduct = {
        imei: "359999999999999",
        companyId: null,
        productId: { companyId: "company-b" },
    };

    const matchesTenantQuery = (doc, tenantCompanyId) =>
        String(doc.companyId) === String(tenantCompanyId);

    const matchesUnstampedFallback = (doc, tenantCompanyId) => {
        const missing =
            doc.companyId == null || typeof doc.companyId === "undefined";
        if (!missing) return false;
        const productCompany = doc.productId?.companyId;
        return (
            !!productCompany &&
            String(productCompany) === String(tenantCompanyId)
        );
    };

    assert.strictEqual(matchesTenantQuery(stampedForeign, companyId), false);
    assert.strictEqual(
        matchesUnstampedFallback(stampedForeign, companyId),
        false
    );
    assert.strictEqual(
        matchesUnstampedFallback(unstampedOwnProduct, companyId),
        true
    );
    assert.strictEqual(
        matchesUnstampedFallback(unstampedForeignProduct, companyId),
        false
    );
};

/** findOrderOrFail-style filter must always include companyId when companyFilter is applied. */
exports.sales_order_find_filter_includes_company = () => {
    const NOT_DELETED = { isDeleted: { $ne: true } };
    const id = "507f1f77bcf86cd799439011";
    const companyId = "company-a";
    const filter = {
        _id: id,
        ...NOT_DELETED,
        ...companyFilter(companyId),
    };
    assert.deepStrictEqual(filter, {
        _id: id,
        isDeleted: { $ne: true },
        companyId: "company-a",
    });
    assert.notStrictEqual(filter.companyId, "company-b");
};
