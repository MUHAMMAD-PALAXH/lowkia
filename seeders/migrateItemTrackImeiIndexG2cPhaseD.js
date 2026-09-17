/**
 * G-2c Phase D — controlled ItemTrack index migration.
 * Preflight (read-only) → drop imei_1 → create companyId_1_imei_1 → verify.
 * Partial filter uses status $in (MongoDB-compatible; $ne is unsupported).
 * Does NOT modify ItemTrack documents. Does NOT call syncIndexes.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const TARGET_NAME = "companyId_1_imei_1";
const OLD_NAME = "imei_1";

function summarizeIndex(idx) {
    return {
        name: idx.name,
        key: idx.key,
        unique: !!idx.unique,
        sparse: !!idx.sparse,
        partialFilterExpression: idx.partialFilterExpression || null,
        background: idx.background,
    };
}

(async () => {
    await mongoose.connect(process.env.MONGO_URL);
    const db = mongoose.connection.db;
    console.log("db", mongoose.connection.name);

    if (mongoose.connection.name !== "lowkia") {
        console.error("BLOCKED: unexpected database name", mongoose.connection.name);
        process.exit(2);
    }

    const it = db.collection("itemtracks");

    // ---- PREFLIGHT ----
    const total = await it.countDocuments();
    const nullCompany = await it.countDocuments({
        $or: [{ companyId: null }, { companyId: { $exists: false } }],
    });
    const deleted = await it.countDocuments({ status: "deleted" });
    const nonDeleted = await it.countDocuments({ status: { $ne: "deleted" } });
    const missingImei = await it.countDocuments({
        $or: [{ imei: null }, { imei: "" }, { imei: { $exists: false } }],
    });

    const stamped = await it
        .find(
            { companyId: { $ne: null, $exists: true } },
            { projection: { companyId: 1 } }
        )
        .toArray();
    const companyIds = [...new Set(stamped.map((r) => String(r.companyId)))];
    let invalidCompanyId = 0;
    if (companyIds.length) {
        const companies = db.collection("companies");
        const valid = await companies
            .find(
                {
                    _id: {
                        $in: companyIds.map(
                            (id) => new mongoose.Types.ObjectId(id)
                        ),
                    },
                },
                { projection: { _id: 1 } }
            )
            .toArray();
        const validSet = new Set(valid.map((c) => String(c._id)));
        invalidCompanyId = companyIds.filter((id) => !validSet.has(id)).length;
    }

    const globalDup = await it
        .aggregate([
            { $group: { _id: "$imei", n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
        ])
        .toArray();

    const compoundDup = await it
        .aggregate([
            { $match: { status: { $ne: "deleted" } } },
            {
                $group: {
                    _id: { c: "$companyId", i: "$imei" },
                    n: { $sum: 1 },
                },
            },
            { $match: { n: { $gt: 1 } } },
        ])
        .toArray();

    console.log(
        "PREFLIGHT",
        JSON.stringify(
            {
                total,
                nullCompany,
                invalidCompanyId,
                deleted,
                nonDeleted,
                missingImei,
                globalDup: globalDup.length,
                compoundDupNonDeleted: compoundDup.length,
            },
            null,
            2
        )
    );

    if (
        total !== 0 ||
        nullCompany !== 0 ||
        invalidCompanyId !== 0 ||
        missingImei !== 0 ||
        globalDup.length !== 0 ||
        compoundDup.length !== 0
    ) {
        console.error("BLOCKED: preflight failed — not empty or conflicts exist");
        await mongoose.disconnect();
        process.exit(2);
    }

    const beforeIndexes = await it.indexes();
    const imei1 = beforeIndexes.find((i) => i.name === OLD_NAME);
    console.log("BEFORE_INDEXES", JSON.stringify(beforeIndexes.map(summarizeIndex), null, 2));

    if (!imei1) {
        console.error("BLOCKED: imei_1 not found");
        await mongoose.disconnect();
        process.exit(2);
    }

    const keyOk =
        imei1.key &&
        Object.keys(imei1.key).length === 1 &&
        imei1.key.imei === 1;
    const uniqueOk = imei1.unique === true;
    const noPartial = !imei1.partialFilterExpression;
    const notSparse = !imei1.sparse;

    if (!keyOk || !uniqueOk || !noPartial || !notSparse) {
        console.error(
            "BLOCKED: unexpected imei_1 definition",
            JSON.stringify(summarizeIndex(imei1), null, 2)
        );
        await mongoose.disconnect();
        process.exit(2);
    }

    if (beforeIndexes.some((i) => i.name === TARGET_NAME)) {
        console.error("BLOCKED: companyId_1_imei_1 already exists");
        await mongoose.disconnect();
        process.exit(2);
    }

    // ---- SCHEMA SAFETY (loaded model) ----
    // Clear cache so we load current schema after Phase A
    const modelPath = require.resolve("../model/itemTrack");
    delete require.cache[modelPath];
    const ItemTrack = require("../model/itemTrack");
    const imeiPath = ItemTrack.schema.path("imei");
    if (imeiPath?.options?.unique === true) {
        console.error("BLOCKED: schema still has imei unique:true");
        await mongoose.disconnect();
        process.exit(2);
    }
    const schemaIndexes = ItemTrack.schema.indexes();
    const schemaHasGlobalUniqueImei = schemaIndexes.some(([fields, opts]) => {
        const keys = Object.keys(fields || {});
        return (
            keys.length === 1 &&
            keys[0] === "imei" &&
            fields.imei === 1 &&
            opts &&
            opts.unique === true
        );
    });
    if (schemaHasGlobalUniqueImei) {
        console.error("BLOCKED: schema.index declares unique imei");
        await mongoose.disconnect();
        process.exit(2);
    }
    console.log("SCHEMA_SAFETY", {
        imeiUniqueOption: imeiPath?.options?.unique ?? null,
        schemaHasGlobalUniqueImei: false,
    });

    // ---- MIGRATION ----
    let dropped = false;
    let created = false;
    try {
        await it.dropIndex(OLD_NAME);
        dropped = true;
        const mid = await it.indexes();
        if (mid.some((i) => i.name === OLD_NAME)) {
            throw new Error("imei_1 still present after dropIndex");
        }
        console.log("DROPPED", OLD_NAME);

        // MongoDB partial indexes do not support $ne; use explicit non-deleted enum.
        await it.createIndex(
            { companyId: 1, imei: 1 },
            {
                unique: true,
                name: TARGET_NAME,
                partialFilterExpression: {
                    companyId: { $type: "objectId" },
                    status: {
                        $in: [
                            "available",
                            "in-transit",
                            "sold",
                            "repairing",
                        ],
                    },
                },
            }
        );
        created = true;
        console.log("CREATED", TARGET_NAME);
    } catch (err) {
        console.error("MIGRATION_ERROR", err.message || err);
        // Rollback: if dropped but not created, restore imei_1
        const now = await it.indexes();
        const hasOld = now.some((i) => i.name === OLD_NAME);
        const hasNew = now.some((i) => i.name === TARGET_NAME);
        console.log("ROLLBACK_STATE", { dropped, created, hasOld, hasNew });
        if (dropped && !created && !hasOld) {
            console.log("ROLLBACK: restoring imei_1");
            await it.createIndex(
                { imei: 1 },
                { unique: true, name: OLD_NAME, background: true }
            );
            console.log("ROLLBACK: imei_1 restored");
        }
        await mongoose.disconnect();
        process.exit(1);
    }

    // ---- POST VERIFY ----
    const afterIndexes = await it.indexes();
    const target = afterIndexes.find((i) => i.name === TARGET_NAME);
    const afterCount = await it.countDocuments();

    console.log(
        "AFTER_INDEXES",
        JSON.stringify(afterIndexes.map(summarizeIndex), null, 2)
    );
    console.log(
        "POST",
        JSON.stringify(
            {
                itemTrackCount: afterCount,
                imei_1: afterIndexes.some((i) => i.name === OLD_NAME),
                companyId_1_imei_1: !!target,
                target: target ? summarizeIndex(target) : null,
            },
            null,
            2
        )
    );

    const pfe = target?.partialFilterExpression;
    const expectedStatuses = [
        "available",
        "in-transit",
        "sold",
        "repairing",
    ];
    const actualIn = Array.isArray(pfe?.status?.$in)
        ? [...pfe.status.$in].sort()
        : null;
    const pfeOk =
        target &&
        target.unique === true &&
        target.key &&
        target.key.companyId === 1 &&
        target.key.imei === 1 &&
        pfe &&
        pfe.companyId &&
        pfe.companyId.$type === "objectId" &&
        actualIn &&
        JSON.stringify(actualIn) ===
            JSON.stringify([...expectedStatuses].sort());

    if (
        afterCount !== 0 ||
        afterIndexes.some((i) => i.name === OLD_NAME) ||
        !target ||
        !pfeOk
    ) {
        console.error("FAILED: post-verification mismatch");
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log("PHASE_D_OK");
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
