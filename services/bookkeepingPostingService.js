const mongoose = require("mongoose");
const BookkeepingEntry = require("../model/bookkeepingEntry");
const Counter = require("../model/counter");
const { CASH_ACCOUNTS } = require("../constants/bookkeeping");

/**
 * Core ledger writer. Only backend business hooks call this — never HTTP input.
 * - postEntry: one-shot, idempotent per (companyId, idempotencyKey)
 * - syncTarget: posts the delta between a source document's current value and
 *   what the ledger already holds (adjustments/reversals, never edits)
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Backfill dry-run counters (never touched by live hooks, which don't dry-run). */
const dryRunStats = { wouldPost: 0, byType: {} };

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (value?._id) return toObjectId(value._id);
    return mongoose.isValidObjectId(value)
        ? new mongoose.Types.ObjectId(String(value))
        : null;
};

const withSession = (query, session) => (session ? query.session(session) : query);

// Outside any transaction on purpose: one hot per-company counter inside many
// concurrent business transactions would cause write conflicts. Gaps are OK.
const nextEntryNumber = async (companyId) => {
    const counter = await Counter.findOneAndUpdate(
        { module: `bookkeeping_${String(companyId)}` },
        { $inc: { lastNumber: 1 }, $setOnInsert: { prefix: "BK", padding: 6 } },
        { upsert: true, new: true }
    ).lean();
    return `BK-${String(counter.lastNumber).padStart(counter.padding || 6, "0")}`;
};

const buildSearchText = (entry) =>
    [
        entry.entryNumber,
        entry.sourceNumber,
        entry.partyName,
        entry.productName,
        entry.sku,
        entry.description,
        entry.paymentReference,
        ...(entry.imeis || []),
        ...(entry.relatedDocuments || []).map((d) => d.number),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .slice(0, 2000);

const normalizeEffects = (effects = []) =>
    effects
        .map((e) => ({ account: e.account, amount: round2(e.amount) }))
        .filter((e) => e.account && e.amount !== 0);

const cashTotals = (effects) => {
    let cashIn = 0;
    let cashOut = 0;
    for (const e of effects) {
        if (!CASH_ACCOUNTS.includes(e.account)) continue;
        if (e.amount > 0) cashIn += e.amount;
        else cashOut += -e.amount;
    }
    return { cashIn: round2(cashIn), cashOut: round2(cashOut) };
};

const postEntry = async (data, { session = null, dryRun = false } = {}) => {
    const companyId = toObjectId(data.companyId);
    if (!companyId || !data.idempotencyKey || !data.sourceId) return null;

    const existing = await withSession(
        BookkeepingEntry.findOne({ companyId, idempotencyKey: data.idempotencyKey })
            .select("_id")
            .lean(),
        session
    );
    if (existing) return null;
    if (dryRun) {
        dryRunStats.wouldPost += 1;
        dryRunStats.byType[data.transactionType] =
            (dryRunStats.byType[data.transactionType] || 0) + 1;
        return { dryRun: true, ...data };
    }

    const effects = normalizeEffects(data.effects);
    const { cashIn, cashOut } = cashTotals(effects);
    const entryNumber = await nextEntryNumber(companyId);

    const doc = new BookkeepingEntry({
        ...data,
        companyId,
        amount: round2(Math.abs(Number(data.amount) || 0)),
        netAmount: round2(data.netAmount),
        effects,
        cashIn,
        cashOut,
        entryNumber,
        transactionDate: data.transactionDate || new Date(),
    });
    doc.searchText = buildSearchText(doc);
    const invalid = doc.validateSync();
    if (invalid) throw invalid;

    const result = await BookkeepingEntry.updateOne(
        { companyId, idempotencyKey: data.idempotencyKey },
        { $setOnInsert: doc.toObject() },
        { upsert: true, session: session || undefined }
    );
    return result.upsertedCount ? doc.toObject() : null;
};

/**
 * Bring the ledger for (sourceId, type) up to `target`.
 * build({ amount, sign }) returns the entry body; sign is +1 (post) / -1 (reverse).
 */
const syncTarget = async ({
    companyId,
    sourceId,
    transactionType,
    reversalType = transactionType,
    keyPrefix,
    target,
    build,
    session = null,
    dryRun = false,
}) => {
    const cid = toObjectId(companyId);
    const sid = toObjectId(sourceId);
    if (!cid || !sid) return null;

    const rows = await withSession(
        BookkeepingEntry.find({
            companyId: cid,
            sourceId: sid,
            transactionType: { $in: [transactionType, reversalType] },
        })
            .select("netAmount status")
            .lean(),
        session
    );
    const posted = round2(
        rows
            .filter((r) => r.status !== "voided")
            .reduce((sum, r) => sum + (Number(r.netAmount) || 0), 0)
    );
    const delta = round2((Number(target) || 0) - posted);
    if (Math.abs(delta) < 0.01) return null;

    const sign = delta > 0 ? 1 : -1;
    const body = await build({ amount: Math.abs(delta), sign, posted });
    if (!body) return null;

    return postEntry(
        {
            ...body,
            companyId: cid,
            sourceId: sid,
            transactionType: sign > 0 ? transactionType : reversalType,
            netAmount: delta,
            amount: Math.abs(delta),
            isReversal: sign < 0,
            idempotencyKey: `${keyPrefix}:${sid}:${rows.length + 1}`,
        },
        { session, dryRun }
    );
};

/** Void rows for a business event that did not actually complete. */
const voidEntries = async ({
    companyId,
    sourceId,
    keyPrefix = null,
    reason = "",
    actorId = null,
    session = null,
}) => {
    const cid = toObjectId(companyId);
    const sid = toObjectId(sourceId);
    if (!cid || !sid) return 0;
    const filter = { companyId: cid, sourceId: sid, status: { $ne: "voided" } };
    if (keyPrefix) filter.idempotencyKey = { $regex: `^${keyPrefix}:` };
    const stamp = String(Date.now());
    const result = await BookkeepingEntry.updateMany(
        filter,
        [
            {
                $set: {
                    status: "voided",
                    voidedAt: "$$NOW",
                    voidedBy: toObjectId(actorId),
                    voidReason: String(reason || "").slice(0, 500),
                    // Frees the key so a later successful retry can post again.
                    idempotencyKey: {
                        $concat: ["$idempotencyKey", ":void:", stamp],
                    },
                },
            },
        ],
        { session: session || undefined }
    );
    return result.modifiedCount || 0;
};

const markStatus = async ({ companyId, idempotencyKey, status, session = null }) => {
    const cid = toObjectId(companyId);
    if (!cid || !idempotencyKey) return;
    await BookkeepingEntry.updateOne(
        { companyId: cid, idempotencyKey, status: "completed" },
        { $set: { status } },
        { session: session || undefined }
    );
};

module.exports = {
    dryRunStats,
    round2,
    toObjectId,
    postEntry,
    syncTarget,
    voidEntries,
    markStatus,
};
