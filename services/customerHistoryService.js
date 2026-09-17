const mongoose = require("mongoose");
const Customer = require("../model/customer");
const SalesOrder = require("../model/salesOrder");
const RepairTicket = require("../model/repairTicket");
const CompanyOrder = require("../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../model/marketplace/marketplaceOrderItem");
const MasterOrder = require("../model/marketplace/masterOrder");
const CheckoutPayment = require("../model/marketplace/checkoutPayment");
const AppError = require("../utils/appError");
const { companyFilter } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const parseList = (value) => {
    if (value == null || value === "") return [];
    if (Array.isArray(value)) {
        return value
            .flatMap((v) => String(v).split(","))
            .map((v) => v.trim())
            .filter(Boolean);
    }
    return String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
};

const parseDateBound = (value, endOfDay = false) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
};

const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const SOURCE_LABELS = {
    SalesOrder: "Sales Order",
    RepairTicket: "Repair Ticket",
    OnlineOrder: "Online Order"
};

const mapSalesItems = (items = []) =>
    (items || []).map((item) => ({
        name: item.productName || item.name || "Item",
        sku: item.sku || "",
        qty: money(item.quantity),
        unitPrice: money(item.unitPrice),
        lineTotal: money(
            item.total ??
                item.lineTotal ??
                money(item.quantity) * money(item.unitPrice)
        )
    }));

const mapRepairItems = (ticket) => {
    const parts = Array.isArray(ticket.usedParts) ? ticket.usedParts : [];
    if (parts.length) {
        return parts.map((p) => ({
            name: p.productName || p.name || "Part",
            sku: p.sku || "",
            qty: money(p.quantity || p.qty || 1),
            unitPrice: money(p.unitPrice || p.price),
            lineTotal: money(
                p.total ??
                    money(p.quantity || p.qty || 1) *
                        money(p.unitPrice || p.price)
            )
        }));
    }
    const deviceName =
        ticket.device?.productName ||
        ticket.serviceDetails ||
        "Repair service";
    return [
        {
            name: deviceName,
            sku: ticket.device?.imei1 || ticket.barcode || "",
            qty: 1,
            unitPrice: money(ticket.totalAmount),
            lineTotal: money(ticket.totalAmount)
        }
    ];
};

const mapOnlineItems = (items = []) =>
    (items || []).map((item) => ({
        name: item.product?.productName || item.productName || "Item",
        sku: item.product?.sku || item.sku || "",
        qty: money(item.quantity),
        unitPrice:
            money(item.quantity) > 0
                ? money(item.lineSubtotal) / money(item.quantity)
                : money(item.unitPrice),
        lineTotal: money(item.lineSubtotal ?? item.lineTotal)
    }));

const matchesSearch = (row, search) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const hay = [
        row.referenceNumber,
        row.status,
        row.paymentStatus,
        row.paymentMethod,
        row.sourceLabel,
        ...row.items.map((i) => `${i.name} ${i.sku}`)
    ]
        .join(" ")
        .toLowerCase();
    return hay.includes(q);
};

const getCustomerHistory = async (customerId, query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const id = toObjectId(customerId);
    if (!id) throw new AppError("Invalid customer id.", 400);

    const customer = await Customer.findOne({
        _id: id,
        ...NOT_DELETED,
        ...tenant
    }).lean();
    if (!customer) throw new AppError("Customer not found.", 404);
    assertDocumentCompany(customer, companyId, "Customer");

    const sources = parseList(query.source || query.sources).map((s) => {
        const key = s.replace(/\s+/g, "");
        if (/sales/i.test(key)) return "SalesOrder";
        if (/repair/i.test(key)) return "RepairTicket";
        if (/online|market/i.test(key)) return "OnlineOrder";
        return key;
    });
    const want = (src) => !sources.length || sources.includes(src);

    const dateFrom = parseDateBound(query.dateFrom || query.fromDate, false);
    const dateTo = parseDateBound(query.dateTo || query.toDate, true);
    const paymentMethods = parseList(query.paymentMethod || query.paymentMethods);
    const paymentStatuses = parseList(
        query.paymentStatus || query.paymentStatuses
    );
    const statuses = parseList(query.status || query.statuses);
    const search = String(query.search || "").trim();
    const dueOnly =
        query.dueOnly === "true" ||
        query.dueOnly === true ||
        query.hasDue === "true";

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);

    const soDate = {};
    if (dateFrom) soDate.$gte = dateFrom;
    if (dateTo) soDate.$lte = dateTo;

    const rows = [];

    // Online / marketplace first so we can exclude bridged sales orders.
    let bridgedSalesOrderIds = [];
    if (want("OnlineOrder")) {
        const onlineFilter = {
            erpCustomerId: id,
            ...NOT_DELETED,
            ...tenant
        };
        if (dateFrom || dateTo) {
            onlineFilter.createdAt = {};
            if (dateFrom) onlineFilter.createdAt.$gte = dateFrom;
            if (dateTo) onlineFilter.createdAt.$lte = dateTo;
        }

        const onlineOrders = await CompanyOrder.find(onlineFilter)
            .sort({ createdAt: -1 })
            .lean();

        bridgedSalesOrderIds = onlineOrders
            .map((o) => o.salesOrderId)
            .filter(Boolean)
            .map((v) => String(v));

        const masterIds = [
            ...new Set(
                onlineOrders.map((o) => String(o.masterOrderId)).filter(Boolean)
            )
        ];
        const orderIds = onlineOrders.map((o) => o._id);

        const [masters, items, payments] = await Promise.all([
            masterIds.length
                ? MasterOrder.find({
                      _id: { $in: masterIds },
                      ...NOT_DELETED
                  })
                      .select("orderNumber paymentStatus placedAt")
                      .lean()
                : [],
            orderIds.length
                ? MarketplaceOrderItem.find({
                      companyOrderId: { $in: orderIds },
                      ...NOT_DELETED
                  }).lean()
                : [],
            masterIds.length
                ? CheckoutPayment.find({
                      masterOrderId: { $in: masterIds },
                      ...NOT_DELETED
                  })
                      .sort({ createdAt: -1 })
                      .lean()
                : []
        ]);

        const masterById = new Map(masters.map((m) => [String(m._id), m]));
        const itemsByOrder = new Map();
        for (const item of items) {
            const key = String(item.companyOrderId);
            if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
            itemsByOrder.get(key).push(item);
        }
        const paymentByMaster = new Map();
        for (const pay of payments) {
            const key = String(pay.masterOrderId);
            if (!paymentByMaster.has(key)) paymentByMaster.set(key, pay);
        }

        for (const order of onlineOrders) {
            const master = masterById.get(String(order.masterOrderId));
            const pay = paymentByMaster.get(String(order.masterOrderId));
            const lineItems = mapOnlineItems(
                itemsByOrder.get(String(order._id)) || []
            );
            const total = money(order.totals?.total);
            const paid =
                master?.paymentStatus === "successful" ? total : money(0);
            const due = Math.max(total - paid, 0);
            const occurredAt =
                master?.placedAt || order.confirmedAt || order.createdAt;

            rows.push({
                id: String(order._id),
                source: "OnlineOrder",
                sourceLabel: SOURCE_LABELS.OnlineOrder,
                referenceNumber:
                    order.orderNumber || master?.orderNumber || "—",
                occurredAt,
                status: order.status || "",
                paymentStatus: master?.paymentStatus || "pending",
                paymentMethod:
                    pay?.paymentMethod ||
                    pay?.provider ||
                    "Online Gateway",
                items: lineItems,
                itemCount: lineItems.reduce((s, i) => s + i.qty, 0),
                subtotal: money(order.totals?.subtotal),
                total,
                paid,
                due,
                gatewayRef: pay?.providerPaymentId || pay?.id || "",
                linkedSalesOrderId: order.salesOrderId
                    ? String(order.salesOrderId)
                    : ""
            });
        }
    }

    if (want("SalesOrder")) {
        const soFilter = {
            customerId: id,
            ...NOT_DELETED,
            ...tenant
        };
        if (Object.keys(soDate).length) soFilter.orderDate = soDate;
        if (bridgedSalesOrderIds.length) {
            soFilter._id = {
                $nin: bridgedSalesOrderIds.map((v) => toObjectId(v)).filter(Boolean)
            };
        }

        const salesOrders = await SalesOrder.find(soFilter)
            .sort({ orderDate: -1, createdAt: -1 })
            .lean();

        for (const order of salesOrders) {
            const lineItems = mapSalesItems(order.items);
            rows.push({
                id: String(order._id),
                source: "SalesOrder",
                sourceLabel: SOURCE_LABELS.SalesOrder,
                referenceNumber: order.orderNumber || "—",
                occurredAt: order.orderDate || order.createdAt,
                status: order.status || "",
                paymentStatus: order.paymentStatus || "",
                paymentMethod: order.paymentMethod || "",
                items: lineItems,
                itemCount: lineItems.reduce((s, i) => s + i.qty, 0),
                subtotal: money(order.subtotal),
                total: money(order.grandTotal),
                paid: money(order.paidAmount),
                due: money(order.dueAmount),
                gatewayRef: order.referenceNumber || "",
                linkedSalesOrderId: ""
            });
        }
    }

    if (want("RepairTicket")) {
        const rtFilter = {
            ...NOT_DELETED,
            ...tenant
        };
        const phone = String(customer.phone || "").trim();
        if (phone) {
            rtFilter.$or = [{ customerId: id }, { phone }];
        } else {
            rtFilter.customerId = id;
        }
        if (dateFrom || dateTo) {
            rtFilter.receivedDate = {};
            if (dateFrom) rtFilter.receivedDate.$gte = dateFrom;
            if (dateTo) rtFilter.receivedDate.$lte = dateTo;
        }

        const tickets = await RepairTicket.find(rtFilter)
            .sort({ receivedDate: -1, createdAt: -1 })
            .lean();

        for (const ticket of tickets) {
            const lineItems = mapRepairItems(ticket);
            rows.push({
                id: String(ticket._id),
                source: "RepairTicket",
                sourceLabel: SOURCE_LABELS.RepairTicket,
                referenceNumber:
                    ticket.ticketNumber || ticket.repairCode || "—",
                occurredAt:
                    ticket.receivedDate ||
                    ticket.completedDate ||
                    ticket.createdAt,
                status: ticket.status || "",
                paymentStatus: ticket.paymentStatus || "",
                paymentMethod: ticket.paymentMethod || "",
                items: lineItems,
                itemCount: lineItems.reduce((s, i) => s + i.qty, 0),
                subtotal: money(ticket.totalAmount),
                total: money(ticket.totalAmount),
                paid: money(ticket.paidAmount),
                due: money(ticket.dueAmount),
                gatewayRef: "",
                linkedSalesOrderId: "",
                serviceCompletedAt: ticket.completedDate || null,
                pickupAt: ticket.pickupDate || null
            });
        }
    }

    let filtered = rows;

    if (paymentMethods.length) {
        const set = new Set(paymentMethods.map((m) => m.toLowerCase()));
        filtered = filtered.filter((r) =>
            set.has(String(r.paymentMethod || "").toLowerCase())
        );
    }
    if (paymentStatuses.length) {
        const set = new Set(paymentStatuses.map((m) => m.toLowerCase()));
        filtered = filtered.filter((r) =>
            set.has(String(r.paymentStatus || "").toLowerCase())
        );
    }
    if (statuses.length) {
        const set = new Set(statuses.map((m) => m.toLowerCase()));
        filtered = filtered.filter((r) =>
            set.has(String(r.status || "").toLowerCase())
        );
    }
    if (dueOnly) {
        filtered = filtered.filter((r) => money(r.due) > 0);
    }
    if (search) {
        filtered = filtered.filter((r) => matchesSearch(r, search));
    }

    filtered.sort((a, b) => {
        const ta = new Date(a.occurredAt || 0).getTime();
        const tb = new Date(b.occurredAt || 0).getTime();
        return tb - ta;
    });

    const summary = filtered.reduce(
        (acc, row) => {
            acc.movementCount += 1;
            acc.itemCount += money(row.itemCount);
            acc.totalAmount += money(row.total);
            acc.paidAmount += money(row.paid);
            acc.dueAmount += money(row.due);
            acc.bySource[row.source] = (acc.bySource[row.source] || 0) + 1;
            return acc;
        },
        {
            movementCount: 0,
            itemCount: 0,
            totalAmount: 0,
            paidAmount: 0,
            dueAmount: 0,
            bySource: {}
        }
    );

    const total = filtered.length;
    const pages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    const items = filtered.slice(start, start + limit);

    const paymentMethodOptions = [
        ...new Set(rows.map((r) => r.paymentMethod).filter(Boolean))
    ].sort();
    const paymentStatusOptions = [
        ...new Set(rows.map((r) => r.paymentStatus).filter(Boolean))
    ].sort();
    const statusOptions = [
        ...new Set(rows.map((r) => r.status).filter(Boolean))
    ].sort();

    return {
        customer: {
            id: String(customer._id),
            customerCode: customer.customerCode || "",
            name: customer.name || "",
            phone: customer.phone || "",
            email: customer.email || "",
            source: customer.source || "Manual",
            status: customer.status || "",
            totalSalesAmount: money(customer.totalSalesAmount),
            totalPaidAmount: money(customer.totalPaidAmount),
            totalDueAmount: money(customer.totalDueAmount)
        },
        summary,
        filters: {
            sources: ["SalesOrder", "RepairTicket", "OnlineOrder"],
            paymentMethods: paymentMethodOptions,
            paymentStatuses: paymentStatusOptions,
            statuses: statusOptions
        },
        items,
        pagination: {
            page: safePage,
            limit,
            total,
            pages
        }
    };
};

module.exports = {
    getCustomerHistory
};
