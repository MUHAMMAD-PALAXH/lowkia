const mongoose = require("mongoose");
const SalesOrder = require("../model/salesOrder");
const SalesReturn = require("../model/salesReturn");
const StockMovement = require("../model/StockMovement");
const AppError = require("../utils/appError");
const { companySnapshot } = require("./financeReportService");

const MAX_TOP_ROWS = 10;
const objectId = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;
const number = (value) => Number(value) || 0;
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
        new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    if (from > to) throw new AppError("'from' must be before or equal to 'to'.", 422);
    const duration = to.getTime() - from.getTime() + 1;
    return {
        from,
        to,
        previousFrom: new Date(from.getTime() - duration),
        previousTo: new Date(from.getTime() - 1),
    };
};

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

const buildOrderMatch = (companyId, query, managedBranchIds, from, to) => {
    const match = {
        companyId: objectId(companyId),
        isDeleted: { $ne: true },
        orderDate: { $gte: from, $lte: to },
    };
    applyBranchScope(match, query.branchId, managedBranchIds);
    if (query.warehouseId) match.warehouseId = objectId(query.warehouseId);
    match.status = query.status || { $ne: "Cancelled" };
    if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) match.paymentMethod = query.paymentMethod;
    if (query.salesType) match.salesType = query.salesType;
    if (query.search) {
        const regex = new RegExp(escapeRegex(query.search.trim()), "i");
        match.$or = [
            { orderNumber: regex },
            { referenceNumber: regex },
            { customerName: regex },
            { customerPhone: regex },
            { customerEmail: regex },
            { "items.productName": regex },
            { "items.sku": regex },
        ];
    }
    return match;
};

const dateKeyExpression = (field, groupBy) => {
    if (groupBy === "month") {
        return { $dateToString: { format: "%Y-%m", date: field, timezone: "UTC" } };
    }
    if (groupBy === "week") {
        return {
            $dateToString: {
                format: "%Y-%m-%d",
                date: { $dateTrunc: { date: field, unit: "week", startOfWeek: "monday" } },
                timezone: "UTC",
            },
        };
    }
    return { $dateToString: { format: "%Y-%m-%d", date: field, timezone: "UTC" } };
};

const dashboardFacet = (groupBy) => ({
    summary: [
        {
            $group: {
                _id: null,
                orderCount: { $sum: 1 },
                grossSales: { $sum: "$grandTotal" },
                paidAmount: { $sum: "$paidAmount" },
                dueAmount: { $sum: "$dueAmount" },
                unitsSold: { $sum: { $sum: "$items.quantity" } },
                stockUpdatedCount: { $sum: { $cond: ["$stockUpdated", 1, 0] } },
            },
        },
    ],
    trend: [
        {
            $group: {
                _id: dateKeyExpression("$orderDate", groupBy),
                grossSales: { $sum: "$grandTotal" },
                paidAmount: { $sum: "$paidAmount" },
                dueAmount: { $sum: "$dueAmount" },
                orderCount: { $sum: 1 },
                unitsSold: { $sum: { $sum: "$items.quantity" } },
            },
        },
        { $sort: { _id: 1 } },
    ],
    statusBreakdown: [
        { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$grandTotal" } } },
        { $sort: { amount: -1 } },
    ],
    paymentStatusBreakdown: [
        {
            $group: {
                _id: "$paymentStatus",
                count: { $sum: 1 },
                amount: { $sum: "$grandTotal" },
                paidAmount: { $sum: "$paidAmount" },
                dueAmount: { $sum: "$dueAmount" },
            },
        },
        { $sort: { amount: -1 } },
    ],
    paymentMethodBreakdown: [
        {
            $group: {
                _id: "$paymentMethod",
                count: { $sum: 1 },
                amount: { $sum: "$grandTotal" },
                paidAmount: { $sum: "$paidAmount" },
            },
        },
        { $sort: { amount: -1 } },
    ],
    branchBreakdown: [
        {
            $group: {
                _id: "$branchId",
                count: { $sum: 1 },
                amount: { $sum: "$grandTotal" },
                paidAmount: { $sum: "$paidAmount" },
                dueAmount: { $sum: "$dueAmount" },
            },
        },
        {
            $lookup: {
                from: "branches",
                localField: "_id",
                foreignField: "_id",
                as: "branch",
            },
        },
        {
            $project: {
                _id: 0,
                branchId: "$_id",
                branchName: { $ifNull: [{ $first: "$branch.name" }, "Unassigned"] },
                branchCode: { $ifNull: [{ $first: "$branch.branchCode" }, ""] },
                count: 1,
                amount: 1,
                paidAmount: 1,
                dueAmount: 1,
            },
        },
        { $sort: { amount: -1 } },
    ],
    salesTypeBreakdown: [
        { $group: { _id: "$salesType", count: { $sum: 1 }, amount: { $sum: "$grandTotal" } } },
        { $sort: { amount: -1 } },
    ],
    topProducts: [
        { $unwind: "$items" },
        {
            $group: {
                _id: { productId: "$items.productId", productVariantId: "$items.productVariantId" },
                productName: { $first: "$items.productName" },
                sku: { $first: "$items.sku" },
                quantity: { $sum: "$items.quantity" },
                revenue: { $sum: "$items.total" },
            },
        },
        { $sort: { revenue: -1, quantity: -1 } },
        { $limit: MAX_TOP_ROWS },
        {
            $project: {
                _id: 0,
                productId: "$_id.productId",
                productVariantId: "$_id.productVariantId",
                productName: 1,
                sku: 1,
                quantity: 1,
                revenue: 1,
            },
        },
    ],
    topCustomers: [
        {
            $group: {
                _id: "$customerId",
                customerName: { $first: "$customerName" },
                customerPhone: { $first: "$customerPhone" },
                orderCount: { $sum: 1 },
                amount: { $sum: "$grandTotal" },
            },
        },
        { $sort: { amount: -1, orderCount: -1 } },
        { $limit: MAX_TOP_ROWS },
        {
            $project: {
                _id: 0,
                customerId: "$_id",
                customerName: 1,
                customerPhone: 1,
                orderCount: 1,
                amount: 1,
            },
        },
    ],
});

const getOrderDashboardAggregate = async (match, groupBy) => {
    const rows = await SalesOrder.aggregate([
        { $match: match },
        { $facet: dashboardFacet(groupBy) },
    ]);
    return rows[0] || {};
};

const getReturnAggregate = async ({
    companyId,
    query,
    managedBranchIds,
    from,
    to,
    groupBy,
}) => {
    const returnMatch = {
        isDeleted: { $ne: true },
        status: { $in: ["Received", "Refunded"] },
        returnDate: { $gte: from, $lte: to },
    };
    applyBranchScope(returnMatch, query.branchId, managedBranchIds);
    if (query.warehouseId) returnMatch.warehouseId = objectId(query.warehouseId);

    const linkedOrderMatch = buildOrderMatch(
        companyId,
        query,
        managedBranchIds,
        new Date(0),
        new Date("9999-12-31T23:59:59.999Z")
    );
    delete linkedOrderMatch.orderDate;

    const rows = await SalesReturn.aggregate([
        { $match: returnMatch },
        {
            $lookup: {
                from: SalesOrder.collection.name,
                localField: "salesOrderId",
                foreignField: "_id",
                pipeline: [{ $match: linkedOrderMatch }, { $project: { _id: 1 } }],
                as: "tenantOrder",
            },
        },
        { $match: { "tenantOrder.0": { $exists: true } } },
        {
            $facet: {
                summary: [
                    {
                        $group: {
                            _id: null,
                            returnCount: { $sum: 1 },
                            returnAmount: { $sum: "$refundAmount" },
                            unitsReturned: { $sum: { $sum: "$items.returnQuantity" } },
                        },
                    },
                ],
                trend: [
                    {
                        $group: {
                            _id: dateKeyExpression("$returnDate", groupBy),
                            returnCount: { $sum: 1 },
                            returnAmount: { $sum: "$refundAmount" },
                            unitsReturned: { $sum: { $sum: "$items.returnQuantity" } },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
            },
        },
    ]);
    return rows[0] || {};
};

const periodKeys = (from, to, groupBy) => {
    const keys = [];
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    if (groupBy === "week") {
        const day = cursor.getUTCDay() || 7;
        cursor.setUTCDate(cursor.getUTCDate() - day + 1);
    } else if (groupBy === "month") {
        cursor.setUTCDate(1);
    }
    while (cursor <= to) {
        keys.push(
            groupBy === "month"
                ? cursor.toISOString().slice(0, 7)
                : cursor.toISOString().slice(0, 10)
        );
        if (groupBy === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        else cursor.setUTCDate(cursor.getUTCDate() + (groupBy === "week" ? 7 : 1));
    }
    return keys;
};

const mergeTrend = (from, to, groupBy, orderRows = [], returnRows = []) => {
    const orders = new Map(orderRows.map((row) => [row._id, row]));
    const returns = new Map(returnRows.map((row) => [row._id, row]));
    return periodKeys(from, to, groupBy).map((period) => {
        const sale = orders.get(period) || {};
        const returned = returns.get(period) || {};
        const grossSales = number(sale.grossSales);
        const returnAmount = number(returned.returnAmount);
        return {
            period,
            grossSales,
            returnAmount,
            netSales: grossSales - returnAmount,
            paidAmount: number(sale.paidAmount),
            dueAmount: number(sale.dueAmount),
            orderCount: number(sale.orderCount),
            returnCount: number(returned.returnCount),
            unitsSold: number(sale.unitsSold),
            unitsReturned: number(returned.unitsReturned),
        };
    });
};

const comparison = (current, previous) => {
    const change = current - previous;
    return {
        current,
        previous,
        change,
        percentChange: previous === 0 ? (current === 0 ? 0 : null) : (change / previous) * 100,
    };
};

const breakdownRows = (rows = []) =>
    rows.map(({ _id, ...rest }) => ({ key: _id || "Unspecified", ...rest }));

const getCogs = async (match, summary) => {
    const orderIds = await SalesOrder.distinct("_id", match);
    if (!orderIds.length) {
        return { amount: 0, reliable: false, coveredOrders: 0, eligibleOrders: 0 };
    }
    const rows = await StockMovement.aggregate([
        {
            $match: {
                salesOrderId: { $in: orderIds },
                movementType: "Sale",
                movementDirection: "OUT",
                totalCost: { $gt: 0 },
            },
        },
        {
            $group: {
                _id: "$salesOrderId",
                amount: { $sum: "$totalCost" },
            },
        },
        { $group: { _id: null, amount: { $sum: "$amount" }, coveredOrders: { $sum: 1 } } },
    ]);
    const row = rows[0] || {};
    const eligibleOrders = number(summary.stockUpdatedCount);
    const reliable =
        eligibleOrders > 0 &&
        eligibleOrders === number(summary.orderCount) &&
        number(row.coveredOrders) === eligibleOrders;
    return {
        amount: reliable ? number(row.amount) : 0,
        reliable,
        coveredOrders: number(row.coveredOrders),
        eligibleOrders,
    };
};

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    if (!objectId(companyId)) throw new AppError("Company context is required.", 403);
    const period = resolvePeriod(query);
    const groupBy = query.groupBy || "day";
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
    const currentMatch = buildOrderMatch(
        companyId,
        query,
        managedBranchIds,
        period.from,
        period.to
    );
    const previousMatch = buildOrderMatch(
        companyId,
        query,
        managedBranchIds,
        period.previousFrom,
        period.previousTo
    );

    const [company, current, previous, returns, previousReturns, total, transactions] =
        await Promise.all([
            companySnapshot(companyId),
            getOrderDashboardAggregate(currentMatch, groupBy),
            getOrderDashboardAggregate(previousMatch, groupBy),
            getReturnAggregate({ companyId, query, managedBranchIds, ...period, groupBy }),
            getReturnAggregate({
                companyId,
                query,
                managedBranchIds,
                from: period.previousFrom,
                to: period.previousTo,
                groupBy,
            }),
            SalesOrder.countDocuments(currentMatch),
            SalesOrder.find(currentMatch)
                .select(
                    "orderNumber referenceNumber orderDate customerId customerName customerPhone branchId warehouseId salesType status paymentStatus paymentMethod subtotal discount tax shippingCost otherCharges grandTotal paidAmount dueAmount items"
                )
                .populate("branchId", "branchCode name")
                .populate("warehouseId", "warehouseCode warehouseName")
                .sort({ orderDate: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);

    const currentSummary = current.summary?.[0] || {};
    const previousSummary = previous.summary?.[0] || {};
    const returnSummary = returns.summary?.[0] || {};
    const previousReturnSummary = previousReturns.summary?.[0] || {};
    const grossSales = number(currentSummary.grossSales);
    const returnAmount = number(returnSummary.returnAmount);
    const netSales = grossSales - returnAmount;
    const previousGross = number(previousSummary.grossSales);
    const previousReturnAmount = number(previousReturnSummary.returnAmount);
    const previousNet = previousGross - previousReturnAmount;
    const cogs = await getCogs(currentMatch, currentSummary);

    return {
        meta: {
            reportType: "sales_dashboard",
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
                status: query.status || "excluding Cancelled",
                paymentStatus: query.paymentStatus || null,
                paymentMethod: query.paymentMethod || null,
                salesType: query.salesType || null,
                search: query.search || null,
                groupBy,
            },
            cogs: {
                source: "StockMovement(Sale/OUT/totalCost)",
                reliable: cogs.reliable,
                coveredOrders: cogs.coveredOrders,
                eligibleOrders: cogs.eligibleOrders,
                note: cogs.reliable
                    ? null
                    : "COGS and gross profit are 0 because complete StockMovement cost coverage was not available.",
            },
        },
        summary: {
            orderCount: number(currentSummary.orderCount),
            returnCount: number(returnSummary.returnCount),
            grossSales,
            returnAmount,
            netSales,
            paidAmount: number(currentSummary.paidAmount),
            dueAmount: number(currentSummary.dueAmount),
            unitsSold: number(currentSummary.unitsSold),
            unitsReturned: number(returnSummary.unitsReturned),
            averageOrderValue:
                number(currentSummary.orderCount) > 0
                    ? grossSales / number(currentSummary.orderCount)
                    : 0,
            cogs: cogs.amount,
            grossProfit: cogs.reliable ? netSales - cogs.amount : 0,
        },
        comparison: {
            period: {
                from: period.previousFrom.toISOString(),
                to: period.previousTo.toISOString(),
            },
            grossSales: comparison(grossSales, previousGross),
            returnAmount: comparison(returnAmount, previousReturnAmount),
            netSales: comparison(netSales, previousNet),
            orderCount: comparison(
                number(currentSummary.orderCount),
                number(previousSummary.orderCount)
            ),
            paidAmount: comparison(
                number(currentSummary.paidAmount),
                number(previousSummary.paidAmount)
            ),
        },
        trend: mergeTrend(
            period.from,
            period.to,
            groupBy,
            current.trend,
            returns.trend
        ),
        statusBreakdown: breakdownRows(current.statusBreakdown),
        paymentBreakdown: {
            byStatus: breakdownRows(current.paymentStatusBreakdown),
            byMethod: breakdownRows(current.paymentMethodBreakdown),
        },
        branchBreakdown: current.branchBreakdown || [],
        salesTypeBreakdown: breakdownRows(current.salesTypeBreakdown),
        topProducts: current.topProducts || [],
        topCustomers: current.topCustomers || [],
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
