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
        fields: "orderNumber status paymentStatus paymentMethod grandTotal paidAmount",
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

/**
 * Quantity buckets: stock = on hand before the row's sale (a sale shows under sold,
 * not as a stock change), reserved = held for online orders, sold = units that left
 * through a sale, available = on hand − reserved.
 */
const change = (onHand, reserved, sold) => ({
    stock: onHand + sold,
    reserved,
    sold,
    available: onHand - reserved,
});

/** Change caused by one stock movement row. */
const qtyChange = (row, kind) => {
    if (row.sourceType !== "StockMovement") return change(0, 0, 0);
    const q = Number(row.quantity) || 0;
    const sign = row.direction === "in" ? 1 : -1;
    switch (kind) {
        case "reserved":
            return change(0, q, 0);
        case "released":
            return change(0, -q, 0);
        case "sold":
            return String(row.description || "").includes("reserved→out")
                ? change(-q, -q, q)
                : change(-q, 0, q);
        case "returned":
            return change(q, 0, -q);
        default:
            return change(sign * q, 0, 0);
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

const stockKey = (m) => `${m.warehouseId}|${m.productId}|${m.productVariantId || ""}`;

const MOVEMENT_FIELDS =
    "previousStock currentStock warehouseId productId productVariantId movementType movementDirection quantity remarks referenceType referenceId salesOrderId productName sku serialNumbers movementDate createdAt";

const isFromReservation = (m) => String(m.remarks || "").includes("reserved→out");

/**
 * Reserved units on the same inventory row right after each movement.
 * Only online-order holds change reservedStock, and each writes a movement:
 * hold (Adjustment OUT) +q, release (Adjustment IN) −q, ship from hold (Sale reserved→out) −q.
 */
const bucketBalances = async (companyId, movements, StockMovement) => {
    const result = new Map();
    const keyed = movements.filter((m) => m.warehouseId && m.productId);
    if (!keyed.length) return result;
    const maxId = keyed.reduce((max, m) => (String(m._id) > String(max) ? m._id : max), keyed[0]._id);
    const holds = await StockMovement.find({
        ...companyFilter(companyId),
        referenceType: "Marketplace Order",
        productId: { $in: [...new Set(keyed.map((m) => String(m.productId)))].map(toOid) },
        warehouseId: { $in: [...new Set(keyed.map((m) => String(m.warehouseId)))].map(toOid) },
        _id: { $lte: maxId },
    })
        .select("warehouseId productId productVariantId movementType movementDirection quantity remarks")
        .sort({ _id: 1 })
        .lean();

    const byKey = new Map();
    for (const h of holds) {
        const q = Number(h.quantity) || 0;
        let delta = 0;
        if (h.movementType === "Adjustment") delta = h.movementDirection === "OUT" ? q : -q;
        else if (h.movementType === "Sale" && isFromReservation(h)) delta = -q;
        if (!delta) continue;
        const key = stockKey(h);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ id: String(h._id), delta });
    }
    for (const m of keyed) {
        let reserved = 0;
        for (const h of byKey.get(stockKey(m)) || []) {
            if (h.id > String(m._id)) break;
            reserved = Math.max(reserved + h.delta, 0);
        }
        result.set(String(m._id), { reserved });
    }
    return result;
};

/** stock = on hand before this row's sale (on hand after + units this row sold). */
const balanceOf = (m, buckets, soldInRow = 0) => {
    const onHand = Number(m.currentStock) || 0;
    const reserved = buckets?.reserved || 0;
    return {
        stock: onHand + soldInRow,
        reserved,
        available: Math.max(onHand - reserved, 0),
    };
};

/** Quantity change of an order's own stock movement (sales order stock-out / online-order hold). */
const orderMovementChange = (m) => {
    const q = Number(m.quantity) || 0;
    if (m.movementType === "Sale") return isFromReservation(m) ? change(-q, -q, q) : change(-q, 0, q);
    if (m.referenceType === "Marketplace Order") {
        return m.movementDirection === "OUT" ? change(0, q, 0) : change(0, -q, 0);
    }
    return change(q, 0, -q);
};

const isOnlineOrderRow = (row) =>
    row.sourceType === "CompanyOrder" && ["online_sale", "online_sale_reversal"].includes(row.transactionType);

const sumChanges = (lines) =>
    lines.reduce(
        (acc, l) => ({
            stock: acc.stock + l.qtyChange.stock,
            reserved: acc.reserved + l.qtyChange.reserved,
            sold: acc.sold + l.qtyChange.sold,
            available: acc.available + l.qtyChange.available,
        }),
        { stock: 0, reserved: 0, sold: 0, available: 0 }
    );

/** Puts a sales order's product lines on its ledger row (one row per order event). */
const applyLines = (row, lines) => {
    if (!lines.length) return;
    const first = lines[0];
    row.lines = lines;
    if (!row.productName) {
        row.productName =
            lines.length > 1 ? `${first.productName} +${lines.length - 1} more` : first.productName;
    }
    if (!row.sku && lines.length === 1) row.sku = first.sku;
    if (!Number(row.quantity)) row.quantity = lines.reduce((n, l) => n + l.quantity, 0);
    if (!row.imeis?.length) row.imeis = lines.flatMap((l) => l.imeis || []);
    row.qtyChange = sumChanges(lines);
    if (lines.length === 1) {
        row.balanceAfter = first.balanceAfter;
        if (first.stockBefore !== undefined) {
            row.stockBefore = first.stockBefore;
            row.stockAfter = first.stockAfter;
        }
    }
};

const timeOf = (v) => new Date(v || 0).getTime();
const ORDER_ROW_WINDOW_MS = 5 * 60 * 1000;
/** Payments posted right after the stock-out belong to the same counter checkout. */
const SAME_CHECKOUT_MS = 10 * 1000;

/**
 * Sales-order payment status as it was when the row was posted: ledger payments
 * up to that moment, plus any paid amount the ledger never recorded (legacy orders).
 */
const orderStatusAt = (doc, payments, cutoff) => {
    if (!doc || doc.status === "Cancelled") return "";
    const ledgerPaid = payments.reduce((n, p) => n + p.net, 0);
    const untracked = Math.max((Number(doc.paidAmount) || 0) - ledgerPaid, 0);
    const paid = untracked + payments.filter((p) => p.at <= cutoff).reduce((n, p) => n + p.net, 0);
    if (paid >= (Number(doc.grandTotal) || 0) - 0.009) return "paid";
    return paid > 0.009 ? "partially_paid" : "due";
};

/** Stock rows written by the product add/edit form (productService remarks end in "product save"). */
const isProductFormRow = (row) =>
    row.sourceType === "StockMovement" && /product save/i.test(row.description || "");

/** Adds display fields to lean ledger rows (in place) and returns them. */
const presentRows = async (companyId, rows = []) => {
    if (!rows.length) return rows;
    const refs = rows.map(docRefOf);
    const movementIds = rows
        .filter((r) => r.sourceType === "StockMovement")
        .map((r) => toOid(r.sourceId))
        .filter(Boolean);
    const productIds = rows
        .filter(isProductFormRow)
        .map((r) => toOid(r.productId))
        .filter(Boolean);
    const isOrderRow = (row, i) =>
        refs[i]?.kind === "SalesOrder" &&
        (row.sourceType === "SalesOrder" ||
            (row.sourceType === "Payment" && row.transactionType === "customer_payment"));
    const orderIds = [
        ...new Set(rows.map((r, i) => (isOrderRow(r, i) ? String(toOid(refs[i].id) || "") : "")).filter(Boolean)),
    ].map(toOid);
    const onlineIds = [
        ...new Set(rows.filter(isOnlineOrderRow).map((r) => String(toOid(r.sourceId) || "")).filter(Boolean)),
    ].map(toOid);
    const StockMovement = require("../model/StockMovement");
    const [{ docs, checkouts }, movements, products, orderMovements, orderPayments, onlineHolds] = await Promise.all([
        loadDocs(companyId, refs),
        movementIds.length
            ? StockMovement.find({ _id: { $in: movementIds }, ...companyFilter(companyId) })
                  .select(MOVEMENT_FIELDS)
                  .lean()
            : [],
        productIds.length
            ? require("../model/product")
                  .find({ _id: { $in: productIds }, ...companyFilter(companyId) })
                  .select("productCode")
                  .lean()
            : [],
        orderIds.length
            ? StockMovement.find({
                  ...companyFilter(companyId),
                  salesOrderId: { $in: orderIds },
                  referenceType: "Sales Order",
              })
                  .select(MOVEMENT_FIELDS)
                  .sort({ _id: 1 })
                  .lean()
            : [],
        orderIds.length
            ? require("../model/bookkeepingEntry")
                  .find({
                      ...companyFilter(companyId),
                      sourceType: "Payment",
                      transactionType: { $in: ["customer_payment", "payment_reversal"] },
                      relatedDocuments: { $elemMatch: { type: "SalesOrder", id: { $in: orderIds } } },
                  })
                  .select("relatedDocuments cashIn cashOut createdAt")
                  .lean()
            : [],
        onlineIds.length
            ? StockMovement.find({
                  ...companyFilter(companyId),
                  referenceType: "Marketplace Order",
                  referenceId: { $in: onlineIds },
                  movementType: "Adjustment",
              })
                  .select(MOVEMENT_FIELDS)
                  .sort({ _id: 1 })
                  .lean()
            : [],
    ]);
    const onHand = new Map(movements.map((m) => [String(m._id), m]));
    const productCodes = new Map(products.map((p) => [String(p._id), p.productCode || ""]));

    const orderIdSet = new Set(orderIds.map(String));
    const paymentsByOrder = new Map();
    for (const p of orderPayments) {
        for (const d of p.relatedDocuments || []) {
            const id = String(d.id);
            if (d.type !== "SalesOrder" || !orderIdSet.has(id)) continue;
            if (!paymentsByOrder.has(id)) paymentsByOrder.set(id, []);
            paymentsByOrder
                .get(id)
                .push({ at: timeOf(p.createdAt), net: (Number(p.cashIn) || 0) - (Number(p.cashOut) || 0) });
        }
    }

    // Order rows (sale / sale reversal, online order / cancellation) take their own stock
    // movements; payment rows show the order's products as they stood when posted.
    const orderSales = (orderId) =>
        orderMovements.filter((m) => String(m.salesOrderId) === orderId && m.movementType === "Sale");
    const nearRow = (row, wanted) => {
        const at = timeOf(row.transactionDate);
        const near = wanted.filter(
            (m) => Math.abs(timeOf(m.movementDate || m.createdAt) - at) <= ORDER_ROW_WINDOW_MS
        );
        return near.length ? near : wanted;
    };
    const ownMovements = new Map();
    const paymentAnchors = new Map();
    const anchorQueries = [];
    rows.forEach((row, i) => {
        if (isOnlineOrderRow(row)) {
            const orderId = String(toOid(row.sourceId));
            const holds = row.transactionType === "online_sale";
            ownMovements.set(
                i,
                nearRow(
                    row,
                    onlineHolds.filter(
                        (m) => String(m.referenceId) === orderId && (m.movementDirection === "OUT") === holds
                    )
                )
            );
            return;
        }
        if (!isOrderRow(row, i)) return;
        const orderId = String(toOid(refs[i].id));
        if (row.sourceType === "SalesOrder") {
            if (!["sale", "sale_reversal"].includes(row.transactionType)) return;
            ownMovements.set(
                i,
                nearRow(
                    row,
                    orderMovements.filter(
                        (m) =>
                            String(m.salesOrderId) === orderId &&
                            (row.transactionType === "sale"
                                ? m.movementType === "Sale"
                                : m.movementType === "Adjustment" && m.movementDirection === "IN")
                    )
                )
            );
            return;
        }
        const sales = orderSales(orderId);
        if (!sales.length) return;
        const before = mongoose.Types.ObjectId.createFromTime(Math.floor(timeOf(row.createdAt) / 1000) + 1);
        paymentAnchors.set(i, []);
        for (const sale of sales) {
            anchorQueries.push(
                StockMovement.findOne({
                    ...companyFilter(companyId),
                    warehouseId: sale.warehouseId,
                    productId: sale.productId,
                    productVariantId: sale.productVariantId || null,
                    _id: { $lt: before },
                })
                    .select(MOVEMENT_FIELDS)
                    .sort({ _id: -1 })
                    .lean()
                    .then((anchor) => paymentAnchors.get(i).push({ sale, anchor: anchor || sale }))
            );
        }
    });
    await Promise.all(anchorQueries);

    const buckets = await bucketBalances(
        companyId,
        [
            ...movements,
            ...orderMovements,
            ...onlineHolds,
            ...[...paymentAnchors.values()].flat().map((p) => p.anchor),
        ],
        StockMovement
    );

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
        if (isProductFormRow(row)) {
            row.sourceLabel = "Products";
            row.documentNumber = productCodes.get(String(row.productId)) || row.documentNumber;
        }

        let status = paymentStatusOf(ref?.kind, doc, checkout);
        if (isOrderRow(row, i) && (row.transactionType === "sale" || row.sourceType === "Payment")) {
            const cutoff = timeOf(row.createdAt) + (row.sourceType === "Payment" ? 0 : SAME_CHECKOUT_MS);
            status = orderStatusAt(doc, paymentsByOrder.get(String(toOid(ref.id))) || [], cutoff);
        }
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
        const movement = onHand.get(String(row.sourceId));
        if (movement) {
            row.stockBefore = Number(movement.previousStock) || 0;
            row.stockAfter = Number(movement.currentStock) || 0;
            row.balanceAfter = balanceOf(movement, buckets.get(String(movement._id)), row.qtyChange.sold);
        }
        if (ownMovements.has(i)) {
            applyLines(
                row,
                ownMovements.get(i).map((m) => {
                    const lineChange = orderMovementChange(m);
                    return {
                        productName: m.productName || "",
                        sku: m.sku || "",
                        quantity: Number(m.quantity) || 0,
                        imeis: m.serialNumbers || [],
                        qtyChange: lineChange,
                        stockBefore: Number(m.previousStock) || 0,
                        stockAfter: Number(m.currentStock) || 0,
                        balanceAfter: balanceOf(m, buckets.get(String(m._id)), lineChange.sold),
                    };
                })
            );
        }
        if (paymentAnchors.has(i)) {
            applyLines(
                row,
                [...paymentAnchors.get(i)]
                    .sort((a, b) => (String(a.sale._id) < String(b.sale._id) ? -1 : 1))
                    .map(({ sale, anchor }) => {
                    const q = Number(sale.quantity) || 0;
                    return {
                        productName: sale.productName || "",
                        sku: sale.sku || "",
                        quantity: q,
                        imeis: sale.serialNumbers || [],
                        qtyChange: { stock: 0, reserved: 0, sold: q, available: 0 },
                        balanceAfter: balanceOf(anchor, buckets.get(String(anchor._id)), q),
                    };
                })
            );
        }
    });
    return rows;
};

module.exports = { presentRows, kindOf, qtyChange };
