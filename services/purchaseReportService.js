const mongoose = require("mongoose");
const PurchaseOrder = require("../model/purchaseOrder");
const SupplierPayable = require("../model/supplierPayable");
const Payment = require("../model/payment");
const GRN = require("../model/grn");
const PurchaseReturn = require("../model/purchaseReturn");
const Supplier = require("../model/supplier");
const Branch = require("../model/branch");
const AppError = require("../utils/appError");
const { toMajor } = require("../utils/money");
const { companySnapshot } = require("./financeReportService");

const MAX_TOP_ROWS = 10;
const DAY_MS = 86_400_000;
const number = (value) => Number(value) || 0;
const idString = (value) => (value == null ? "" : String(value._id || value));
const objectId = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;
const escapeRegex = (value = "") =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const utcDayBound = (value, end = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        date.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    }
    return date;
};

const resolvePeriod = (query) => {
    const to = utcDayBound(query.to, true) || new Date();
    const from =
        utcDayBound(query.from, false) ||
        new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new AppError("'from' must be before or equal to 'to'.", 422);
    if ((to.getTime() - from.getTime()) / DAY_MS > 731) {
        throw new AppError("Date range cannot exceed 731 days.", 422);
    }
    const duration = to.getTime() - from.getTime() + 1;
    return {
        from,
        to,
        previousFrom: new Date(from.getTime() - duration),
        previousTo: new Date(from.getTime() - 1),
    };
};

// Keep this behavior aligned with salesReportService: null means unrestricted admin scope.
const applyBranchScope = (match, requestedBranchId, managedBranchIds) => {
    const requested = objectId(requestedBranchId);
    if (managedBranchIds === null) {
        if (requested) match.branchId = requested;
        return;
    }
    const allowed = (managedBranchIds || []).map(String);
    if (requested) {
        if (!allowed.includes(String(requested))) {
            throw new AppError("You cannot access sales outside your branches.", 403);
        }
        match.branchId = requested;
    } else {
        match.branchId = { $in: managedBranchIds || [] };
    }
};

const supplierIdsForSearch = async (companyId, search) => {
    if (!search) return [];
    const regex = new RegExp(escapeRegex(search.trim()), "i");
    return Supplier.distinct("_id", {
        companyId: objectId(companyId),
        isDeleted: { $ne: true },
        $or: [{ name: regex }, { companyName: regex }, { supplierCode: regex }],
    });
};

const buildOrderMatch = (
    companyId,
    query,
    managedBranchIds,
    from,
    to,
    searchSupplierIds = []
) => {
    const match = {
        companyId: objectId(companyId),
        isDeleted: { $ne: true },
        orderDate: { $gte: from, $lte: to },
    };
    applyBranchScope(match, query.branchId, managedBranchIds);
    if (query.warehouseId) match.warehouseId = objectId(query.warehouseId);
    if (query.supplierId) match.supplierId = objectId(query.supplierId);
    if (query.status) match.status = query.status;
    else match.status = { $nin: ["Cancelled", "Supplier Rejected"] };
    if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
    if (query.purchaseType) match.purchaseType = query.purchaseType;
    if (query.search) {
        const regex = new RegExp(escapeRegex(query.search.trim()), "i");
        match.$or = [
            { purchaseOrderNo: regex },
            { referenceNo: regex },
            { "items.productName": regex },
            { "items.sku": regex },
            ...(searchSupplierIds.length
                ? [{ supplierId: { $in: searchSupplierIds } }]
                : []),
        ];
    }
    return match;
};

const poProjection =
    "purchaseOrderNo referenceNo orderDate supplierId branchId warehouseId status paymentStatus purchaseType grandTotal paidAmount dueAmount items";

const loadPeriod = async (match, from, to) => {
    const orders = await PurchaseOrder.find(match).select(poProjection).lean();
    const poIds = orders.map((row) => row._id);
    if (!poIds.length) {
        return { orders, payables: [], payments: [], returns: [] };
    }

    const payables = await SupplierPayable.find({
        companyId: match.companyId,
        isDeleted: { $ne: true },
        purchaseOrderId: { $in: poIds },
    }).lean();
    const payableIds = payables.map((row) => row._id);

    const paymentLinks = [
        { purchaseOrderId: { $in: poIds } },
        { "allocations.targetId": { $in: poIds } },
    ];
    if (payableIds.length) {
        paymentLinks.push(
            { supplierPayableId: { $in: payableIds } },
            { "allocations.targetId": { $in: payableIds } }
        );
    }

    const grnsPromise = GRN.find({
        purchaseOrderId: { $in: poIds },
        isDeleted: { $ne: true },
    })
        .select("_id purchaseOrderId")
        .lean();
    const paymentsPromise = Payment.find({
        companyId: match.companyId,
        isDeleted: { $ne: true },
        paymentType: { $in: ["SupplierPayment", "SupplierAdvance"] },
        status: "paid",
        originalPaymentId: null,
        $or: paymentLinks,
    })
        .select(
            "purchaseOrderId supplierPayableId partyId paymentMethod amountMinor allocations"
        )
        .lean();

    const [grns, payments] = await Promise.all([grnsPromise, paymentsPromise]);
    const poByGrn = new Map(grns.map((row) => [idString(row._id), row.purchaseOrderId]));
    const grnIds = grns.map((row) => row._id);
    const returns = grnIds.length
        ? await PurchaseReturn.find({
              grnId: { $in: grnIds },
              isDeleted: { $ne: true },
              status: { $in: ["Stock Returned", "Completed"] },
              returnDate: { $gte: from, $lte: to },
          })
              .select("grnId returnDate grandTotal items")
              .lean()
        : [];
    for (const row of returns) row.purchaseOrderId = poByGrn.get(idString(row.grnId));
    return { orders, payables, payments, returns };
};

const orderUnits = (order, field) =>
    (order.items || []).reduce((sum, item) => sum + number(item[field]), 0);
const itemReceivedValue = (order) =>
    (order.items || []).reduce(
        (sum, item) => sum + number(item.receivedQuantity) * number(item.purchasePrice),
        0
    );

const payableMaps = (payables) => {
    const byPo = new Map();
    const byId = new Map();
    for (const row of payables) {
        byPo.set(idString(row.purchaseOrderId), row);
        byId.set(idString(row._id), row);
    }
    return { byPo, byId };
};

const linkedPaymentAmountMinor = (payment, payableById, validPoIds) => {
    if (validPoIds.has(idString(payment.purchaseOrderId))) {
        return number(payment.amountMinor);
    }
    const payable = payableById.get(idString(payment.supplierPayableId));
    if (payable && validPoIds.has(idString(payable.purchaseOrderId))) {
        return number(payment.amountMinor);
    }
    return (payment.allocations || []).reduce((sum, allocation) => {
        const target = idString(allocation.targetId);
        const allocatedPayable = payableById.get(target);
        const linked =
            validPoIds.has(target) ||
            (allocatedPayable &&
                validPoIds.has(idString(allocatedPayable.purchaseOrderId)));
        return sum + (linked ? number(allocation.amountMinor) : 0);
    }, 0);
};

const receivedForOrder = (order, payableByPo) => {
    const payable = payableByPo.get(idString(order._id));
    return payable
        ? toMajor(number(payable.grnReceivedValueMinor))
        : itemReceivedValue(order);
};

const periodTotals = (data) => {
    const { byPo, byId } = payableMaps(data.payables);
    const validPoIds = new Set(data.orders.map((row) => idString(row._id)));
    const poCommitment = data.orders.reduce((sum, row) => sum + number(row.grandTotal), 0);
    const receivedValue = data.orders.reduce(
        (sum, row) => sum + receivedForOrder(row, byPo),
        0
    );
    const returnAmount = data.returns.reduce(
        (sum, row) => sum + number(row.grandTotal),
        0
    );
    return {
        poCount: data.orders.length,
        poCommitment,
        receivedValue,
        returnAmount,
        paymentsPaid: toMajor(
            data.payments.reduce(
                (sum, row) =>
                    sum + linkedPaymentAmountMinor(row, byId, validPoIds),
                0
            )
        ),
    };
};

const periodStart = (value, groupBy) => {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    if (groupBy === "week") {
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
    } else if (groupBy === "month") {
        date.setUTCDate(1);
    }
    return date;
};

const periodKey = (value, groupBy) =>
    periodStart(value, groupBy).toISOString().slice(0, 10);

const periodKeys = (from, to, groupBy) => {
    const keys = [];
    const cursor = periodStart(from, groupBy);
    while (cursor <= to) {
        keys.push(cursor.toISOString().slice(0, 10));
        if (groupBy === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        else cursor.setUTCDate(cursor.getUTCDate() + (groupBy === "week" ? 7 : 1));
    }
    return keys;
};

const comparison = (current, previous) => {
    const change = current - previous;
    return {
        current,
        previous,
        change,
        changePercent:
            previous === 0 ? (current === 0 ? 0 : null) : (change / previous) * 100,
    };
};

const breakdownRows = (rows) => {
    const total = rows.reduce((sum, row) => sum + number(row.count), 0);
    return rows
        .map((row) => ({
            ...row,
            percentage: total ? (number(row.count) / total) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
};

const groupedRows = (orders, keyField) => {
    const groups = new Map();
    for (const order of orders) {
        const key = order[keyField] || "Unspecified";
        const current = groups.get(key) || { key, label: key, count: 0, amount: 0 };
        current.count += 1;
        current.amount += number(order.grandTotal);
        groups.set(key, current);
    }
    return breakdownRows([...groups.values()]);
};

const buildTrend = (data, from, to, groupBy) => {
    const rows = new Map(
        periodKeys(from, to, groupBy).map((date) => [
            date,
            {
                date,
                label: date,
                period: date,
                poCommitment: 0,
                receivedValue: 0,
                returnAmount: 0,
                netReceivedValue: 0,
                poCount: 0,
                unitsOrdered: 0,
                unitsReceived: 0,
            },
        ])
    );
    const { byPo } = payableMaps(data.payables);
    for (const order of data.orders) {
        const row = rows.get(periodKey(order.orderDate, groupBy));
        if (!row) continue;
        row.poCommitment += number(order.grandTotal);
        row.receivedValue += receivedForOrder(order, byPo);
        row.poCount += 1;
        row.unitsOrdered += orderUnits(order, "quantity");
        row.unitsReceived += orderUnits(order, "receivedQuantity");
    }
    for (const returned of data.returns) {
        const row = rows.get(periodKey(returned.returnDate, groupBy));
        if (row) row.returnAmount += number(returned.grandTotal);
    }
    for (const row of rows.values()) {
        row.netReceivedValue = row.receivedValue - row.returnAmount;
    }
    return [...rows.values()];
};

const buildEntityBreakdowns = (data, suppliers, branches) => {
    const { byPo } = payableMaps(data.payables);
    const supplierGroups = new Map();
    const branchGroups = new Map();
    for (const order of data.orders) {
        const payable = byPo.get(idString(order._id)) || {};
        const receivedValue = receivedForOrder(order, byPo);
        const outstanding = toMajor(number(payable.outstandingMinor));
        for (const [field, map] of [
            ["supplierId", supplierGroups],
            ["branchId", branchGroups],
        ]) {
            const id = idString(order[field]);
            const row = map.get(id) || {
                id,
                count: 0,
                amount: 0,
                receivedValue: 0,
                outstanding: 0,
            };
            row.count += 1;
            row.amount += number(order.grandTotal);
            row.receivedValue += receivedValue;
            row.outstanding += outstanding;
            map.set(id, row);
        }
    }
    const supplierBreakdown = [...supplierGroups.values()]
        .map((row) => {
            const supplier = suppliers.get(row.id) || {};
            const supplierName = supplier.name || supplier.companyName || "Unassigned";
            return {
                supplierId: row.id || null,
                supplierCode: supplier.supplierCode || "",
                supplierName,
                label: supplierName,
                count: row.count,
                amount: row.amount,
                receivedValue: row.receivedValue,
                outstanding: row.outstanding,
            };
        })
        .sort((a, b) => b.amount - a.amount);
    const branchBreakdown = [...branchGroups.values()]
        .map((row) => {
            const branch = branches.get(row.id) || {};
            const branchName = branch.name || "Unassigned";
            return {
                branchId: row.id || null,
                branchCode: branch.branchCode || "",
                branchName,
                label: branchName,
                count: row.count,
                amount: row.amount,
                receivedValue: row.receivedValue,
                outstanding: row.outstanding,
            };
        })
        .sort((a, b) => b.amount - a.amount);
    return { supplierBreakdown, branchBreakdown };
};

const buildTopSuppliers = (data, supplierBreakdown) => {
    const { byId } = payableMaps(data.payables);
    const validPoIds = new Set(data.orders.map((row) => idString(row._id)));
    const paymentBySupplier = new Map();
    for (const payment of data.payments) {
        const key = idString(payment.partyId);
        paymentBySupplier.set(
            key,
            number(paymentBySupplier.get(key)) +
                toMajor(linkedPaymentAmountMinor(payment, byId, validPoIds))
        );
    }
    const orderGroups = new Map();
    for (const order of data.orders) {
        const key = idString(order.supplierId);
        const row = orderGroups.get(key) || {
            unitsOrdered: 0,
            unitsReceived: 0,
        };
        row.unitsOrdered += orderUnits(order, "quantity");
        row.unitsReceived += orderUnits(order, "receivedQuantity");
        orderGroups.set(key, row);
    }
    return supplierBreakdown.slice(0, MAX_TOP_ROWS).map((supplier) => {
        const units = orderGroups.get(idString(supplier.supplierId)) || {};
        const unitsOrdered = number(units.unitsOrdered);
        const unitsReceived = number(units.unitsReceived);
        return {
            supplierId: supplier.supplierId,
            id: supplier.supplierId,
            supplierCode: supplier.supplierCode,
            supplierName: supplier.supplierName,
            name: supplier.supplierName,
            poCount: supplier.count,
            orders: supplier.count,
            poCommitment: supplier.amount,
            sales: supplier.amount,
            amount: supplier.amount,
            receivedValue: supplier.receivedValue,
            paymentsPaid: number(paymentBySupplier.get(idString(supplier.supplierId))),
            outstanding: supplier.outstanding,
            unitsOrdered,
            unitsReceived,
            units: unitsReceived,
            receiptRate: unitsOrdered ? unitsReceived / unitsOrdered : 0,
        };
    });
};

const buildTopProducts = (data) => {
    const returnsByProduct = new Map();
    for (const returned of data.returns) {
        for (const item of returned.items || []) {
            const key = `${idString(item.productId)}:${idString(item.productVariantId)}`;
            returnsByProduct.set(
                key,
                number(returnsByProduct.get(key)) + number(item.quantity)
            );
        }
    }
    const groups = new Map();
    for (const order of data.orders) {
        for (const item of order.items || []) {
            const key = `${idString(item.productId)}:${idString(item.productVariantId)}`;
            const row = groups.get(key) || {
                productId: item.productId || null,
                productVariantId: item.productVariantId || null,
                productName: item.productName || "",
                variantLabel: item.variantLabel || "",
                sku: item.sku || "",
                poIds: new Set(),
                orderedUnits: 0,
                receivedUnits: 0,
                commitment: 0,
                receivedValue: 0,
            };
            row.poIds.add(idString(order._id));
            row.orderedUnits += number(item.quantity);
            row.receivedUnits += number(item.receivedQuantity);
            row.commitment += number(item.total);
            row.receivedValue +=
                number(item.receivedQuantity) * number(item.purchasePrice);
            groups.set(key, row);
        }
    }
    return [...groups.entries()]
        .map(([key, row]) => ({
            productId: row.productId,
            id: row.productId,
            productVariantId: row.productVariantId,
            productName: row.productName,
            name: row.productName,
            variantLabel: row.variantLabel,
            sku: row.sku,
            poCount: row.poIds.size,
            orders: row.poIds.size,
            orderedUnits: row.orderedUnits,
            receivedUnits: row.receivedUnits,
            units: row.orderedUnits,
            returnedUnits: number(returnsByProduct.get(key)),
            commitment: row.commitment,
            sales: row.commitment,
            amount: row.commitment,
            receivedValue: row.receivedValue,
            averageUnitCost:
                row.orderedUnits > 0 ? row.commitment / row.orderedUnits : 0,
        }))
        .sort((a, b) => b.commitment - a.commitment)
        .slice(0, MAX_TOP_ROWS);
};

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const tenantId = objectId(companyId);
    if (!tenantId) throw new AppError("Company context is required.", 403);
    const period = resolvePeriod(query);
    const groupBy = query.groupBy || "day";
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
    const searchSupplierIds = await supplierIdsForSearch(tenantId, query.search);
    const currentMatch = buildOrderMatch(
        tenantId,
        query,
        managedBranchIds,
        period.from,
        period.to,
        searchSupplierIds
    );
    const previousMatch = buildOrderMatch(
        tenantId,
        query,
        managedBranchIds,
        period.previousFrom,
        period.previousTo,
        searchSupplierIds
    );

    const [company, current, previous, total, transactionDocs] = await Promise.all([
        companySnapshot(tenantId),
        loadPeriod(currentMatch, period.from, period.to),
        loadPeriod(previousMatch, period.previousFrom, period.previousTo),
        PurchaseOrder.countDocuments(currentMatch),
        PurchaseOrder.find(currentMatch)
            .select(poProjection)
            .populate("supplierId", "supplierCode name companyName")
            .populate("branchId", "branchCode name")
            .populate("warehouseId", "warehouseCode warehouseName")
            .sort({ orderDate: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
    ]);

    const currentTotals = periodTotals(current);
    const previousTotals = periodTotals(previous);
    const { byPo: payableByPo } = payableMaps(current.payables);
    const supplierIds = [...new Set(current.orders.map((row) => idString(row.supplierId)))]
        .filter(Boolean)
        .map(objectId);
    const branchIds = [...new Set(current.orders.map((row) => idString(row.branchId)))]
        .filter(Boolean)
        .map(objectId);
    const [supplierDocs, branchDocs] = await Promise.all([
        Supplier.find({
            _id: { $in: supplierIds },
            companyId: tenantId,
            isDeleted: { $ne: true },
        })
            .select("supplierCode name companyName")
            .lean(),
        Branch.find({ _id: { $in: branchIds }, isDeleted: { $ne: true } })
            .select("branchCode name")
            .lean(),
    ]);
    const suppliers = new Map(supplierDocs.map((row) => [idString(row._id), row]));
    const branches = new Map(branchDocs.map((row) => [idString(row._id), row]));
    const { supplierBreakdown, branchBreakdown } = buildEntityBreakdowns(
        current,
        suppliers,
        branches
    );

    const returnUnits = current.returns.reduce(
        (sum, row) =>
            sum +
            (row.items || []).reduce(
                (itemSum, item) => itemSum + number(item.quantity),
                0
            ),
        0
    );
    const unitsOrdered = current.orders.reduce(
        (sum, row) => sum + orderUnits(row, "quantity"),
        0
    );
    const unitsReceived = current.orders.reduce(
        (sum, row) => sum + orderUnits(row, "receivedQuantity"),
        0
    );
    const payableMinor = (field) =>
        current.payables.reduce((sum, row) => sum + number(row[field]), 0);
    const poCommitmentComparison = comparison(
        currentTotals.poCommitment,
        previousTotals.poCommitment
    );
    const receivedComparison = comparison(
        currentTotals.receivedValue,
        previousTotals.receivedValue
    );
    const returnComparison = comparison(
        currentTotals.returnAmount,
        previousTotals.returnAmount
    );
    const paymentsComparison = comparison(
        currentTotals.paymentsPaid,
        previousTotals.paymentsPaid
    );
    const countComparison = comparison(currentTotals.poCount, previousTotals.poCount);

    const paymentMethodGroups = new Map();
    const validPoIds = new Set(current.orders.map((row) => idString(row._id)));
    const { byId: payableById } = payableMaps(current.payables);
    for (const payment of current.payments) {
        const linkedAmount = linkedPaymentAmountMinor(
            payment,
            payableById,
            validPoIds
        );
        if (!linkedAmount) continue;
        const key = payment.paymentMethod || "Unspecified";
        const row = paymentMethodGroups.get(key) || {
            key,
            label: key,
            count: 0,
            amount: 0,
        };
        row.count += 1;
        row.amount += toMajor(linkedAmount);
        paymentMethodGroups.set(key, row);
    }

    const transactions = transactionDocs.map((order) => {
        const supplier = order.supplierId || {};
        const branch = order.branchId || {};
        const warehouse = order.warehouseId || {};
        const payable = payableByPo.get(idString(order._id)) || {};
        const ordered = orderUnits(order, "quantity");
        const received = orderUnits(order, "receivedQuantity");
        const damaged = orderUnits(order, "damagedQuantity");
        const pending = orderUnits(order, "pendingQuantity");
        const receivedValue = receivedForOrder(order, payableByPo);
        return {
            _id: order._id,
            id: idString(order._id),
            purchaseOrderNo: order.purchaseOrderNo,
            number: order.purchaseOrderNo,
            referenceNo: order.referenceNo || "",
            orderDate: order.orderDate,
            date: order.orderDate,
            supplierId: supplier._id || null,
            supplierName: supplier.name || supplier.companyName || "Unassigned",
            supplier: { name: supplier.name || supplier.companyName || "Unassigned" },
            branchId: branch._id || null,
            branchName: branch.name || "Unassigned",
            branch: { name: branch.name || "Unassigned" },
            warehouseId: warehouse._id || null,
            warehouseName: warehouse.warehouseName || "Unassigned",
            status: order.status,
            paymentStatus: order.paymentStatus,
            purchaseType: order.purchaseType,
            grandTotal: number(order.grandTotal),
            poCommitment: number(order.grandTotal),
            receivedValue,
            paidAmount: number(order.paidAmount),
            dueAmount: number(order.dueAmount),
            outstanding: toMajor(number(payable.outstandingMinor)),
            remainingExposure: toMajor(number(payable.remainingExposureMinor)),
            unitsOrdered: ordered,
            unitsReceived: received,
            unitsDamaged: damaged,
            unitsPending: pending,
            receiptRate: ordered ? received / ordered : 0,
            items: (order.items || []).map((item) => ({
                productName: item.productName || "",
                name: item.productName || "",
                sku: item.sku || "",
                quantity: number(item.quantity),
                receivedQuantity: number(item.receivedQuantity),
                purchasePrice: number(item.purchasePrice),
                total: number(item.total),
            })),
        };
    });

    return {
        meta: {
            reportType: "purchase_dashboard",
            generatedAt: new Date().toISOString(),
            company,
            currency: company.currency || "USD",
            timezone: "UTC",
            companyTimezone: company.timezone || null,
            filters: {
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                branchId: query.branchId || null,
                warehouseId: query.warehouseId || null,
                supplierId: query.supplierId || null,
                status: query.status || null,
                paymentStatus: query.paymentStatus || null,
                purchaseType: query.purchaseType || null,
                search: query.search || null,
                groupBy,
            },
            commitmentPolicy: query.status
                ? "All purchase orders matching the requested status."
                : "Cancelled and Supplier Rejected purchase orders are excluded; Draft orders remain included.",
            returnSource:
                "Completed/Stock Returned PurchaseReturn documents linked through GRNs to tenant-scoped purchase orders.",
        },
        summary: {
            poCount: currentTotals.poCount,
            poCommitment: currentTotals.poCommitment,
            receivedValue: currentTotals.receivedValue,
            returnAmount: currentTotals.returnAmount,
            netReceivedValue:
                currentTotals.receivedValue - currentTotals.returnAmount,
            unitsOrdered,
            unitsReceived,
            unitsReturned: returnUnits,
            receiptRate: unitsOrdered ? unitsReceived / unitsOrdered : 0,
            averagePoValue:
                currentTotals.poCount > 0
                    ? currentTotals.poCommitment / currentTotals.poCount
                    : 0,
            advancePaid: toMajor(payableMinor("advancePaidMinor")),
            paymentsPaid: currentTotals.paymentsPaid,
            payableOutstanding: toMajor(payableMinor("outstandingMinor")),
            remainingExposure: toMajor(payableMinor("remainingExposureMinor")),
            paidAmount: current.orders.reduce(
                (sum, row) => sum + number(row.paidAmount),
                0
            ),
            dueAmount: current.orders.reduce(
                (sum, row) => sum + number(row.dueAmount),
                0
            ),
        },
        comparison: {
            period: {
                from: period.previousFrom.toISOString(),
                to: period.previousTo.toISOString(),
            },
            poCommitment: poCommitmentComparison,
            receivedValue: receivedComparison,
            returnAmount: returnComparison,
            paymentsPaid: paymentsComparison,
            poCount: countComparison,
            poCommitmentChangePercent: poCommitmentComparison.changePercent,
            receivedValueChangePercent: receivedComparison.changePercent,
            returnAmountChangePercent: returnComparison.changePercent,
            paymentsPaidChangePercent: paymentsComparison.changePercent,
            poCountChangePercent: countComparison.changePercent,
        },
        trend: buildTrend(current, period.from, period.to, groupBy),
        statusBreakdown: groupedRows(current.orders, "status"),
        paymentStatusBreakdown: groupedRows(current.orders, "paymentStatus"),
        paymentMethodBreakdown: breakdownRows([...paymentMethodGroups.values()]),
        branchBreakdown,
        supplierBreakdown,
        topSuppliers: buildTopSuppliers(current, supplierBreakdown),
        topProducts: buildTopProducts(current),
        transactions: {
            items: transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            },
        },
    };
};

module.exports = { getDashboard };
