const mongoose = require("mongoose");
const SalesOrder = require("../model/salesOrder");
const SalesReturn = require("../model/salesReturn");
const OnlineOrder = require("../model/order");
const Product = require("../model/product");
const StockMovement = require("../model/StockMovement");
const RepairTicket = require("../model/repairTicket");
const Expense = require("../model/expense");
const PayrollRun = require("../model/payrollRun");
const Journal = require("../model/journal");
const Account = require("../model/account");
const AdminUser = require("../model/adminUser");
const Branch = require("../model/branch");
const Company = require("../model/company");
const AppError = require("../utils/appError");
const { toMajor } = require("../utils/money");
const { companySnapshot } = require("./financeReportService");

const DAY_MS = 86_400_000;
const n = (value) => Number(value) || 0;
const id = (value) => (value == null ? "" : String(value._id || value));
const oid = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;

const utcBound = (value, end = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        date.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    }
    return date;
};

const resolvePeriod = (query) => {
    const to = utcBound(query.to, true) || new Date();
    const from = utcBound(query.from, false) || new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new AppError("'from' must be before or equal to 'to'.", 422);
    if ((to - from) / DAY_MS > 731) {
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

const applyBranchScope = (match, requestedBranchId, managedBranchIds) => {
    const requested = oid(requestedBranchId);
    if (managedBranchIds === null) {
        if (requested) match.branchId = requested;
        return;
    }
    const allowed = (managedBranchIds || []).map(String);
    if (requested) {
        if (!allowed.includes(String(requested))) {
            throw new AppError(
                "You cannot access profit and loss outside your branches.",
                403
            );
        }
        match.branchId = requested;
    } else {
        match.branchId = { $in: managedBranchIds || [] };
    }
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

const payrollRecognitionDate = (run) =>
    run.paidAt ||
    run.lockedAt ||
    run.approvedAt ||
    new Date(Date.UTC(run.payrollYear, run.payrollMonth, 0, 23, 59, 59, 999));

const movementCost = (row) =>
    n(row.totalCost) > 0 ? n(row.totalCost) : n(row.quantity) * n(row.unitCost);

const onlineOrderRevenue = (row) =>
    n(row.orderTotal?.total) > 0 ? n(row.orderTotal.total) : n(row.totalPrice);

const onlineItemCost = (item) => n(item.quantity) * n(item.unitCost);

const onlineOrderCost = (row) =>
    (row.items || []).reduce((sum, item) => sum + onlineItemCost(item), 0);

const journalTotals = async (journals) => {
    const accountIds = [
        ...new Set(
            journals.flatMap((row) => (row.lines || []).map((line) => id(line.accountId)))
        ),
    ].filter(Boolean);
    const accounts = await Account.find({
        _id: { $in: accountIds.map(oid) },
        isDeleted: { $ne: true },
        reportGroup: "Profit & Loss",
        accountType: { $in: ["Income", "Expense"] },
    })
        .select("accountName accountCode accountType accountCategory")
        .lean();
    const accountMap = new Map(accounts.map((row) => [id(row._id), row]));
    let otherIncome = 0;
    let otherExpense = 0;
    const incomeLines = new Map();
    const expenseLines = new Map();
    for (const journal of journals) {
        for (const line of journal.lines || []) {
            const account = accountMap.get(id(line.accountId));
            if (!account) continue;
            if (account.accountType === "Income") {
                const amount = Math.max(n(line.credit) - n(line.debit), 0);
                otherIncome += amount;
                incomeLines.set(
                    account.accountName,
                    n(incomeLines.get(account.accountName)) + amount
                );
            } else {
                const amount = Math.max(n(line.debit) - n(line.credit), 0);
                otherExpense += amount;
                expenseLines.set(
                    account.accountName,
                    n(expenseLines.get(account.accountName)) + amount
                );
            }
        }
    }
    return { otherIncome, otherExpense, incomeLines, expenseLines };
};

const loadPeriod = async ({
    tenantId,
    creatorIds,
    tenantOrderIds,
    tenantBranchIds,
    includeUnassignedOnline,
    query,
    managedBranchIds,
    from,
    to,
}) => {
    const salesMatch = {
        companyId: tenantId,
        isDeleted: { $ne: true },
        status: "Completed",
        orderDate: { $gte: from, $lte: to },
    };
    applyBranchScope(salesMatch, query.branchId, managedBranchIds);

    let onlineBranchIds = (tenantBranchIds || []).map(String);
    if (managedBranchIds !== null) {
        const managed = new Set((managedBranchIds || []).map(String));
        onlineBranchIds = onlineBranchIds.filter((branchId) =>
            managed.has(branchId)
        );
    }
    if (query.branchId) {
        onlineBranchIds = onlineBranchIds.includes(String(query.branchId))
            ? [String(query.branchId)]
            : [];
    }
    const onlineMatch = {
        orderStatus: "delivered",
        orderDate: { $gte: from, $lte: to },
        branchId: { $in: onlineBranchIds.map(oid).filter(Boolean) },
    };
    if (
        includeUnassignedOnline &&
        managedBranchIds === null &&
        !query.branchId
    ) {
        onlineMatch.$or = [
            { branchId: onlineMatch.branchId },
            { branchId: null },
            { branchId: { $exists: false } },
        ];
        delete onlineMatch.branchId;
    }

    const returnMatch = {
        isDeleted: { $ne: true },
        status: { $in: ["Received", "Refunded"] },
        returnDate: { $gte: from, $lte: to },
        salesOrderId: { $in: tenantOrderIds },
    };
    applyBranchScope(returnMatch, query.branchId, managedBranchIds);

    const repairMatch = {
        isDeleted: { $ne: true },
        status: { $in: ["Completed", "Ready For Pickup", "Delivered"] },
        completedDate: { $gte: from, $lte: to },
        $or: [{ companyId: tenantId }, { createdBy: { $in: creatorIds } }],
    };
    applyBranchScope(repairMatch, query.branchId, managedBranchIds);

    const expenseMatch = {
        isDeleted: { $ne: true },
        expenseDate: { $gte: from, $lte: to },
        expenseCategory: { $nin: ["Purchase", "Salary"] },
        $or: [
            { companyId: tenantId },
            { createdBy: { $in: creatorIds } },
        ],
        $and: [
            {
                $or: [
                    { approvalStatus: "Approved" },
                    { "financeApproval.status": "Approved" },
                    { paymentStatus: "Paid" },
                ],
            },
        ],
    };
    applyBranchScope(expenseMatch, query.branchId, managedBranchIds);

    const payrollMatch = {
        companyId: tenantId,
        isDeleted: { $ne: true },
        status: { $in: ["approved", "locked", "paid"] },
    };
    applyBranchScope(payrollMatch, query.branchId, managedBranchIds);

    const journalMatch = {
        isDeleted: { $ne: true },
        journalDate: { $gte: from, $lte: to },
        postingStatus: "Posted",
        isBalanced: true,
        journalType: "Adjustment",
        createdBy: { $in: creatorIds },
        $or: [{ isManualEntry: true }, { sourceModule: "Manual" }],
    };
    applyBranchScope(journalMatch, query.branchId, managedBranchIds);

    const [
        sales,
        onlineOrders,
        returns,
        repairs,
        expenses,
        payrollCandidates,
        journals,
    ] =
        await Promise.all([
            SalesOrder.find(salesMatch)
                .select(
                    "branchId orderNumber orderDate customerName salesType grandTotal paidAmount dueAmount stockUpdated items"
                )
                .lean(),
            OnlineOrder.find(onlineMatch)
                .select(
                    "branchId orderDate orderStatus orderTotal totalPrice paymentMethod items"
                )
                .lean(),
            SalesReturn.find(returnMatch)
                .select("branchId salesOrderId returnDate refundAmount items")
                .lean(),
            query.includeRepairs === false
                ? []
                : RepairTicket.find(repairMatch)
                      .select(
                          "branchId ticketNumber completedDate totalAmount paidAmount dueAmount"
                      )
                      .lean(),
            query.includeExpenses === false
                ? []
                : Expense.find(expenseMatch)
                      .select(
                          "branchId expenseNumber expenseDate expenseCategory expenseTitle totalAmount paymentStatus"
                      )
                      .lean(),
            query.includePayroll === false
                ? []
                : PayrollRun.find(payrollMatch)
                      .select(
                          "branchId runNumber payrollMonth payrollYear totalGrossMinor totalGross status approvedAt lockedAt paidAt"
                      )
                      .lean(),
            Journal.find(journalMatch)
                .select("branchId journalNumber journalDate lines")
                .lean(),
        ]);

    const onlineProductIds = [
        ...new Set(
            onlineOrders.flatMap((order) =>
                (order.items || []).map((item) => id(item.productID))
            )
        ),
    ].filter(Boolean);
    const onlineProducts = onlineProductIds.length
        ? await Product.find({ _id: { $in: onlineProductIds.map(oid) } })
              .select("name sku purchasePrice costPrice")
              .lean()
        : [];
    const onlineProductMap = new Map(
        onlineProducts.map((product) => [id(product._id), product])
    );
    for (const order of onlineOrders) {
        for (const item of order.items || []) {
            const product = onlineProductMap.get(id(item.productID));
            item.unitCost =
                n(product?.costPrice) > 0
                    ? n(product.costPrice)
                    : n(product?.purchasePrice);
            item.sku = product?.sku || "";
        }
    }

    const payroll = payrollCandidates.filter((run) => {
        const date = payrollRecognitionDate(run);
        return date >= from && date <= to;
    });
    const salesIds = sales.map((row) => row._id);
    const movements = salesIds.length
        ? await StockMovement.find({
              salesOrderId: { $in: salesIds },
              movementType: "Sale",
              movementDirection: "OUT",
          })
              .select(
                  "branchId salesOrderId productId productVariantId productName sku movementDate quantity unitCost totalCost"
              )
              .lean()
        : [];
    const salesById = new Map(sales.map((row) => [id(row._id), row]));
    for (const movement of movements) {
        const order = salesById.get(id(movement.salesOrderId));
        movement.recognitionDate = order?.orderDate || movement.movementDate;
        movement.branchId = movement.branchId || order?.branchId || null;
    }
    const journal = await journalTotals(journals);
    return {
        sales,
        onlineOrders,
        returns,
        repairs,
        expenses,
        payroll,
        journals,
        movements,
        journal,
    };
};

const summarize = (data) => {
    const grossSales = data.sales.reduce((sum, row) => sum + n(row.grandTotal), 0);
    const salesReturns = data.returns.reduce(
        (sum, row) => sum + n(row.refundAmount),
        0
    );
    const salesOrderRevenue = grossSales - salesReturns;
    const onlineSalesRevenue = data.onlineOrders.reduce(
        (sum, row) => sum + onlineOrderRevenue(row),
        0
    );
    const netSales = salesOrderRevenue + onlineSalesRevenue;
    const repairRevenue = data.repairs.reduce(
        (sum, row) => sum + n(row.totalAmount),
        0
    );
    const otherIncome = data.journal.otherIncome;
    const operatingRevenue = netSales + repairRevenue;
    const totalRevenue = operatingRevenue + otherIncome;
    const salesOrderCogs = data.movements.reduce(
        (sum, row) => sum + movementCost(row),
        0
    );
    const onlineCogs = data.onlineOrders.reduce(
        (sum, row) => sum + onlineOrderCost(row),
        0
    );
    const cogs = salesOrderCogs + onlineCogs;
    const operatingExpenses = data.expenses.reduce(
        (sum, row) => sum + n(row.totalAmount),
        0
    );
    const payrollExpense = data.payroll.reduce(
        (sum, row) =>
            sum +
            (n(row.totalGrossMinor) > 0
                ? toMajor(row.totalGrossMinor)
                : n(row.totalGross)),
        0
    );
    const manualOtherExpense = data.journal.otherExpense;
    const totalOperatingExpenses =
        operatingExpenses + payrollExpense + manualOtherExpense;
    const grossProfit = operatingRevenue - cogs;
    const operatingProfit =
        grossProfit + otherIncome - totalOperatingExpenses;
    const netProfit = operatingProfit;
    const safeMargin = (value) =>
        totalRevenue === 0 ? 0 : (value / totalRevenue) * 100;
    return {
        orderCount: data.sales.length + data.onlineOrders.length,
        salesOrderCount: data.sales.length,
        onlineOrderCount: data.onlineOrders.length,
        grossSales,
        salesReturns,
        salesOrderRevenue,
        onlineSalesRevenue,
        netSales,
        repairRevenue,
        otherIncome,
        operatingRevenue,
        totalRevenue,
        salesOrderCogs,
        onlineCogs,
        cogs,
        grossProfit,
        operatingExpenses,
        payrollExpense,
        manualOtherExpense,
        totalOperatingExpenses,
        operatingProfit,
        netProfit,
        grossMargin:
            operatingRevenue === 0 ? 0 : (grossProfit / operatingRevenue) * 100,
        operatingMargin: safeMargin(operatingProfit),
        netMargin: safeMargin(netProfit),
        cashCollected:
            data.sales.reduce((sum, row) => sum + n(row.paidAmount), 0) +
            data.repairs.reduce((sum, row) => sum + n(row.paidAmount), 0) +
            onlineSalesRevenue,
        receivables:
            data.sales.reduce((sum, row) => sum + n(row.dueAmount), 0) +
            data.repairs.reduce((sum, row) => sum + n(row.dueAmount), 0),
    };
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

const buildTrend = (data, from, to, groupBy) => {
    const rows = new Map(
        periodKeys(from, to, groupBy).map((key) => [
            key,
            {
                period: key,
                date: key,
                label: key,
                revenue: 0,
                netSales: 0,
                onlineSalesRevenue: 0,
                repairRevenue: 0,
                cogs: 0,
                grossProfit: 0,
                expenses: 0,
                payroll: 0,
                otherIncome: 0,
                netProfit: 0,
            },
        ])
    );
    const add = (date, field, amount) => {
        const row = rows.get(periodKey(date, groupBy));
        if (row) row[field] += amount;
    };
    for (const row of data.sales) {
        add(row.orderDate, "netSales", n(row.grandTotal));
        add(row.orderDate, "revenue", n(row.grandTotal));
    }
    for (const row of data.onlineOrders) {
        const revenue = onlineOrderRevenue(row);
        add(row.orderDate, "onlineSalesRevenue", revenue);
        add(row.orderDate, "netSales", revenue);
        add(row.orderDate, "revenue", revenue);
        add(row.orderDate, "cogs", onlineOrderCost(row));
    }
    for (const row of data.returns) {
        add(row.returnDate, "netSales", -n(row.refundAmount));
        add(row.returnDate, "revenue", -n(row.refundAmount));
    }
    for (const row of data.repairs) {
        add(row.completedDate, "repairRevenue", n(row.totalAmount));
        add(row.completedDate, "revenue", n(row.totalAmount));
    }
    for (const row of data.movements) {
        add(row.recognitionDate || row.movementDate, "cogs", movementCost(row));
    }
    for (const row of data.expenses) {
        add(row.expenseDate, "expenses", n(row.totalAmount));
    }
    for (const row of data.payroll) {
        add(
            payrollRecognitionDate(row),
            "payroll",
            n(row.totalGrossMinor) > 0
                ? toMajor(row.totalGrossMinor)
                : n(row.totalGross)
        );
    }
    for (const journal of data.journals) {
        const bucket = rows.get(periodKey(journal.journalDate, groupBy));
        if (!bucket) continue;
        // Manual P&L adjustments are summarized for the period, then distributed
        // by journal below using account lines.
    }
    if (data.journals.length) {
        const incomeByDate = data.journal.otherIncome / data.journals.length;
        const expenseByDate = data.journal.otherExpense / data.journals.length;
        for (const journal of data.journals) {
            const bucket = rows.get(periodKey(journal.journalDate, groupBy));
            if (bucket) {
                bucket.otherIncome += incomeByDate;
                bucket.revenue += incomeByDate;
                bucket.expenses += expenseByDate;
            }
        }
    }
    for (const row of rows.values()) {
        row.grossProfit = row.revenue - row.otherIncome - row.cogs;
        row.netProfit =
            row.grossProfit +
            row.otherIncome -
            row.expenses -
            row.payroll;
    }
    return [...rows.values()];
};

const namedBreakdown = (entries, total) =>
    [...entries.entries()]
        .map(([key, amount]) => ({
            id: key,
            key,
            label: key,
            amount,
            percentage: total ? (amount / total) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);

const getExpenseBreakdown = (data, summary) => {
    const map = new Map();
    for (const row of data.expenses) {
        const key = row.expenseCategory || "Other";
        map.set(key, n(map.get(key)) + n(row.totalAmount));
    }
    if (summary.payrollExpense) map.set("Payroll", summary.payrollExpense);
    for (const [key, value] of data.journal.expenseLines.entries()) {
        map.set(key, n(map.get(key)) + value);
    }
    return namedBreakdown(map, summary.totalOperatingExpenses);
};

const branchBreakdown = async (data) => {
    const groups = new Map();
    const get = (branchId) => {
        const key = id(branchId) || "unallocated";
        if (!groups.has(key)) {
            groups.set(key, {
                id: key,
                branchId: key === "unallocated" ? null : key,
                label: "Unallocated",
                code: "",
                revenue: 0,
                cogs: 0,
                expenses: 0,
                netProfit: 0,
                margin: 0,
            });
        }
        return groups.get(key);
    };
    for (const row of data.sales) get(row.branchId).revenue += n(row.grandTotal);
    for (const row of data.onlineOrders) {
        get(row.branchId).revenue += onlineOrderRevenue(row);
        get(row.branchId).cogs += onlineOrderCost(row);
    }
    for (const row of data.returns)
        get(row.branchId).revenue -= n(row.refundAmount);
    for (const row of data.repairs)
        get(row.branchId).revenue += n(row.totalAmount);
    for (const row of data.movements)
        get(row.branchId).cogs += movementCost(row);
    for (const row of data.expenses)
        get(row.branchId).expenses += n(row.totalAmount);
    for (const row of data.payroll) {
        get(row.branchId).expenses +=
            n(row.totalGrossMinor) > 0
                ? toMajor(row.totalGrossMinor)
                : n(row.totalGross);
    }
    const ids = [...groups.keys()].filter((key) => key !== "unallocated");
    const branches = await Branch.find({
        _id: { $in: ids.map(oid) },
        isDeleted: { $ne: true },
    })
        .select("name branchCode")
        .lean();
    const docs = new Map(branches.map((row) => [id(row._id), row]));
    return [...groups.values()]
        .map((row) => {
            const doc = docs.get(row.id);
            row.label = doc?.name || row.label;
            row.code = doc?.branchCode || "";
            row.netProfit = row.revenue - row.cogs - row.expenses;
            row.margin = row.revenue ? (row.netProfit / row.revenue) * 100 : 0;
            return row;
        })
        .sort((a, b) => b.netProfit - a.netProfit);
};

const topProducts = (data) => {
    const groups = new Map();
    const get = (productId, variantId, name, sku) => {
        const key = `${id(productId)}:${id(variantId)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                id: key,
                productId: id(productId) || null,
                productVariantId: id(variantId) || null,
                name: name || "Unknown product",
                productName: name || "Unknown product",
                sku: sku || "",
                units: 0,
                revenue: 0,
                returns: 0,
                netRevenue: 0,
                cogs: 0,
                grossProfit: 0,
                margin: 0,
            });
        }
        return groups.get(key);
    };
    for (const order of data.sales) {
        for (const item of order.items || []) {
            const row = get(
                item.productId,
                item.productVariantId,
                item.productName,
                item.sku
            );
            row.units += n(item.quantity);
            row.revenue += n(item.total);
        }
    }
    for (const order of data.onlineOrders) {
        for (const item of order.items || []) {
            const row = get(
                item.productID,
                null,
                item.productName,
                item.sku
            );
            row.units += n(item.quantity);
            row.revenue += n(item.quantity) * n(item.price);
            row.cogs += onlineItemCost(item);
        }
    }
    for (const returned of data.returns) {
        for (const item of returned.items || []) {
            const row = get(
                item.productId,
                item.productVariantId,
                item.productName,
                item.sku
            );
            row.units -= n(item.returnQuantity);
            row.returns += n(item.total);
        }
    }
    for (const movement of data.movements) {
        const row = get(
            movement.productId,
            movement.productVariantId,
            movement.productName,
            movement.sku
        );
        row.cogs += movementCost(movement);
    }
    return [...groups.values()]
        .map((row) => {
            row.netRevenue = row.revenue - row.returns;
            row.grossProfit = row.netRevenue - row.cogs;
            row.margin = row.netRevenue
                ? (row.grossProfit / row.netRevenue) * 100
                : 0;
            return row;
        })
        .sort((a, b) => b.grossProfit - a.grossProfit)
        .slice(0, 15);
};

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const tenantId = oid(companyId);
    if (!tenantId) throw new AppError("Company context is required.", 403);
    const period = resolvePeriod(query);
    const groupBy = query.groupBy || "day";
    const includeFlags = {
        includeRepairs: query.includeRepairs !== false,
        includePayroll: query.includePayroll !== false,
        includeExpenses: query.includeExpenses !== false,
    };
    const [
        company,
        creatorIds,
        tenantOrderIds,
        salesOrderBranchIds,
        activeCompanyCount,
    ] = await Promise.all([
        companySnapshot(tenantId),
        AdminUser.distinct("_id", { companyId: tenantId }),
        SalesOrder.distinct("_id", {
            companyId: tenantId,
            isDeleted: { $ne: true },
        }),
        SalesOrder.distinct("branchId", {
            companyId: tenantId,
            isDeleted: { $ne: true },
            branchId: { $ne: null },
        }),
        Company.countDocuments({
            isDeleted: { $ne: true },
            status: { $ne: "Closed" },
        }),
    ]);
    const ownedBranchIds = await Branch.distinct("_id", {
        isDeleted: { $ne: true },
        $or: [
            { createdBy: { $in: creatorIds } },
            { managerId: { $in: creatorIds } },
        ],
    });
    const tenantBranchIds = [
        ...new Map(
            [...salesOrderBranchIds, ...ownedBranchIds]
                .filter(Boolean)
                .map((branchId) => [String(branchId), branchId])
        ).values(),
    ];
    const common = {
        tenantId,
        creatorIds,
        tenantOrderIds,
        tenantBranchIds,
        includeUnassignedOnline: activeCompanyCount === 1,
        query: { ...query, ...includeFlags },
        managedBranchIds,
    };
    const [current, previous] = await Promise.all([
        loadPeriod({ ...common, from: period.from, to: period.to }),
        loadPeriod({
            ...common,
            from: period.previousFrom,
            to: period.previousTo,
        }),
    ]);
    const summary = summarize(current);
    const previousSummary = summarize(previous);
    const eligibleOrderIds = new Set(
        current.sales.filter((row) => row.stockUpdated).map((row) => id(row._id))
    );
    const coveredOrders = new Set(
        current.movements
            .map((row) => id(row.salesOrderId))
            .filter((orderId) => eligibleOrderIds.has(orderId))
    );
    const eligibleOrders = eligibleOrderIds.size;
    const cogsCoveragePercent = eligibleOrders
        ? (coveredOrders.size / eligibleOrders) * 100
        : current.sales.length === 0
          ? 100
          : 0;
    const warnings = [];
    if (cogsCoveragePercent < 100) {
        warnings.push(
            "COGS and profit are provisional because linked Sale/OUT cost movements do not cover every stock-updated completed sales order."
        );
    }
    const onlineLines = current.onlineOrders.flatMap((order) => order.items || []);
    const onlineCostedLines = onlineLines.filter((item) => n(item.unitCost) > 0);
    const onlineCogsCoveragePercent = onlineLines.length
        ? (onlineCostedLines.length / onlineLines.length) * 100
        : 100;
    if (onlineCogsCoveragePercent < 100) {
        warnings.push(
            "Online COGS is provisional because some delivered online-order products have no costPrice or purchasePrice."
        );
    }
    warnings.push(
        activeCompanyCount === 1
            ? "Unassigned legacy online orders are included because this installation has one active company; assign branches before enabling another company."
            : "Online orders are included only when their branch is linked to this company; unassigned legacy online orders are excluded to prevent cross-company totals."
    );
    if (includeFlags.includeExpenses) {
        warnings.push(
            "Legacy expenses lack companyId; only approved/paid expenses created by users in this company are included."
        );
    }
    warnings.push(
        "This is an operational accrual report, not an audited general-ledger income statement."
    );
    const expenseBreakdown = getExpenseBreakdown(current, summary);
    const incomeMap = new Map([
        ["Sales order revenue", summary.salesOrderRevenue],
        ["Online sales revenue", summary.onlineSalesRevenue],
        ...(summary.repairRevenue
            ? [["Repair services", summary.repairRevenue]]
            : []),
        ...current.journal.incomeLines.entries(),
    ]);
    const allowedBranchIds =
        managedBranchIds === null
            ? tenantBranchIds
            : tenantBranchIds.filter((branchId) =>
                  managedBranchIds.map(String).includes(String(branchId))
              );
    const branchOptions = await Branch.find({
        _id: { $in: allowedBranchIds },
        isDeleted: { $ne: true },
    })
        .select("name branchCode")
        .lean();
    const statement = [
        {
            section: "Revenue",
            lines: [
                { key: "grossSales", label: "Gross sales orders", amount: summary.grossSales },
                { key: "salesReturns", label: "Less: sales returns", amount: -summary.salesReturns },
                { key: "salesOrderRevenue", label: "Net sales order revenue", amount: summary.salesOrderRevenue },
                { key: "onlineSalesRevenue", label: "Delivered online sales", amount: summary.onlineSalesRevenue },
                { key: "netSales", label: "Combined product sales", amount: summary.netSales },
                { key: "repairRevenue", label: "Repair service revenue", amount: summary.repairRevenue },
            ],
            totalLabel: "Operating revenue",
            total: summary.operatingRevenue,
        },
        {
            section: "Cost of sales",
            lines: [
                {
                    key: "salesOrderCogs",
                    label: "Sales order COGS",
                    amount: summary.salesOrderCogs,
                },
                {
                    key: "onlineCogs",
                    label: "Estimated online sales COGS",
                    amount: summary.onlineCogs,
                },
                { key: "cogs", label: "Total cost of goods sold", amount: summary.cogs },
            ],
            totalLabel: "Gross profit",
            total: summary.grossProfit,
        },
        {
            section: "Other income",
            lines: [
                {
                    key: "otherIncome",
                    label: "Other posted income",
                    amount: summary.otherIncome,
                },
            ],
            totalLabel: "Gross profit plus other income",
            total: summary.grossProfit + summary.otherIncome,
        },
        {
            section: "Operating expenses",
            lines: expenseBreakdown.map((row) => ({
                key: row.key,
                label: row.label,
                amount: row.amount,
            })),
            totalLabel: "Total operating expenses",
            total: summary.totalOperatingExpenses,
        },
        {
            section: "Net result",
            lines: [],
            totalLabel: "Net profit / (loss)",
            total: summary.netProfit,
        },
    ];

    return {
        meta: {
            reportType: "profit_loss_dashboard",
            generatedAt: new Date().toISOString(),
            company,
            currency: company.currency || "USD",
            timezone: "UTC",
            companyTimezone: company.timezone || null,
            basis: "operational_accrual",
            recognitionPolicy: {
                sales: "Completed sales orders by orderDate",
                onlineSales:
                    "Delivered ecommerce orders by orderDate, scoped through company-linked branches",
                returns: "Received/Refunded sales returns by returnDate",
                repairs: "Completed/Ready/Delivered tickets by completedDate",
                payroll: "Approved/Locked/Paid gross payroll by recognition date",
                expenses: "Approved or paid expenses by expenseDate",
                adjustments: "Posted balanced manual adjustment journals only",
            },
            filters: {
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                branchId: query.branchId || null,
                groupBy,
                ...includeFlags,
            },
            reliability: {
                provisional: warnings.length > 1 || cogsCoveragePercent < 100,
                cogsCoveragePercent,
                onlineCogsCoveragePercent,
                coveredSalesOrders: coveredOrders.size,
                eligibleSalesOrders: eligibleOrders,
                costedOnlineLines: onlineCostedLines.length,
                eligibleOnlineLines: onlineLines.length,
                expenseScope: "company_creator",
                warnings,
            },
        },
        summary,
        comparison: {
            period: {
                from: period.previousFrom.toISOString(),
                to: period.previousTo.toISOString(),
            },
            totalRevenue: comparison(
                summary.totalRevenue,
                previousSummary.totalRevenue
            ),
            grossProfit: comparison(
                summary.grossProfit,
                previousSummary.grossProfit
            ),
            totalOperatingExpenses: comparison(
                summary.totalOperatingExpenses,
                previousSummary.totalOperatingExpenses
            ),
            netProfit: comparison(summary.netProfit, previousSummary.netProfit),
            netMargin: comparison(summary.netMargin, previousSummary.netMargin),
        },
        statement,
        trend: buildTrend(current, period.from, period.to, groupBy),
        incomeBreakdown: namedBreakdown(incomeMap, summary.totalRevenue),
        expenseBreakdown,
        branchBreakdown: await branchBreakdown(current),
        topProducts: topProducts(current),
        periodRows: buildTrend(current, period.from, period.to, groupBy),
        options: {
            branches: branchOptions.map((row) => ({
                id: id(row._id),
                label: row.name,
                code: row.branchCode || "",
            })),
        },
    };
};

module.exports = { getDashboard };
