/**
 * Phase G — ItemTrack.companyId backfill (idempotent).
 *
 * Derives companyId ONLY from Product.companyId when unambiguous.
 * Does NOT overwrite existing valid companyId.
 * Does NOT delete / create tracks.
 * Does NOT create indexes.
 *
 * Usage:
 *   node seeders/backfillItemTrackCompany.js --dry-run
 *   node seeders/backfillItemTrackCompany.js --execute
 *
 * npm:
 *   npm run backfill:itemtrack-company -- --dry-run
 *   npm run backfill:itemtrack-company -- --execute
 */
require("dotenv").config();
const mongoose = require("mongoose");

const MISSING_COMPANY = {
    $or: [{ companyId: null }, { companyId: { $exists: false } }],
};

function parseArgs(argv) {
    const dryRun = argv.includes("--dry-run") || !argv.includes("--execute");
    const execute = argv.includes("--execute");
    if (execute && argv.includes("--dry-run")) {
        throw new Error("Pass only one of --dry-run or --execute");
    }
    return { dryRun: dryRun && !execute, execute };
}

async function main() {
    const { dryRun, execute } = parseArgs(process.argv.slice(2));
    if (!process.env.MONGO_URL) throw new Error("MONGO_URL is required");

    await mongoose.connect(process.env.MONGO_URL);
    const db = mongoose.connection.db;
    const tracks = db.collection("itemtracks");
    const products = db.collection("products");
    const salesorders = db.collection("salesorders");
    const branches = db.collection("branches");

    const before = {
        total: await tracks.countDocuments({}),
        withCompanyId: await tracks.countDocuments({
            companyId: { $ne: null, $exists: true },
        }),
        missing: await tracks.countDocuments(MISSING_COMPANY),
    };

    const categories = {
        A_safe_product: [],
        B_ambiguous: [],
        C_orphaned: [],
    };

    const missingDocs = await tracks.find(MISSING_COMPANY).toArray();
    const productCache = new Map();

    async function productOf(id) {
        const key = String(id || "");
        if (!mongoose.Types.ObjectId.isValid(key)) return null;
        if (productCache.has(key)) return productCache.get(key);
        const p = await products.findOne(
            { _id: new mongoose.Types.ObjectId(key) },
            { projection: { companyId: 1, isDeleted: 1, name: 1 } }
        );
        productCache.set(key, p);
        return p;
    }

    for (const t of missingDocs) {
        const product = await productOf(t.productId);
        if (!product) {
            categories.C_orphaned.push({
                trackId: String(t._id),
                imei: t.imei,
                reason: "product_missing",
            });
            continue;
        }

        const productCompany = product.companyId
            ? String(product.companyId)
            : null;

        let saleCompany = null;
        if (t.saleInfo?.orderId) {
            const so = await salesorders.findOne(
                { _id: t.saleInfo.orderId },
                { projection: { companyId: 1 } }
            );
            if (so?.companyId) saleCompany = String(so.companyId);
        }

        let branchCompany = null;
        if (t.currentBranchId) {
            const br = await branches.findOne(
                { _id: t.currentBranchId },
                { projection: { companyId: 1 } }
            );
            if (br?.companyId) branchCompany = String(br.companyId);
        }

        const sources = [...new Set([productCompany, saleCompany, branchCompany].filter(Boolean))];

        if (!productCompany) {
            categories.B_ambiguous.push({
                trackId: String(t._id),
                imei: t.imei,
                reason: "product_has_no_companyId",
                saleCompany,
                branchCompany,
                productDeleted: !!product.isDeleted,
            });
            continue;
        }

        if (sources.length > 1) {
            categories.B_ambiguous.push({
                trackId: String(t._id),
                imei: t.imei,
                reason: "conflicting_company_sources",
                productCompany,
                saleCompany,
                branchCompany,
            });
            continue;
        }

        categories.A_safe_product.push({
            trackId: String(t._id),
            imei: t.imei,
            companyId: productCompany,
            source: "product.companyId",
            productDeleted: !!product.isDeleted,
        });
    }

    let modified = 0;
    if (execute) {
        for (const row of categories.A_safe_product) {
            const result = await tracks.updateOne(
                {
                    _id: new mongoose.Types.ObjectId(row.trackId),
                    ...MISSING_COMPANY,
                },
                {
                    $set: {
                        companyId: new mongoose.Types.ObjectId(row.companyId),
                    },
                }
            );
            modified += result.modifiedCount || 0;
        }
    }

    const after = {
        total: await tracks.countDocuments({}),
        withCompanyId: await tracks.countDocuments({
            companyId: { $ne: null, $exists: true },
        }),
        missing: await tracks.countDocuments(MISSING_COMPANY),
    };

    const report = {
        mode: execute ? "EXECUTE" : "DRY_RUN",
        wrote: !!execute,
        before,
        after,
        modified,
        counts: {
            A_safe_to_backfill: categories.A_safe_product.length,
            B_ambiguous_manual_review: categories.B_ambiguous.length,
            C_orphaned_manual_review: categories.C_orphaned.length,
        },
        samples: {
            A: categories.A_safe_product.slice(0, 20),
            B: categories.B_ambiguous.slice(0, 20),
            C: categories.C_orphaned.slice(0, 20),
        },
        notes: [
            "Category B/C are never modified.",
            "Existing non-null companyId is never overwritten.",
            "Compound unique index is NOT created by this script.",
            "Global unique index on imei still exists — multi-tenant shared IMEI not possible until that is dropped after approval.",
        ],
    };

    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error("BACKFILL_FAILED", err);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
