/**
 * Phase G Part 1 — READ-ONLY ItemTrack companyId / IMEI integrity audit.
 *
 * Usage:
 *   node seeders/auditItemTrackCompany.js
 *
 * NEVER writes. NEVER creates indexes. NEVER deletes.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const MISSING_COMPANY = {
    $or: [{ companyId: null }, { companyId: { $exists: false } }],
};

async function main() {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL is required");
    }

    await mongoose.connect(process.env.MONGO_URL);
    const db = mongoose.connection.db;
    const tracks = db.collection("itemtracks");
    const products = db.collection("products");
    const companies = db.collection("companies");
    const variants = db.collection("productvariants");

    const report = {
        auditedAt: new Date().toISOString(),
        mode: "READ_ONLY",
        wrote: false,
    };

    // --- counts ---
    report.totalItemTracks = await tracks.countDocuments({});
    report.withCompanyId = await tracks.countDocuments({
        companyId: { $ne: null, $exists: true },
    });
    report.withoutCompanyId = await tracks.countDocuments(MISSING_COMPANY);

    // Invalid ObjectId / wrong type companyId
    const withAnyCompany = await tracks
        .find(
            { companyId: { $exists: true, $ne: null } },
            { projection: { companyId: 1 } }
        )
        .toArray();
    let invalidCompanyId = 0;
    const companyIdSet = new Set();
    for (const doc of withAnyCompany) {
        const cid = doc.companyId;
        const ok =
            cid &&
            (cid instanceof mongoose.Types.ObjectId ||
                mongoose.Types.ObjectId.isValid(String(cid)));
        if (!ok) invalidCompanyId += 1;
        else companyIdSet.add(String(cid));
    }
    report.invalidCompanyId = invalidCompanyId;

    // Existing companies referenced
    const existingCompanies = await companies
        .find(
            { _id: { $in: [...companyIdSet].map((id) => new mongoose.Types.ObjectId(id)) } },
            { projection: { _id: 1, name: 1 } }
        )
        .toArray();
    const existingCompanyIds = new Set(existingCompanies.map((c) => String(c._id)));
    report.companyIdsReferenced = companyIdSet.size;
    report.companyIdsMissingFromCompanies =
        [...companyIdSet].filter((id) => !existingCompanyIds.has(id)).length;

    // --- indexes ---
    report.itemTrackIndexes = await tracks.indexes();

    // --- duplicate IMEI (global, current unique constraint) ---
    const globalDupImei = await tracks
        .aggregate([
            {
                $group: {
                    _id: "$imei",
                    count: { $sum: 1 },
                    ids: { $push: "$_id" },
                },
            },
            { $match: { count: { $gt: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 50 },
        ])
        .toArray();
    report.duplicateImeiGlobalGroups = globalDupImei.length;
    report.duplicateImeiGlobalSample = globalDupImei.slice(0, 10).map((g) => ({
        imei: g._id,
        count: g.count,
    }));

    // --- duplicate (companyId, imei) among stamped rows ---
    const companyImeiDups = await tracks
        .aggregate([
            {
                $match: {
                    companyId: { $ne: null, $exists: true },
                    imei: { $type: "string", $ne: "" },
                },
            },
            {
                $group: {
                    _id: { companyId: "$companyId", imei: "$imei" },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gt: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 50 },
        ])
        .toArray();
    report.duplicateCompanyImeiGroups = companyImeiDups.length;
    report.duplicateCompanyImeiSample = companyImeiDups.slice(0, 10).map((g) => ({
        companyId: String(g._id.companyId),
        imei: g._id.imei,
        count: g.count,
    }));

    // Same IMEI appearing under different companyIds (multi-tenant collision / shared value)
    const imeiAcrossCompanies = await tracks
        .aggregate([
            {
                $match: {
                    companyId: { $ne: null, $exists: true },
                    imei: { $type: "string", $ne: "" },
                },
            },
            {
                $group: {
                    _id: "$imei",
                    companies: { $addToSet: "$companyId" },
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    imei: "$_id",
                    companyCount: { $size: "$companies" },
                    count: 1,
                },
            },
            { $match: { companyCount: { $gt: 1 } } },
            { $sort: { companyCount: -1 } },
            { $limit: 50 },
        ])
        .toArray();
    report.imeiSharedAcrossCompaniesGroups = imeiAcrossCompanies.length;
    report.imeiSharedAcrossCompaniesSample = imeiAcrossCompanies
        .slice(0, 10)
        .map((g) => ({
            imei: g.imei,
            companyCount: g.companyCount,
            trackCount: g.count,
        }));

    // --- deriveability for missing companyId ---
    const missing = await tracks.find(MISSING_COMPANY).toArray();
    let safeFromProduct = 0;
    let ambiguous = 0;
    let orphanedNoProduct = 0;
    let orphanedDeletedProduct = 0;
    let conflictSources = 0;
    let safeSamples = [];
    let ambiguousSamples = [];
    let orphanSamples = [];

    const productCache = new Map();
    async function loadProduct(pid) {
        const key = String(pid || "");
        if (!key || key === "undefined" || key === "null") return null;
        if (productCache.has(key)) return productCache.get(key);
        let oid;
        try {
            oid = new mongoose.Types.ObjectId(key);
        } catch (_) {
            productCache.set(key, null);
            return null;
        }
        const p = await products.findOne(
            { _id: oid },
            {
                projection: {
                    companyId: 1,
                    isDeleted: 1,
                    name: 1,
                    productCode: 1,
                },
            }
        );
        productCache.set(key, p);
        return p;
    }

    for (const t of missing) {
        const product = await loadProduct(t.productId);
        if (!product) {
            orphanedNoProduct += 1;
            if (orphanSamples.length < 15) {
                orphanSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    productId: String(t.productId || ""),
                    reason: "product_missing",
                });
            }
            continue;
        }

        if (product.isDeleted === true) {
            orphanedDeletedProduct += 1;
            // Still may have companyId to derive
        }

        const productCompany = product.companyId
            ? String(product.companyId)
            : null;

        // Cross-check sale order company if present
        let saleCompany = null;
        if (t.saleInfo?.orderId) {
            const so = await db.collection("salesorders").findOne(
                { _id: t.saleInfo.orderId },
                { projection: { companyId: 1 } }
            );
            if (so?.companyId) saleCompany = String(so.companyId);
        }

        let branchCompany = null;
        if (t.currentBranchId) {
            const br = await db.collection("branches").findOne(
                { _id: t.currentBranchId },
                { projection: { companyId: 1 } }
            );
            if (br?.companyId) branchCompany = String(br.companyId);
        }

        const sources = [productCompany, saleCompany, branchCompany].filter(
            Boolean
        );
        const unique = [...new Set(sources)];

        if (!productCompany && unique.length === 0) {
            ambiguous += 1;
            if (ambiguousSamples.length < 15) {
                ambiguousSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    productId: String(t.productId || ""),
                    reason: "no_derivable_company",
                    productDeleted: !!product.isDeleted,
                });
            }
            continue;
        }

        if (unique.length > 1) {
            conflictSources += 1;
            ambiguous += 1;
            if (ambiguousSamples.length < 15) {
                ambiguousSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    productCompany,
                    saleCompany,
                    branchCompany,
                    reason: "conflicting_company_sources",
                });
            }
            continue;
        }

        // Prefer product company when present and consistent
        if (productCompany) {
            safeFromProduct += 1;
            if (safeSamples.length < 10) {
                safeSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    derivedCompanyId: productCompany,
                    source: "product.companyId",
                    productDeleted: !!product.isDeleted,
                });
            }
        } else {
            // Only sale/branch — treat as ambiguous for safety (Part 3 prefers product)
            ambiguous += 1;
            if (ambiguousSamples.length < 15) {
                ambiguousSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    saleCompany,
                    branchCompany,
                    reason: "product_missing_company_only_secondary_sources",
                });
            }
        }
    }

    report.missingBreakdown = {
        safeToBackfillFromProduct: safeFromProduct,
        ambiguousOrManualReview: ambiguous,
        orphanedProductMissing: orphanedNoProduct,
        linkedToDeletedProduct: orphanedDeletedProduct,
        conflictingCompanySources: conflictSources,
    };
    report.samples = {
        safe: safeSamples,
        ambiguous: ambiguousSamples,
        orphan: orphanSamples,
    };

    // Tracks whose product company differs from track company (cross-company link)
    const stamped = await tracks
        .find(
            { companyId: { $ne: null, $exists: true } },
            { projection: { companyId: 1, productId: 1, imei: 1 } }
        )
        .limit(50000)
        .toArray();

    let crossCompanyProduct = 0;
    const crossSamples = [];
    for (const t of stamped) {
        const product = await loadProduct(t.productId);
        if (!product?.companyId) continue;
        if (String(product.companyId) !== String(t.companyId)) {
            crossCompanyProduct += 1;
            if (crossSamples.length < 15) {
                crossSamples.push({
                    trackId: String(t._id),
                    imei: t.imei,
                    trackCompanyId: String(t.companyId),
                    productCompanyId: String(product.companyId),
                });
            }
        }
    }
    report.tracksPointingAtOtherCompanyProduct = crossCompanyProduct;
    report.crossCompanyProductSamples = crossSamples;

    // Variant orphans
    let orphanVariant = 0;
    const missingSampleForVariant = missing.slice(0, 200);
    for (const t of missingSampleForVariant.concat(
        stamped.slice(0, Math.max(0, 200 - missingSampleForVariant.length))
    )) {
        if (!t.variantId) {
            orphanVariant += 1;
            continue;
        }
        const v = await variants.findOne(
            { _id: t.variantId },
            { projection: { _id: 1 } }
        );
        if (!v) orphanVariant += 1;
    }
    report.orphanVariantNote =
        "Sampled up to 200 missing + stamped tracks for variant existence";
    report.orphanVariantInSample = orphanVariant;

    // Schema note
    report.schemaNotes = {
        currentGlobalUniqueImei: true,
        intendedCompoundUnique: "(companyId, imei)",
        warning:
            "Schema currently has imei unique:true (global). Moving to compound unique requires dropping global unique first, and only after duplicates are resolved.",
    };

    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error("AUDIT_FAILED", err);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
