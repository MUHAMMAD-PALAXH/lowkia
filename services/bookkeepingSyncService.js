const {
    round2,
    toObjectId,
    postEntry,
    syncTarget,
    markStatus,
} = require("./bookkeepingPostingService");

/**
 * Maps existing business documents → ledger rows. Called from model save hooks
 * (live) and the backfill script (history). Every function is idempotent.
 *
 * Lane rules (effects):
 *   sale / repair charge / online sale : REVENUE +a, RECEIVABLE +a
 *   sales return                        : REVENUE -a, RECEIVABLE -a
 *   customer payment                    : CASH|BANK +a, RECEIVABLE -a
 *   customer refund                     : CASH|BANK -a, RECEIVABLE +a
 *   goods received (supplier payable)   : PURCHASES +a, PAYABLE +a
 *   supplier payment / advance          : CASH|BANK -a, PAYABLE -a
 *   employee / expense payment          : CASH|BANK -a, EXPENSE +a
 *   stock movements                     : quantity only (no lane)
 */

const lazy = (path) => () => require(path);
const Models = {
    Customer: lazy("../model/customer"),
    Supplier: lazy("../model/supplier"),
    Employee: lazy("../model/employee"),
    AdminUser: lazy("../model/adminUser"),
    User: lazy("../model/user"),
    SalesOrder: lazy("../model/salesOrder"),
    RepairTicket: lazy("../model/repairTicket"),
    SalesReturn: lazy("../model/salesReturn"),
    PurchaseOrder: lazy("../model/purchaseOrder"),
    SupplierPayable: lazy("../model/supplierPayable"),
    Payment: lazy("../model/payment"),
    Order: lazy("../model/order"),
    CompanyOrder: lazy("../model/marketplace/companyOrder"),
    CheckoutPayment: lazy("../model/marketplace/checkoutPayment"),
    MarketplaceRefund: lazy("../model/marketplace/refund"),
    StockMovement: lazy("../model/StockMovement"),
};

const withSession = (query, session) => (session ? query.session(session) : query);

const findLean = (modelKey, id, select, session) => {
    const oid = toObjectId(id);
    if (!oid) return null;
    return withSession(Models[modelKey]().findById(oid).select(select).lean(), session);
};

const personLabel = (u) =>
    `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "";

/** Staff name; marketplace flows store the buyer's User id as the actor instead. */
const adminName = async (id, session) => {
    const user = await findLean("AdminUser", id, "firstName lastName email", session);
    if (user) return personLabel(user);
    const buyer = await findLean("User", id, "firstName lastName email", session);
    return buyer ? `${personLabel(buyer) || "Customer"} (customer)` : "";
};

const partyName = async (partyType, partyId, session) => {
    if (!partyId) return "";
    if (partyType === "Customer") {
        return (await findLean("Customer", partyId, "name", session))?.name || "";
    }
    if (partyType === "Supplier") {
        const s = await findLean("Supplier", partyId, "name companyName", session);
        return s?.name || s?.companyName || "";
    }
    if (partyType === "Employee") {
        return (await findLean("Employee", partyId, "name", session))?.name || "";
    }
    return "";
};

/** Canonical payment method label across Payment / SO / returns / checkout. */
const normalizeMethod = (raw) => {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    if (s === "cod" || s.includes("cash")) return "CASH";
    if (s.includes("apple")) return "APPLE_PAY";
    if (s.includes("card") || s.includes("clover")) return "CARD";
    if (s === "ach") return "ACH";
    if (s.includes("check") || s.includes("cheque")) return "CHECK";
    if (s.includes("mobile") || s.includes("wallet") || s.includes("bkash") || s.includes("nagad")) {
        return "MOBILE_BANKING";
    }
    if (s.includes("bank") || s.includes("transfer")) return "BANK_TRANSFER";
    if (s.includes("gateway") || s === "prepaid" || s === "online") return "ONLINE_GATEWAY";
    if (s.includes("credit")) return "CREDIT_ADJUSTMENT";
    return "OTHER";
};

const cashLane = (method) => (normalizeMethod(method) === "CASH" ? "CASH" : "BANK");

const rel = (type, id, number) => (id ? { type, id: toObjectId(id), number: number || "" } : null);
const compact = (list) => list.filter(Boolean);

// ── Payments (sales, repair, customer, supplier, employee, expense) ─────────

const PAYMENT_RULES = {
    CustomerPayment: { type: "customer_payment", cash: 1, lane: "RECEIVABLE", laneSign: -1 },
    CustomerRefund: { type: "customer_refund", cash: -1, lane: "RECEIVABLE", laneSign: 1 },
    SupplierPayment: { type: "supplier_payment", cash: -1, lane: "PAYABLE", laneSign: -1 },
    SupplierAdvance: { type: "supplier_advance", cash: -1, lane: "PAYABLE", laneSign: -1 },
    EmployeeSalary: { type: "salary_payment", cash: -1, lane: "EXPENSE", laneSign: 1 },
    EmployeeAdvance: { type: "employee_advance", cash: -1, lane: "EXPENSE", laneSign: 1 },
    EmployeeBonus: { type: "employee_bonus", cash: -1, lane: "EXPENSE", laneSign: 1 },
    EmployeeOther: { type: "employee_payment", cash: -1, lane: "EXPENSE", laneSign: 1 },
    ExpensePayment: { type: "expense_payment", cash: -1, lane: "EXPENSE", laneSign: 1 },
};

const paymentRule = (payment) => {
    const rule = PAYMENT_RULES[payment.paymentType];
    if (rule) {
        if (rule.type === "customer_payment" && payment.repairTicketId) {
            return { ...rule, type: "repair_payment" };
        }
        return rule;
    }
    const inbound = payment.partyType === "Customer";
    return { type: "other_payment", cash: inbound ? 1 : -1, lane: null, laneSign: 0 };
};

const paymentModule = (payment) => {
    if (payment.salesReturnId) return "Return";
    if (payment.repairTicketId) return "Repair";
    if (payment.salesOrderId) return "Sales";
    if (payment.paymentType === "ExpensePayment") return "Expense";
    if (payment.partyType === "Employee") return "Salary";
    if (payment.partyType === "Supplier") return "Supplier Payment";
    if (payment.partyType === "Customer") return "Customer Payment";
    return "Other";
};

const paymentContext = async (payment, session) => {
    const [so, ticket, ret, po, name, creator] = await Promise.all([
        findLean("SalesOrder", payment.salesOrderId, "orderNumber customerName", session),
        findLean("RepairTicket", payment.repairTicketId, "ticketNumber customerName", session),
        findLean("SalesReturn", payment.salesReturnId, "returnNumber", session),
        findLean("PurchaseOrder", payment.purchaseOrderId, "purchaseOrderNo", session),
        partyName(payment.partyType, payment.partyId, session),
        adminName(payment.postedBy || payment.createdBy, session),
    ]);
    return {
        partyName: name || so?.customerName || ticket?.customerName || "",
        createdByName: creator,
        related: compact([
            rel("SalesOrder", payment.salesOrderId, so?.orderNumber),
            rel("RepairTicket", payment.repairTicketId, ticket?.ticketNumber),
            rel("SalesReturn", payment.salesReturnId, ret?.returnNumber),
            rel("PurchaseOrder", payment.purchaseOrderId, po?.purchaseOrderNo),
            rel("SupplierPayable", payment.supplierPayableId, ""),
        ]),
        docLabel:
            so?.orderNumber ||
            ticket?.ticketNumber ||
            ret?.returnNumber ||
            po?.purchaseOrderNo ||
            "",
    };
};

const paymentBody = async (payment, { reverse = false, session } = {}) => {
    const rule = paymentRule(payment);
    const amount = round2(payment.amount);
    const flip = reverse ? -1 : 1;
    const lane = cashLane(payment.paymentMethod);
    const ctx = await paymentContext(payment, session);
    const label = rule.type.replace(/_/g, " ");
    const provider = payment.paymentProvider && payment.paymentProvider !== "NONE"
        ? payment.paymentProvider
        : "";
    return {
        companyId: payment.companyId,
        branchId: payment.branchId || null,
        transactionDate: reverse
            ? payment.reversedAt || payment.paymentDate || new Date()
            : payment.transactionDate || payment.postedAt || payment.paymentDate || new Date(),
        sourceModule: paymentModule(payment),
        sourceType: "Payment",
        sourceId: payment._id,
        sourceNumber: payment.paymentNumber || "",
        relatedDocuments: [rel("Payment", payment._id, payment.paymentNumber), ...ctx.related].filter(Boolean),
        description: reverse
            ? `Reversal of ${payment.paymentNumber || "payment"}${payment.reversalReason ? ` — ${payment.reversalReason}` : ""}`
            : `${label.charAt(0).toUpperCase()}${label.slice(1)}${ctx.docLabel ? ` · ${ctx.docLabel}` : ""}`,
        partyType: payment.partyType || "",
        partyId: payment.partyId || null,
        partyName: ctx.partyName,
        amount,
        account: lane,
        direction: rule.cash * flip > 0 ? "in" : "out",
        effects: compact([
            { account: lane, amount: rule.cash * flip * amount },
            rule.lane ? { account: rule.lane, amount: rule.laneSign * flip * amount } : null,
        ]),
        currency: payment.currency || "",
        paymentMethod: normalizeMethod(payment.paymentMethod),
        paymentProvider: provider,
        paymentReference:
            payment.providerTransactionId || payment.transactionReference || payment.checkNumber || "",
        createdBy: payment.postedBy || payment.createdBy || null,
        createdByName: ctx.createdByName,
    };
};

const syncPayment = async (payment, opts = {}) => {
    if (!payment?.companyId || payment.isDeleted) return;
    const { session = null, dryRun = false } = opts;
    const key = `payment:${payment._id}`;
    const isReversalDoc =
        payment.status === "reversed" &&
        payment.originalPaymentId &&
        String(payment.originalPaymentId) !== String(payment._id);

    if (payment.status === "paid") {
        const body = await paymentBody(payment, { session });
        await postEntry(
            { ...body, transactionType: paymentRule(payment).type, idempotencyKey: key },
            { session, dryRun }
        );
        return;
    }

    if (isReversalDoc) {
        const body = await paymentBody(payment, { reverse: true, session });
        await postEntry(
            {
                ...body,
                transactionType: "payment_reversal",
                isReversal: true,
                idempotencyKey: `payment-reversal:${payment._id}`,
                relatedDocuments: [
                    ...body.relatedDocuments,
                    rel("Payment", payment.originalPaymentId, "original"),
                ].filter(Boolean),
            },
            { session, dryRun }
        );
        return;
    }

    if (payment.status === "reversed") {
        // Original stays in history (it was paid); money-out is the reversal/refund doc.
        const body = await paymentBody(payment, { session });
        await postEntry(
            { ...body, transactionType: paymentRule(payment).type, idempotencyKey: key },
            { session, dryRun }
        );
        if (!dryRun) {
            await markStatus({ companyId: payment.companyId, idempotencyKey: key, status: "reversed", session });
        }
    }
};

// ── Sales orders (revenue at stock-out) ─────────────────────────────────────

const syncSalesOrder = async (order, opts = {}) => {
    if (!order?.companyId) return;
    const { session = null, dryRun = false } = opts;
    let target =
        order.stockUpdated && !order.isDeleted && order.status !== "Cancelled"
            ? Number(order.grandTotal) || 0
            : 0;
    if (target > 0) {
        // Marketplace-bridged SOs: revenue is already recorded on the online order.
        const bridged = await withSession(
            Models.CompanyOrder().exists({ salesOrderId: order._id }),
            session
        );
        if (bridged) target = 0;
    }
    await syncTarget({
        companyId: order.companyId,
        sourceId: order._id,
        transactionType: "sale",
        reversalType: "sale_reversal",
        keyPrefix: "so-sale",
        target,
        session,
        dryRun,
        build: async ({ amount, sign }) => ({
            branchId: order.branchId || null,
            warehouseId: order.warehouseId || null,
            transactionDate: sign > 0 ? order.stockUpdatedAt || new Date() : new Date(),
            sourceModule: "Sales",
            sourceType: "SalesOrder",
            sourceNumber: order.orderNumber || "",
            relatedDocuments: compact([rel("SalesOrder", order._id, order.orderNumber)]),
            description:
                sign > 0
                    ? `Sale ${order.orderNumber || ""}`.trim()
                    : `Sale reversed ${order.orderNumber || ""}${order.isDeleted ? " (order trashed)" : ""}`.trim(),
            partyType: "Customer",
            partyId: order.customerId || null,
            partyName: order.customerName || "",
            account: "REVENUE",
            direction: sign > 0 ? "in" : "out",
            effects: [
                { account: "REVENUE", amount: sign * amount },
                { account: "RECEIVABLE", amount: sign * amount },
            ],
            paymentMethod: normalizeMethod(order.paymentMethod),
            createdBy: order.updatedBy || order.createdBy || null,
            createdByName: await adminName(order.updatedBy || order.createdBy, session),
            metadata: { grandTotal: Number(order.grandTotal) || 0 },
        }),
    });
};

// ── Supplier payable (goods received value) ─────────────────────────────────

const syncSupplierPayable = async (payable, opts = {}) => {
    if (!payable?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const { toMajor } = require("../utils/money");
    const target = payable.isDeleted
        ? 0
        : toMajor(Number(payable.grnReceivedValueMinor) || 0, payable.currency);
    await syncTarget({
        companyId: payable.companyId,
        sourceId: payable._id,
        transactionType: "purchase",
        reversalType: "purchase_reversal",
        keyPrefix: "payable",
        target,
        session,
        dryRun,
        build: async ({ amount, sign }) => {
            const [po, supplier] = await Promise.all([
                findLean("PurchaseOrder", payable.purchaseOrderId, "purchaseOrderNo", session),
                partyName("Supplier", payable.supplierId, session),
            ]);
            return {
                branchId: payable.branchId || null,
                transactionDate: payable.lastSyncedAt || new Date(),
                sourceModule: "GRN",
                sourceType: "SupplierPayable",
                sourceNumber: po?.purchaseOrderNo || payable.payableNumber || "",
                relatedDocuments: compact([
                    rel("PurchaseOrder", payable.purchaseOrderId, po?.purchaseOrderNo),
                    rel("SupplierPayable", payable._id, payable.payableNumber),
                    ...(payable.grnIds || []).map((id) => rel("Grn", id, "")),
                ]),
                description:
                    sign > 0
                        ? `Goods received · payable ${payable.payableNumber || ""}`.trim()
                        : `Received value reduced · payable ${payable.payableNumber || ""}`.trim(),
                partyType: "Supplier",
                partyId: payable.supplierId || null,
                partyName: supplier,
                account: "PAYABLE",
                direction: sign > 0 ? "in" : "out",
                effects: [
                    { account: "PURCHASES", amount: sign * amount },
                    { account: "PAYABLE", amount: sign * amount },
                ],
                currency: payable.currency || "",
                createdBy: payable.updatedBy || payable.createdBy || null,
                createdByName: await adminName(payable.updatedBy || payable.createdBy, session),
            };
        },
    });
};

// ── Sales returns ───────────────────────────────────────────────────────────

const syncSalesReturn = async (ret, opts = {}) => {
    if (!ret?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const received = ["Received", "Refunded"].includes(ret.status) && !ret.isDeleted;
    const value = Number(ret.subtotal) || Number(ret.refundAmount) || 0;
    const so = ret.salesOrderId
        ? await findLean("SalesOrder", ret.salesOrderId, "orderNumber", session)
        : null;
    const common = async () => ({
        branchId: ret.branchId || null,
        warehouseId: ret.warehouseId || null,
        sourceModule: "Return",
        sourceType: "SalesReturn",
        sourceNumber: ret.returnNumber || "",
        relatedDocuments: compact([
            rel("SalesReturn", ret._id, ret.returnNumber),
            rel("SalesOrder", ret.salesOrderId, so?.orderNumber),
        ]),
        partyType: "Customer",
        partyId: ret.customerId || null,
        partyName: ret.customerName || "",
        createdBy: ret.updatedBy || ret.createdBy || null,
        createdByName: await adminName(ret.updatedBy || ret.createdBy, session),
    });

    await syncTarget({
        companyId: ret.companyId,
        sourceId: ret._id,
        transactionType: "sales_return",
        keyPrefix: "ret-value",
        target: received ? value : 0,
        session,
        dryRun,
        build: async ({ amount, sign }) => ({
            ...(await common()),
            transactionDate: ret.updatedAt || new Date(),
            description:
                sign > 0
                    ? `Sales return ${ret.returnNumber || ""}${so?.orderNumber ? ` for ${so.orderNumber}` : ""}`
                    : `Sales return adjusted ${ret.returnNumber || ""}`,
            account: "REVENUE",
            direction: sign > 0 ? "out" : "in",
            effects: [
                { account: "REVENUE", amount: -sign * amount },
                { account: "RECEIVABLE", amount: -sign * amount },
            ],
        }),
    });

    // Clover refunds already exist as Payment rows; credit adjustment moves no cash.
    const directRefund =
        ret.status === "Refunded" &&
        !["Clover", "Credit Adjustment"].includes(ret.refundMethod)
            ? Number(ret.refundAmount) || 0
            : 0;
    await syncTarget({
        companyId: ret.companyId,
        sourceId: ret._id,
        transactionType: "customer_refund",
        keyPrefix: "ret-refund",
        target: directRefund,
        session,
        dryRun,
        build: async ({ amount, sign }) => {
            const lane = cashLane(ret.refundMethod);
            return {
                ...(await common()),
                transactionDate: ret.updatedAt || new Date(),
                description: `Refund for return ${ret.returnNumber || ""}`.trim(),
                account: lane,
                direction: sign > 0 ? "out" : "in",
                effects: [
                    { account: lane, amount: -sign * amount },
                    { account: "RECEIVABLE", amount: sign * amount },
                ],
                paymentMethod: normalizeMethod(ret.refundMethod),
            };
        },
    });
};

// ── Repair tickets ──────────────────────────────────────────────────────────

const REPAIR_DONE = new Set(["Completed", "Ready For Pickup", "Delivered"]);

const syncRepairTicket = async (ticket, opts = {}) => {
    if (!ticket?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const common = async () => ({
        branchId: ticket.branchId?._id || ticket.branchId || null,
        sourceModule: "Repair",
        sourceType: "RepairTicket",
        sourceNumber: ticket.ticketNumber || "",
        relatedDocuments: compact([rel("RepairTicket", ticket._id, ticket.ticketNumber)]),
        partyType: "Customer",
        partyId: ticket.customerId?._id || ticket.customerId || null,
        partyName: ticket.customerName || "",
        imeis: compact([ticket.device?.imei1, ticket.device?.imei2]),
        productName: ticket.device?.productName || "",
        createdBy: ticket.updatedBy?._id || ticket.updatedBy || ticket.createdBy?._id || ticket.createdBy || null,
    });

    const chargeTarget =
        REPAIR_DONE.has(ticket.status) && !ticket.isDeleted
            ? Number(ticket.totalAmount) || 0
            : 0;
    await syncTarget({
        companyId: ticket.companyId,
        sourceId: ticket._id,
        transactionType: "repair_charge",
        reversalType: "repair_charge_reversal",
        keyPrefix: "rep-charge",
        target: chargeTarget,
        session,
        dryRun,
        build: async ({ amount, sign }) => {
            const base = await common();
            return {
                ...base,
                createdByName: await adminName(base.createdBy, session),
                transactionDate: sign > 0 ? ticket.completedDate || new Date() : new Date(),
                description:
                    sign > 0
                        ? `Repair charge ${ticket.ticketNumber || ""}`.trim()
                        : `Repair charge reversed ${ticket.ticketNumber || ""}`.trim(),
                account: "REVENUE",
                direction: sign > 0 ? "in" : "out",
                effects: [
                    { account: "REVENUE", amount: sign * amount },
                    { account: "RECEIVABLE", amount: sign * amount },
                ],
                metadata: {
                    serviceCharge: Number(ticket.serviceCharge) || 0,
                    partsCost: Number(ticket.partsCost) || 0,
                    laborCost: Number(ticket.laborCost) || 0,
                    diagnosisCharge: Number(ticket.diagnosisCharge) || 0,
                    discount: Number(ticket.discount) || 0,
                    tax: Number(ticket.tax) || 0,
                },
            };
        },
    });

    // paidAmount recorded on the ticket without a Payment row (advance at intake, manual edit).
    const paid = Number(ticket.paidAmount) || 0;
    let tracked = 0;
    if (paid > 0) {
        const rows = await withSession(
            Models.Payment()
                .find({
                    repairTicketId: ticket._id,
                    paymentType: "CustomerPayment",
                    status: { $in: ["paid", "reversed"] },
                    isDeleted: { $ne: true },
                })
                .select("amount")
                .lean(),
            session
        );
        tracked = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    }
    await syncTarget({
        companyId: ticket.companyId,
        sourceId: ticket._id,
        transactionType: "repair_payment",
        keyPrefix: "rep-pay",
        target: Math.max(round2(paid - tracked), 0),
        session,
        dryRun,
        build: async ({ amount, sign }) => {
            const base = await common();
            const lane = ["Bank", "Card"].includes(ticket.paymentMethod) ? "BANK" : "CASH";
            return {
                ...base,
                createdByName: await adminName(base.createdBy, session),
                transactionDate: new Date(),
                description:
                    sign > 0
                        ? `Repair payment ${ticket.ticketNumber || ""}`.trim()
                        : `Repair payment corrected ${ticket.ticketNumber || ""}`.trim(),
                account: lane,
                direction: sign > 0 ? "in" : "out",
                effects: [
                    { account: lane, amount: sign * amount },
                    { account: "RECEIVABLE", amount: -sign * amount },
                ],
                paymentMethod: lane === "CASH" ? "CASH" : normalizeMethod(ticket.paymentMethod),
            };
        },
    });
};

// ── Marketplace online orders ───────────────────────────────────────────────

const ONLINE_INACTIVE = new Set(["pending", "cancelled", "refunded"]);

const syncCompanyOrder = async (companyOrder, opts = {}) => {
    if (!companyOrder?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const total = Number(companyOrder.totals?.total) || 0;

    const [refunds, checkout, mirror] = await Promise.all([
        withSession(
            Models.MarketplaceRefund()
                .find({ companyOrderId: companyOrder._id, status: "completed", isDeleted: { $ne: true } })
                .select("amount")
                .lean(),
            session
        ),
        withSession(
            Models.CheckoutPayment()
                .findOne({ masterOrderId: companyOrder.masterOrderId, status: "successful" })
                .select("paymentNumber paymentMethod paymentProvider providerTransactionId paidAt")
                .lean(),
            session
        ),
        companyOrder.onlineOrderId
            ? findLean("Order", companyOrder.onlineOrderId, "branchId orderSource", session)
            : null,
    ]);
    const refunded = refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const active = !ONLINE_INACTIVE.has(companyOrder.status) && !companyOrder.isDeleted;
    // Unassigned online orders: use the branch whose stock holds the order.
    const stockBranch = mirror?.branchId
        ? null
        : await withSession(
              Models.StockMovement()
                  .findOne({
                      companyId: companyOrder.companyId,
                      referenceType: "Marketplace Order",
                      referenceId: companyOrder._id,
                      branchId: { $ne: null },
                  })
                  .select("branchId")
                  .lean(),
              session
          );

    const common = {
        branchId: mirror?.branchId || stockBranch?.branchId || null,
        sourceModule: "Online Order",
        sourceType: "CompanyOrder",
        sourceNumber: companyOrder.orderNumber || "",
        relatedDocuments: compact([
            rel("CompanyOrder", companyOrder._id, companyOrder.orderNumber),
            rel("Order", companyOrder.onlineOrderId, companyOrder.orderNumber),
            rel("SalesOrder", companyOrder.salesOrderId, ""),
        ]),
        partyType: "Customer",
        partyId: companyOrder.erpCustomerId || null,
        partyName: companyOrder.shippingAddress?.recipientName || "",
        currency: companyOrder.currency || "",
        createdByName: await adminName(companyOrder.userId, session),
        metadata: { orderSource: mirror?.orderSource || "unknown" },
    };

    await syncTarget({
        companyId: companyOrder.companyId,
        sourceId: companyOrder._id,
        transactionType: "online_sale",
        reversalType: "online_sale_reversal",
        keyPrefix: "online-sale",
        target: active ? Math.max(round2(total - refunded), 0) : 0,
        session,
        dryRun,
        build: async ({ amount, sign }) => ({
            ...common,
            transactionDate:
                sign > 0
                    ? companyOrder.confirmedAt || new Date()
                    : companyOrder.cancelledAt || new Date(),
            description:
                sign > 0
                    ? `Online order ${companyOrder.orderNumber}`
                    : `Online order ${companyOrder.orderNumber} ${companyOrder.status === "cancelled" ? "cancelled" : "adjusted"}`,
            account: "REVENUE",
            direction: sign > 0 ? "in" : "out",
            effects: [
                { account: "REVENUE", amount: sign * amount },
                { account: "RECEIVABLE", amount: sign * amount },
            ],
            paymentMethod: normalizeMethod(checkout?.paymentMethod),
        }),
    });

    // Prepaid: money received at successful checkout. COD: collected on delivery.
    const method = checkout?.paymentMethod;
    const collected = checkout && (method !== "cod" || companyOrder.deliveredAt);
    if (collected && total > 0) {
        const lane = cashLane(method);
        await postEntry(
            {
                ...common,
                companyId: companyOrder.companyId,
                sourceId: companyOrder._id,
                transactionType: "online_payment",
                idempotencyKey: `online-pay:${companyOrder._id}`,
                transactionDate:
                    method === "cod"
                        ? companyOrder.deliveredAt
                        : checkout.paidAt || companyOrder.confirmedAt || new Date(),
                description: `Online payment ${companyOrder.orderNumber}${method === "cod" ? " (cash on delivery)" : ""}`,
                amount: total,
                netAmount: total,
                account: lane,
                direction: "in",
                effects: [
                    { account: lane, amount: total },
                    { account: "RECEIVABLE", amount: -total },
                ],
                paymentMethod: normalizeMethod(method),
                paymentProvider: checkout.paymentProvider || "",
                paymentReference: checkout.providerTransactionId || checkout.paymentNumber || "",
            },
            { session, dryRun }
        );
    }
};

const syncMarketplaceRefund = async (refund, opts = {}) => {
    if (refund?.status !== "completed" || refund.isDeleted) return;
    const { session = null, dryRun = false } = opts;
    if (!refund.companyOrderId) {
        console.warn(`[bookkeeping] master-level refund ${refund.refundNumber} skipped (no company slice).`);
        return;
    }
    const companyOrder = await withSession(
        Models.CompanyOrder().findById(refund.companyOrderId),
        session
    );
    if (!companyOrder) return;
    const checkout = await findLean(
        "CheckoutPayment",
        refund.checkoutPaymentId,
        "paymentMethod paymentProvider",
        session
    );
    const lane = cashLane(checkout?.paymentMethod);
    const amount = round2(refund.amount);
    await postEntry(
        {
            companyId: companyOrder.companyId,
            sourceModule: "Online Order",
            sourceType: "MarketplaceRefund",
            sourceId: refund._id,
            sourceNumber: refund.refundNumber || "",
            relatedDocuments: compact([
                rel("MarketplaceRefund", refund._id, refund.refundNumber),
                rel("CompanyOrder", companyOrder._id, companyOrder.orderNumber),
                rel("Order", companyOrder.onlineOrderId, companyOrder.orderNumber),
            ]),
            transactionType: "online_refund",
            idempotencyKey: `mrefund:${refund._id}`,
            transactionDate: refund.processedAt || new Date(),
            description: `Online refund ${refund.refundNumber} · ${companyOrder.orderNumber}${refund.reason ? ` — ${refund.reason}` : ""}`,
            partyType: "Customer",
            partyId: companyOrder.erpCustomerId || null,
            partyName: companyOrder.shippingAddress?.recipientName || "",
            amount,
            netAmount: amount,
            account: lane,
            direction: "out",
            effects: [
                { account: lane, amount: -amount },
                { account: "RECEIVABLE", amount },
            ],
            currency: refund.currency || "",
            paymentMethod: normalizeMethod(checkout?.paymentMethod),
            paymentProvider: checkout?.paymentProvider || "",
            paymentReference: refund.providerRefundId || "",
            createdBy: refund.processedBy || null,
            createdByName: await adminName(refund.processedBy, session),
        },
        { session, dryRun }
    );
    await syncCompanyOrder(companyOrder, { session, dryRun });
};

// ── Legacy Admin online orders (not mirrored from marketplace) ─────────────

const syncLegacyOrder = async (order, opts = {}) => {
    if (!order?.companyId || order.companyOrderId) return;
    const { session = null, dryRun = false } = opts;
    const total = Number(order.totalPrice) || 0;
    const delivered = order.orderStatus === "delivered";
    const number = order.orderNumber || String(order._id).slice(-8).toUpperCase();
    const buyer = await findLean("User", order.userID, "firstName lastName", session);
    const common = {
        branchId: order.branchId || null,
        sourceModule: "Online Order",
        sourceType: "Order",
        sourceNumber: number,
        relatedDocuments: compact([rel("Order", order._id, number)]),
        partyType: "Customer",
        partyName:
            `${buyer?.firstName || ""} ${buyer?.lastName || ""}`.trim() ||
            order.shippingAddress?.phone ||
            "",
        createdByName: buyer ? `${personLabel(buyer) || "Customer"} (customer)` : "",
        metadata: { orderSource: order.orderSource || "unknown" },
    };
    await syncTarget({
        companyId: order.companyId,
        sourceId: order._id,
        transactionType: "online_sale",
        reversalType: "online_sale_reversal",
        keyPrefix: "order-sale",
        target: delivered ? total : 0,
        session,
        dryRun,
        build: async ({ amount, sign }) => ({
            ...common,
            transactionDate: new Date(),
            description: sign > 0 ? `Online order ${number} delivered` : `Online order ${number} reversed`,
            account: "REVENUE",
            direction: sign > 0 ? "in" : "out",
            effects: [
                { account: "REVENUE", amount: sign * amount },
                { account: "RECEIVABLE", amount: sign * amount },
            ],
            paymentMethod: normalizeMethod(order.paymentMethod),
        }),
    });
    if (delivered && total > 0) {
        const lane = cashLane(order.paymentMethod);
        await postEntry(
            {
                ...common,
                companyId: order.companyId,
                sourceId: order._id,
                transactionType: "online_payment",
                idempotencyKey: `order-pay:${order._id}`,
                transactionDate: new Date(),
                description: `Online payment ${number}`,
                amount: total,
                netAmount: total,
                account: lane,
                direction: "in",
                effects: [
                    { account: lane, amount: total },
                    { account: "RECEIVABLE", amount: -total },
                ],
                paymentMethod: normalizeMethod(order.paymentMethod),
            },
            { session, dryRun }
        );
    }
};

// ── Inventory movements (quantity only) ─────────────────────────────────────

const STOCK_MODULE = {
    "Purchase Order": "Purchase",
    GRN: "GRN",
    "Purchase Invoice": "Purchase",
    "Sales Order": "Sales",
    "Sales Invoice": "Sales",
    "Sales Return": "Return",
    "Purchase Return": "Purchase",
    "Stock Transfer": "Transfer",
    "Stock Adjustment": "Adjustment",
    "Opening Balance": "Inventory",
    Manual: "Inventory",
    "Marketplace Order": "Online Order",
};

/** Online-order reservations move stock available↔reserved; on-hand stock is unchanged. */
const isReservationMovement = (movement) =>
    movement.referenceType === "Marketplace Order" && movement.movementType === "Adjustment";

const stockType = (movement) => {
    if (isReservationMovement(movement)) {
        return movement.movementDirection === "IN" ? "stock_released" : "stock_reserved";
    }
    if (["Transfer In", "Transfer Out"].includes(movement.movementType)) return "stock_transfer";
    if (["Adjustment", "Damage"].includes(movement.movementType)) return "adjustment";
    return movement.movementDirection === "IN" ? "stock_in" : "stock_out";
};

const syncStockMovement = async (movement, opts = {}) => {
    if (!movement?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const refId =
        movement.referenceId ||
        movement.salesOrderId ||
        movement.grnId ||
        movement.purchaseOrderId ||
        movement.salesReturnId ||
        movement.stockTransferId ||
        null;
    const qty = Number(movement.quantity) || 0;
    const reservation = isReservationMovement(movement);
    await postEntry(
        {
            companyId: movement.companyId,
            branchId: movement.branchId || movement.fromBranchId || null,
            toBranchId: movement.toBranchId || null,
            warehouseId: movement.warehouseId || movement.fromWarehouseId || null,
            toWarehouseId: movement.toWarehouseId || null,
            transactionDate: movement.movementDate || movement.createdAt || new Date(),
            transactionType: stockType(movement),
            sourceModule: STOCK_MODULE[movement.referenceType] || "Inventory",
            sourceType: "StockMovement",
            sourceId: movement._id,
            sourceNumber: movement.movementNumber || "",
            relatedDocuments: compact([
                rel("StockMovement", movement._id, movement.movementNumber),
                rel(movement.referenceType || "Reference", refId, ""),
            ]),
            description: `${movement.movementType}: ${movement.productName || "Item"} × ${qty}${movement.remarks ? ` — ${movement.remarks}` : ""}`,
            productId: movement.productId || null,
            productName: movement.productName || "",
            sku: movement.sku || "",
            imeis: movement.serialNumbers || [],
            quantity: qty,
            unitAmount: reservation ? 0 : round2(movement.unitCost),
            amount: reservation ? 0 : round2(movement.totalCost),
            netAmount: 0,
            account: "INVENTORY",
            direction: reservation ? "none" : movement.movementDirection === "IN" ? "in" : "out",
            effects: [],
            createdBy: movement.createdBy || null,
            createdByName: await adminName(movement.createdBy, session),
            metadata: {
                movementType: movement.movementType,
                reason: movement.adjustmentReason || "",
                valueBasis: "movement unitCost field",
            },
            idempotencyKey: `stock:${movement._id}`,
        },
        { session, dryRun }
    );
};

const syncBranchTransfer = async (transfer, opts = {}) => {
    if (!transfer?.companyId) return;
    const { session = null, dryRun = false } = opts;
    const imeis = transfer.imeis || [];
    const actor = transfer.status === "Completed" ? transfer.receivedBy : transfer.dispatchedBy;
    await postEntry(
        {
            companyId: transfer.companyId,
            branchId: transfer.fromBranchId || null,
            toBranchId: transfer.toBranchId || null,
            transactionDate:
                transfer.status === "Completed"
                    ? transfer.receivedAt || new Date()
                    : transfer.dispatchedAt || new Date(),
            transactionType: "branch_transfer",
            sourceModule: "Transfer",
            sourceType: "BranchTransfer",
            sourceId: transfer._id,
            sourceNumber: transfer.transferNumber || "",
            relatedDocuments: compact([rel("BranchTransfer", transfer._id, transfer.transferNumber)]),
            description: `IMEI branch transfer ${transfer.status.toLowerCase()} · ${imeis.length} unit(s)`,
            productId: transfer.productId || null,
            imeis,
            quantity: imeis.length,
            amount: 0,
            account: "INVENTORY",
            direction: "none",
            effects: [],
            status: transfer.status === "Cancelled" ? "reversed" : "completed",
            createdBy: actor || null,
            createdByName: await adminName(actor, session),
            idempotencyKey: `btr:${transfer._id}:${String(transfer.status).toLowerCase()}`,
        },
        { session, dryRun }
    );
};

const HANDLERS = {
    Payment: syncPayment,
    SalesOrder: syncSalesOrder,
    SupplierPayable: syncSupplierPayable,
    SalesReturn: syncSalesReturn,
    RepairTicket: syncRepairTicket,
    CompanyOrder: syncCompanyOrder,
    MarketplaceRefund: syncMarketplaceRefund,
    Order: syncLegacyOrder,
    StockMovement: syncStockMovement,
    BranchTransfer: syncBranchTransfer,
};

const syncDocument = async (kind, doc, opts = {}) => {
    const handler = HANDLERS[kind];
    if (!handler || !doc) return;
    await handler(doc, opts);
};

module.exports = {
    HANDLERS,
    syncDocument,
    normalizeMethod,
    syncPayment,
    syncSalesOrder,
    syncSupplierPayable,
    syncSalesReturn,
    syncRepairTicket,
    syncCompanyOrder,
    syncMarketplaceRefund,
    syncLegacyOrder,
    syncStockMovement,
    syncBranchTransfer,
};
