/**
 * Posts ledger rows after a business document is saved.
 * Runs inside the caller's session when there is one, so an aborted business
 * transaction leaves no ledger row behind. Never throws into the business flow.
 */

const WATCHED_PATHS = {
    Payment: ["status", "isDeleted"],
    SalesOrder: ["stockUpdated", "isDeleted", "status", "grandTotal"],
    SupplierPayable: ["grnReceivedValueMinor", "isDeleted"],
    SalesReturn: ["status", "isDeleted", "subtotal", "refundAmount", "refundMethod"],
    RepairTicket: ["status", "isDeleted", "totalAmount", "paidAmount"],
    CompanyOrder: ["status", "isDeleted", "totals", "deliveredAt"],
    MarketplaceRefund: ["status"],
    Order: ["orderStatus", "totalPrice"],
    StockMovement: [],
    BranchTransfer: ["status"],
};

function bookkeepingPlugin(schema, { kind } = {}) {
    const paths = WATCHED_PATHS[kind];
    if (!paths) throw new Error(`bookkeepingPlugin: unknown kind "${kind}"`);

    schema.pre("save", function markForLedger(next) {
        this.$locals.bookkeepingSync =
            this.isNew || paths.some((p) => this.isModified(p));
        next();
    });

    schema.post("save", async function postToLedger(doc) {
        if (!doc?.$locals?.bookkeepingSync) return;
        doc.$locals.bookkeepingSync = false;
        // Staff user behind this save; callers set it before save() when known.
        const actorId = doc.$locals.bookkeepingActorId || null;
        doc.$locals.bookkeepingActorId = null;
        try {
            const { syncDocument } = require("../../services/bookkeepingSyncService");
            await syncDocument(kind, doc, { session: doc.$session() || null, actorId });
        } catch (err) {
            console.error(`[bookkeeping] ${kind} ${doc._id} sync failed:`, err?.message || err);
        }
    });
}

module.exports = bookkeepingPlugin;
