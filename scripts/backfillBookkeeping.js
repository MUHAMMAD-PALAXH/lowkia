/**
 * Backfill the BookkeepingEntry ledger from existing business history.
 *
 *   node scripts/backfillBookkeeping.js                 # dry run (default, no writes)
 *   node scripts/backfillBookkeeping.js --execute       # write entries
 *   node scripts/backfillBookkeeping.js --company=<id>  # one tenant only
 *   node scripts/backfillBookkeeping.js --only=Payment,SalesOrder
 *
 * Idempotent: uses the same keys as the live hooks, so re-running never
 * duplicates rows. Never deletes or modifies business documents.
 * Run during low traffic (sales-order paid-gap check reads in-flight payments).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const sync = require("../services/bookkeepingSyncService");
const {
    syncTarget,
    round2,
    dryRunStats,
} = require("../services/bookkeepingPostingService");

const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? true];
    })
);
const dryRun = !args.execute;
const only = args.only ? String(args.only).split(",") : null;
const companyId =
    args.company && mongoose.isValidObjectId(args.company)
        ? new mongoose.Types.ObjectId(String(args.company))
        : null;

// Order matters: payments before sales orders (paid-gap), refunds after company orders.
const SOURCES = [
    ["Payment", "../model/payment", sync.syncPayment],
    ["SalesOrder", "../model/salesOrder", sync.syncSalesOrder],
    ["SupplierPayable", "../model/supplierPayable", sync.syncSupplierPayable],
    ["SalesReturn", "../model/salesReturn", sync.syncSalesReturn],
    ["RepairTicket", "../model/repairTicket", sync.syncRepairTicket],
    ["CompanyOrder", "../model/marketplace/companyOrder", sync.syncCompanyOrder],
    ["MarketplaceRefund", "../model/marketplace/refund", sync.syncMarketplaceRefund],
    ["Order", "../model/order", sync.syncLegacyOrder],
    ["StockMovement", "../model/StockMovement", sync.syncStockMovement],
    ["BranchTransfer", "../model/branchTransfer", sync.syncBranchTransfer],
];

/**
 * Historical SOs may carry paidAmount set at create/edit time without a Payment
 * row. Backfill-only: the live flow always records Payment rows (mark-paid).
 */
const syncSalesOrderPaidGap = async (order, { dryRun: dry }) => {
    if (!order.companyId || order.isDeleted) return null;
    const paid = Number(order.paidAmount) || 0;
    if (paid <= 0) return null;
    const CompanyOrder = require("../model/marketplace/companyOrder");
    if (await CompanyOrder.exists({ salesOrderId: order._id })) return null;
    const Payment = require("../model/payment");
    const rows = await Payment.find({
        salesOrderId: order._id,
        paymentType: "CustomerPayment",
        status: { $in: ["paid", "reversed"] },
        isDeleted: { $ne: true },
    })
        .select("amount")
        .lean();
    const tracked = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const gap = Math.max(round2(paid - tracked), 0);
    const method = sync.normalizeMethod(order.paymentMethod);
    const lane = method === "CASH" ? "CASH" : "BANK";
    return syncTarget({
        companyId: order.companyId,
        sourceId: order._id,
        transactionType: "customer_payment",
        keyPrefix: "so-paid-gap",
        target: gap,
        dryRun: dry,
        build: async ({ amount, sign }) => ({
            branchId: order.branchId || null,
            warehouseId: order.warehouseId || null,
            transactionDate: order.stockUpdatedAt || order.orderDate || order.createdAt || new Date(),
            sourceModule: "Sales",
            sourceType: "SalesOrder",
            sourceNumber: order.orderNumber || "",
            relatedDocuments: [{ type: "SalesOrder", id: order._id, number: order.orderNumber || "" }],
            description: `Payment recorded on ${order.orderNumber || "sales order"} (no payment document)`,
            partyType: "Customer",
            partyId: order.customerId || null,
            partyName: order.customerName || "",
            account: lane,
            direction: sign > 0 ? "in" : "out",
            effects: [
                { account: lane, amount: sign * amount },
                { account: "RECEIVABLE", amount: -sign * amount },
            ],
            paymentMethod: method,
            metadata: { backfill: true },
        }),
    });
};

const run = async () => {
    if (!process.env.MONGO_URL) {
        console.error("MONGO_URL is not set.");
        process.exit(1);
    }
    // Dry run must be strictly read-only — no index/collection creation either.
    if (dryRun) {
        mongoose.set("autoIndex", false);
        mongoose.set("autoCreate", false);
    }
    await mongoose.connect(process.env.MONGO_URL);
    console.log(`[bookkeeping backfill] mode=${dryRun ? "DRY RUN" : "EXECUTE"}${companyId ? ` company=${companyId}` : ""}`);

    const report = {};
    for (const [kind, modelPath, handler] of SOURCES) {
        if (only && !only.includes(kind)) continue;
        const Model = require(modelPath);
        const filter = companyId ? { companyId } : { companyId: { $ne: null } };
        const stats = { scanned: 0, errors: 0 };
        report[kind] = stats;

        const cursor = Model.find(filter).sort({ createdAt: 1 }).lean().cursor();
        for await (const doc of cursor) {
            stats.scanned += 1;
            try {
                await handler(doc, { dryRun });
                if (kind === "SalesOrder") await syncSalesOrderPaidGap(doc, { dryRun });
            } catch (err) {
                stats.errors += 1;
                if (stats.errors <= 5) {
                    console.error(`  ${kind} ${doc._id}: ${err?.message || err}`);
                }
            }
        }
        console.log(`  ${kind}: scanned=${stats.scanned} errors=${stats.errors}`);
    }

    const BookkeepingEntry = require("../model/bookkeepingEntry");
    const total = await BookkeepingEntry.countDocuments(companyId ? { companyId } : {});
    if (dryRun) {
        console.log(`[bookkeeping backfill] would create ${dryRunStats.wouldPost} row(s):`);
        for (const [type, n] of Object.entries(dryRunStats.byType)) {
            console.log(`    ${type}: ${n}`);
        }
    }
    console.log(`[bookkeeping backfill] ledger rows now: ${total}${dryRun ? " (dry run — nothing written)" : ""}`);
    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error("[bookkeeping backfill] failed:", err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
