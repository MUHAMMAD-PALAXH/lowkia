/**
 * Read-time presentation of ledger rows: business document, payment status,
 * payment method, plain movement type and per-bucket quantity change.
 * Ledger rows are immutable, so values that change later (payment status)
 * are resolved from the source document when the row is read.
 */
const mongoose = require("mongoose");
const { companyFilter } = require("../utils/tenantScope");

const DOCS = {
    SalesOrder: {
        model: "../model/salesOrder",
        fields: "orderNumber status paymentStatus paymentMethod",
        label: "Sales Order",
        number: (d) => d.orderNumber,
    },
    CompanyOrder: {
        model: "../model/marketplace/companyOrder",
        fields: "orderNumber status deliveredAt masterOrderId",
        label: "Online Order",
        number: (d) => d.orderNumber,
    },
    Order: {
        model: "../model/order",
        fields: "orderNumber orderStatus paymentMethod",
        label: "Online Order",
        number: (d) => d.orderNumber,
    },
    RepairTicket: {
        model: "../model/repairTicket",
        fields: "ticketNumber status paymentStatus paymentMethod",
        label: "Repair Ticket",
        number: (d) => d.ticketNumber,
    },
    SalesReturn: {
        model: "../model/salesReturn",
        fields: "returnNumber status refundStatus refundMethod",
        label: "Sales Return",
        number: (d) => d.returnNumber,
    },
    PurchaseOrder: {
        model: "../model/purchaseOrder",
        fields: "purchaseOrderNo paymentStatus",
        label: "Purchase Order",
        number: (d) => d.purchaseOrderNo,
    },
    Grn: {
        model: "../model/grn",
        fields: "grnNumber",
        label: "GRN",
        number: (d) => d.grnNumber,
    },
};

/** StockMovement.referenceType → document kind (or a label when there is no document). */
const STOCK_REFERENCE = {
    "Sales Order": "SalesOrder",
    "Marketplace Order": "CompanyOrder",
    "Sales Return": "SalesReturn",
    "Purchase Order": "PurchaseOrder",
    GRN: "Grn",
};
const STOCK_REFERENCE_LABEL = {
    "Sales Invoice": "Sales Invoice",
    "Purchase Invoice": "Purchase Invoice",
    "Purchase Return": "Purchase Return",
    "Stock Transfer": "Stock Transfer",
    "Stock Adjustment": "Stock Adjustment",
    "Opening Balance": "Opening Stock",
    Manual: "Manual",
};

const MODULE_LABEL = {
    Sales: "Sales Order",
    Repair: "Repair Ticket",
    Return: "Sales Return",
    Adjustment: "Stock Adjustment",
};

const METHOD_LABEL = {
    CASH: "Cash",
    CARD: "Card",
    APPLE_PAY: "Apple Pay",
    ACH: "ACH",
    CHECK: "Check",
    MOBILE_BANKING: "Mobile banking",
    BANK_TRANSFER: "Bank transfer",
    ONLINE_GATEWAY: "Online payment",
    CREDIT_ADJUSTMENT: "Credit",
    OTHER: "Other",
    // checkout methods
    card: "Card",
    mobile_wallet: "Mobile wallet",
    bank_transfer: "Bank transfer",
    gateway: "Online payment",
    other: "Other",
};
const PROVIDER_LABEL = {
    CLOVER: "Clover",
    STRIPE: "Stripe",
    stripe: "Stripe",
    sslcommerz: "SSLCommerz",
    bkash: "bKash",
    nagad: "Nagad",
};
const REPAIR_METHOD_LABEL = { CashOnDelivery: "Cash", Bank: "Bank" };

const TYPE_LABEL = {
    ordered: "Ordered",
    completed: "Completed",
    cancelled: "Cancelled",
    reserved: "Reserved",
    released: "Released",
    sold: "Sold",
    returned: "Returned",
    received: "Received",
    purchased: "Purchased",
    purchase_reduced: "Purchase reduced",
    returned_to_supplier: "Returned to supplier",
    payment_in: "Payment received",
    payment_out: "Payment made",
    refunded: "Refunded",
    payment_reversed: "Payment reversed",
    transfer: "Transfer",
    opening: "Opening stock",
    stock_in: "Stock added",
    stock_out: "Stock removed",
    damaged: "Damaged",
};

const PAYMENT_OUT_TYPES = new Set([
    "supplier_payment",
    "supplier_advance",
    "salary_payment",
    "employee_advance",
    "employee_bonus",
    "employee_payment",
    "expense_payment",
]);

const toOid = (v) => {
    const raw = v?._id || v;
    return raw && mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
};

const movementTypeOf = (row) =>
    row.metadata?.movementType || String(row.description || "").split(":")[0].trim();

/** Marketplace hold rows, including ones posted as plain adjustments before dedicated types existed. */
const reservationKind = (row) => {
    if (row.transactionType === "stock_reserved") return "reserved";
    if (row.transactionType === "stock_released") return "released";
    const desc = String(row.description || "");
    if (row.sourceType !== "StockMovement" || !desc.includes("Marketplace reservation")) return null;
    return desc.includes("reservation release") ? "released" : "reserved";
};

const kindOf = (row) => {
    const held = reservationKind(row);
    if (held) return held;
    const t = row.transactionType;
    const mt = movementTypeOf(row);
    switch (t) {
        case "sale":
        case "online_sale":
        case "repair_order":
            return "ordered";
        case "repair_charge":
            return "completed";
        case "sale_reversal":
        case "online_sale_reversal":
        case "repair_charge_reversal":
            return "cancelled";
        case "purchase":
            return "purchased";
        case "purchase_reversal":
            return "purchase_reduced";
        case "sales_return":
            return "returned";
        case "customer_payment":
        case "online_payment":
        case "repair_payment":
            return "payment_in";
        case "other_payment":
            return row.direction === "in" ? "payment_in" : "payment_out";
        case "customer_refund":
        case "online_refund":
            return "refunded";
        case "payment_reversal":
            return "payment_reversed";
        case "stock_transfer":
        case "branch_transfer":
            return "transfer";
        case "stock_out":
            if (mt === "Sale") return "sold";
            if (mt === "Purchase Return") return "returned_to_supplier";
            return "stock_out";
        case "stock_in":
            if (mt === "Sales Return") return "returned";
            if (mt === "Purchase") return "received";
            if (mt === "Opening Stock") return "opening";
            return "stock_in";
        case "adjustment":
            if (mt === "Damage") return "damaged";
            return row.direction === "in" ? "stock_in" : "stock_out";
        default:
            return PAYMENT_OUT_TYPES.has(t) ? "payment_out" : "";
    }
};

/** Change to available / reserved / sold counts caused by one stock movement row. */
const qtyChange = (row, kind) => {
    const zero = { available: 0, reserved: 0, sold: 0 };
    if (row.sourceType !== "StockMovement") return zero;
    const q = Number(row.quantity) || 0;
    const sign = row.direction === "in" ? 1 : -1;
    switch (kind) {
        case "reserved":
            return { available: -q, reserved: q, sold: 0 };
        case "released":
            return { available: q, reserved: -q, sold: 0 };
        case "sold":
            return String(row.description || "").includes("reserved→out")
                ? { available: 0, reserved: -q, sold: q }
                : { available: -q, reserved: 0, sold: q };
        case "returned":
            return { available: q, reserved: 0, sold: -q };
        default:
            return { available: sign * q, reserved: 0, sold: 0 };
    }
};

/** Which business document a row belongs to. */
const docRefOf = (row) => {
    if (DOCS[row.sourceType]) return { kind: row.sourceType, id: row.sourceId };
    const related = row.relatedDocuments || [];
    const find = (...types) => related.find((d) => types.includes(d.type) && d.id);
    let hit = null;
    if (row.sourceType === "SupplierPayable") hit = find("PurchaseOrder");
    else if (row.sourceType === "MarketplaceRefund") hit = find("CompanyOrder");
    else if (row.sourceType === "Payment") hit = find("SalesOrder", "RepairTicket", "SalesReturn", "PurchaseOrder");
    else if (row.sourceType === "StockMovement") {
        const ref = related.find((d) => d.type !== "StockMovement");
        if (ref && STOCK_REFERENCE[ref.type] && ref.id) {
            return { kind: STOCK_REFERENCE[ref.type], id: ref.id, number: ref.number };
        }
        return ref ? { label: STOCK_REFERENCE_LABEL[ref.type] || "" } : null;
    }
    return hit ? { kind: hit.type, id: hit.id, number: hit.number } : null;
};

const methodLabel = (method, provider) => {
    const m = METHOD_LABEL[method] || "";
    const p = PROVIDER_LABEL[provider] || "";
    if (p && m) return `${p} (${m})`;
    return m || p;
};

const paymentStatusOf = (kind, doc, checkout) => {
    if (!doc) return "";
    switch (kind) {
        case "SalesOrder":
            if (doc.status === "Cancelled") return "";
            return { Paid: "paid", Partial: "partially_paid", Refunded: "refunded", Pending: "due" }[doc.paymentStatus] || "";
        case "RepairTicket":
            if (doc.status === "Cancelled") return "";
            return { Paid: "paid", Partial: "partially_paid", Unpaid: "due" }[doc.paymentStatus] || "";
        case "SalesReturn":
            if (["Completed", "Processed"].includes(doc.refundStatus)) return "refunded";
            return doc.refundStatus === "Pending" ? "refund_due" : "";
        case "PurchaseOrder":
            return { Paid: "paid", Partial: "partially_paid", Pending: "due" }[doc.paymentStatus] || "";
        case "Order":
            if (doc.orderStatus === "cancelled") return "";
            if (doc.paymentMethod === "prepaid") return "paid";
            return doc.orderStatus === "delivered" ? "paid" : "due";
        case "CompanyOrder": {
            if (checkout?.status === "refunded") return "refunded";
            if (checkout?.status === "partially_refunded") return "partially_refunded";
            if (["cancelled", "refunded"].includes(doc.status)) return "";
            if (checkout?.paymentMethod === "cod") return doc.deliveredAt ? "paid" : "due";
            return checkout?.status === "successful" ? "paid" : "due";
        }
        default:
            return "";
    }
};

const docMethodOf = (kind, doc, checkout) => {
    if (!doc) return "";
    switch (kind) {
        case "SalesOrder":
            return doc.paymentMethod || "";
        case "RepairTicket":
            return REPAIR_METHOD_LABEL[doc.paymentMethod] || "";
        case "SalesReturn":
            return doc.refundMethod || "";
        case "Order":
            return { cod: "COD", prepaid: "Prepaid" }[doc.paymentMethod] || "";
        case "CompanyOrder":
            if (!checkout) return "";
            if (checkout.paymentMethod === "cod") return "COD";
            return methodLabel(checkout.paymentMethod, checkout.paymentProvider);
        default:
            return "";
    }
};

const CHECKOUT_RANK = { successful: 0, partially_refunded: 1, refunded: 2, processing: 3, pending: 4 };

const loadDocs = async (companyId, refs) => {
    const byKind = {};
    for (const ref of refs) {
        const id = toOid(ref?.id);
        if (!ref?.kind || !id) continue;
        if (!byKind[ref.kind]) byKind[ref.kind] = new Map();
        byKind[ref.kind].set(String(id), id);
    }
    const docs = {};
    await Promise.all(
        Object.entries(byKind).map(async ([kind, ids]) => {
            const spec = DOCS[kind];
            const list = await require(spec.model)
                .find({ _id: { $in: [...ids.values()] }, ...companyFilter(companyId) })
                .select(spec.fields)
                .lean();
            for (const d of list) docs[`${kind}:${d._id}`] = d;
        })
    );

    const masterIds = Object.entries(docs)
        .filter(([key, d]) => key.startsWith("CompanyOrder:") && d.masterOrderId)
        .map(([, d]) => d.masterOrderId);
    const checkouts = {};
    if (masterIds.length) {
        const rows = await require("../model/marketplace/checkoutPayment")
            .find({ masterOrderId: { $in: masterIds }, isDeleted: { $ne: true } })
            .select("masterOrderId paymentMethod paymentProvider status")
            .lean();
        for (const c of rows) {
            const key = String(c.masterOrderId);
            const prev = checkouts[key];
            if (!prev || (CHECKOUT_RANK[c.status] ?? 9) < (CHECKOUT_RANK[prev.status] ?? 9)) {
                checkouts[key] = c;
            }
        }
    }
    return { docs, checkouts };
};

/** Adds display fields to lean ledger rows (in place) and returns them. */
const presentRows = async (companyId, rows = []) => {
    if (!rows.length) return rows;
    const refs = rows.map(docRefOf);
    const { docs, checkouts } = await loadDocs(companyId, refs);

    rows.forEach((row, i) => {
        const ref = refs[i];
        const doc = ref?.kind ? docs[`${ref.kind}:${toOid(ref.id)}`] : null;
        const checkout = doc?.masterOrderId ? checkouts[String(doc.masterOrderId)] : null;
        const kind = kindOf(row);

        row.typeKey = kind;
        row.typeLabel = TYPE_LABEL[kind] || String(row.transactionType || "").replace(/_/g, " ");
        row.sourceLabel =
            (ref?.kind && DOCS[ref.kind].label) ||
            ref?.label ||
            MODULE_LABEL[row.sourceModule] ||
            row.sourceModule ||
            "";
        row.documentNumber =
            (doc && DOCS[ref.kind].number(doc)) || ref?.number || row.sourceNumber || "";

        let status = paymentStatusOf(ref?.kind, doc, checkout);
        if (!status && row.sourceType === "Payment" && kind !== "payment_reversed") status = "paid";
        row.paymentStatus = status;

        // A payment row shows how that payment was made; other rows show the document's method.
        const own =
            row.sourceType === "Payment" || kind === "payment_in" || kind === "refunded"
                ? methodLabel(row.paymentMethod, row.paymentProvider)
                : "";
        const fromDoc = docMethodOf(ref?.kind, doc, checkout);
        row.paymentWay =
            ref?.kind === "CompanyOrder" || ref?.kind === "Order"
                ? fromDoc || own
                : own || fromDoc || methodLabel(row.paymentMethod, row.paymentProvider);

        row.qtyChange = qtyChange(row, kind);
    });
    return rows;
};

module.exports = { presentRows, kindOf, qtyChange };
