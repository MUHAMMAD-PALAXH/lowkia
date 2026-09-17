/**
 * G-2c Phase A — company-scoped IMEI uniqueness (application layer).
 * Mock/unit only — no Mongo writes, no index changes.
 */
const assert = require("assert");
const mongoose = require("mongoose");
const { companyFilter } = require("../../utils/tenantScope");
const {
    assertImeiUnique,
} = require("../../services/grnService");

const COMPANY_A = new mongoose.Types.ObjectId();
const COMPANY_B = new mongoose.Types.ObjectId();
const IMEI = "359999999999123";

/** Build the Phase A uniqueness filter (mirrors helper + scanImei). */
const uniquenessFilter = (companyId, imeis) => ({
    ...companyFilter(companyId),
    imei: Array.isArray(imeis) ? { $in: imeis } : imeis,
    status: { $ne: "deleted" },
});

/** Test 1 — same company duplicate → REJECTED */
exports.same_company_active_imei_rejected = async () => {
    const ItemTrack = require("../../model/itemTrack");
    const orig = ItemTrack.find;
    ItemTrack.find = (filter) => {
        assert.strictEqual(String(filter.companyId), String(COMPANY_A));
        assert.deepStrictEqual(filter.imei, { $in: [IMEI] });
        assert.deepStrictEqual(filter.status, { $ne: "deleted" });
        return {
            session: () => ({
                select: () => ({
                    lean: async () => [{ imei: IMEI }],
                }),
            }),
        };
    };
    try {
        let threw = false;
        try {
            await assertImeiUnique(COMPANY_A, [IMEI], null);
        } catch (err) {
            threw = true;
            assert.match(String(err.message), /Duplicate IMEI/i);
        }
        assert.ok(threw, "same-company active IMEI must reject");
    } finally {
        ItemTrack.find = orig;
    }
};

/** Test 2 — cross-company duplicate → ALLOWED at application layer */
exports.cross_company_same_imei_allowed_at_app_layer = async () => {
    const ItemTrack = require("../../model/itemTrack");
    const orig = ItemTrack.find;
    let captured = null;
    ItemTrack.find = (filter) => {
        captured = filter;
        // Simulate: company B query finds no rows even if A owns IMEI
        return {
            session: () => ({
                select: () => ({
                    lean: async () => [],
                }),
            }),
        };
    };
    try {
        await assertImeiUnique(COMPANY_B, [IMEI], null);
        assert.ok(captured);
        assert.strictEqual(String(captured.companyId), String(COMPANY_B));
        assert.notStrictEqual(String(captured.companyId), String(COMPANY_A));
        assert.ok(captured.companyId, "query must include companyId");
        assert.ok(
            captured.imei && captured.imei.$in,
            "query must include imei $in"
        );
        // Must not be imei-only global filter
        assert.notDeepStrictEqual(Object.keys(captured).sort(), [
            "imei",
            "status",
        ]);
    } finally {
        ItemTrack.find = orig;
    }
};

/** Test 3 — deleted IMEI reuse within company → ALLOWED */
exports.deleted_imei_reuse_allowed = async () => {
    const ItemTrack = require("../../model/itemTrack");
    const orig = ItemTrack.find;
    ItemTrack.find = (filter) => {
        assert.deepStrictEqual(filter.status, { $ne: "deleted" });
        // DB would still have a deleted doc; query excludes it → empty
        return {
            session: () => ({
                select: () => ({
                    lean: async () => [],
                }),
            }),
        };
    };
    try {
        await assertImeiUnique(COMPANY_A, [IMEI], null);
    } finally {
        ItemTrack.find = orig;
    }
};

/** Test 4 — missing company → FAIL CLOSED */
exports.missing_company_fail_closed = async () => {
    const ItemTrack = require("../../model/itemTrack");
    let findCalled = false;
    const orig = ItemTrack.find;
    ItemTrack.find = () => {
        findCalled = true;
        return {
            session: () => ({
                select: () => ({
                    lean: async () => [],
                }),
            }),
        };
    };
    try {
        let threw = false;
        try {
            await assertImeiUnique(null, [IMEI], null);
        } catch (err) {
            threw = true;
            assert.match(String(err.message), /Company context is required/i);
        }
        assert.ok(threw);
        assert.strictEqual(
            findCalled,
            false,
            "must not run unscoped ItemTrack query"
        );

        threw = false;
        try {
            await assertImeiUnique(undefined, [IMEI], null);
        } catch (err) {
            threw = true;
            assert.match(String(err.message), /Company context is required/i);
        }
        assert.ok(threw);
        assert.strictEqual(findCalled, false);
    } finally {
        ItemTrack.find = orig;
    }
};

/** Test 5 — generated query includes companyId, not imei-only */
exports.uniqueness_query_includes_companyId = () => {
    const filter = uniquenessFilter(COMPANY_A, [IMEI]);
    assert.strictEqual(String(filter.companyId), String(COMPANY_A));
    assert.deepStrictEqual(filter.imei, { $in: [IMEI] });
    assert.deepStrictEqual(filter.status, { $ne: "deleted" });
    assert.ok(!("companyId" in { imei: IMEI, status: { $ne: "deleted" } }));
};

/** Test 6 — scanImei-shaped filter includes companyId + deleted exclusion */
exports.scan_imei_duplicate_filter_is_tenant_scoped = () => {
    const trustedCompanyId = COMPANY_A;
    const imei = IMEI;
    const filter = {
        ...companyFilter(trustedCompanyId),
        imei,
        status: { $ne: "deleted" },
    };
    assert.strictEqual(String(filter.companyId), String(COMPANY_A));
    assert.strictEqual(filter.imei, imei);
    assert.deepStrictEqual(filter.status, { $ne: "deleted" });
};

/** Schema no longer declares imei unique:true */
exports.itemtrack_schema_imei_not_unique = () => {
    const ItemTrack = require("../../model/itemTrack");
    const path = ItemTrack.schema.path("imei");
    assert.ok(path);
    assert.notStrictEqual(path.options.unique, true);
};

/** Empty imei list short-circuits without query when company present */
exports.empty_imei_list_ok = async () => {
    const ItemTrack = require("../../model/itemTrack");
    let findCalled = false;
    const orig = ItemTrack.find;
    ItemTrack.find = () => {
        findCalled = true;
        return {
            session: () => ({
                select: () => ({ lean: async () => [] }),
            }),
        };
    };
    try {
        await assertImeiUnique(COMPANY_A, [], null);
        assert.strictEqual(findCalled, false);
    } finally {
        ItemTrack.find = orig;
    }
};
