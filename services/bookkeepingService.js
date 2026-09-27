const mongoose = require("mongoose");
const Account = require("../model/account");
const Journal = require("../model/journal");
const BookkeepingEntry = require("../model/bookkeepingEntry");
const AppError = require("../utils/appError");
const { companyFilter } = require("../utils/tenantScope");
const { DEFAULT_CURRENCY } = require("../config/finance");
const { presentRows } = require("./bookkeepingRowView");

const NOT_DELETED = { isDeleted: { $ne: true } };

const parseRange = (query = {}) => {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
        ? new Date(query.from)
        : new Date(to.getTime() - 29 * 86_400_000);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
};

/**
 * Bookkeeping dashboard — chart of accounts + recent journals (read-only).
 * UI twin of Insights report screens.
 */
const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const tenant = companyFilter(companyId);
    const { from, to } = parseRange(query);
    const accountType = String(query.accountType || "").trim();
    const search = String(query.search || "").trim();

    const accountMatch = {
        ...tenant,
        ...NOT_DELETED,
        status: { $ne: "Inactive" },
    };
    if (accountType) accountMatch.accountType = accountType;
    if (search) {
        accountMatch.$or = [
            { accountCode: { $regex: search, $options: "i" } },
            { accountName: { $regex: search, $options: "i" } },
        ];
    }

    const journalMatch = {
        ...tenant,
        ...NOT_DELETED,
        journalDate: { $gte: from, $lte: to },
    };
    if (query.branchId) {
        journalMatch.branchId = query.branchId;
    } else if (Array.isArray(managedBranchIds) && managedBranchIds.length) {
        journalMatch.branchId = { $in: managedBranchIds };
    }

    const [accounts, journals, typeAgg, journalStats] = await Promise.all([
        Account.find(accountMatch)
            .select(
                "accountCode accountName accountType accountCategory currentBalance balanceType normalBalance currency status"
            )
            .sort({ accountType: 1, accountCode: 1 })
            .limit(500)
            .lean(),
        Journal.find(journalMatch)
            .select(
                "journalNumber journalDate journalType postingStatus totalDebit totalCredit referenceType referenceId description branchId lines"
            )
            .populate("lines.accountId", "accountCode accountName accountType")
            .sort({ journalDate: -1, createdAt: -1 })
            .limit(100)
            .lean(),
        Account.aggregate([
            { $match: { ...tenant, ...NOT_DELETED } },
            {
                $group: {
                    _id: "$accountType",
                    count: { $sum: 1 },
                    balance: { $sum: { $ifNull: ["$currentBalance", 0] } },
                },
            },
        ]),
        Journal.aggregate([
            { $match: journalMatch },
            {
                $group: {
                    _id: "$postingStatus",
                    count: { $sum: 1 },
                    debit: { $sum: { $ifNull: ["$totalDebit", 0] } },
                    credit: { $sum: { $ifNull: ["$totalCredit", 0] } },
                },
            },
        ]),
    ]);

    const byType = {};
    for (const row of typeAgg) {
        byType[row._id || "Other"] = {
            count: row.count,
            balance: row.balance,
        };
    }

    let postedCount = 0;
    let draftCount = 0;
    let periodDebit = 0;
    let periodCredit = 0;
    for (const row of journalStats) {
        const status = String(row._id || "");
        if (status === "Posted") postedCount += row.count;
        if (status === "Draft" || status === "Pending Approval") {
            draftCount += row.count;
        }
        periodDebit += Number(row.debit) || 0;
        periodCredit += Number(row.credit) || 0;
    }

    const currency =
        accounts.find((a) => a.currency)?.currency || DEFAULT_CURRENCY;

    // Flatten journal lines → entry/exit movements (Debit = IN, Credit = OUT)
    const movements = [];
    for (const journal of journals) {
        const lines = Array.isArray(journal.lines) ? journal.lines : [];
        for (const line of lines) {
            const acc =
                line.accountId && typeof line.accountId === "object"
                    ? line.accountId
                    : null;
            const debit = Math.max(Number(line.debit) || 0, 0);
            const credit = Math.max(Number(line.credit) || 0, 0);
            const base = {
                journalId: journal._id,
                journalNumber: journal.journalNumber || "",
                journalDate: journal.journalDate || null,
                journalType: journal.journalType || "",
                postingStatus: journal.postingStatus || "",
                referenceType: journal.referenceType || "",
                description:
                    (line.description || journal.description || "").trim(),
                accountId: acc?._id || line.accountId || null,
                accountCode: acc?.accountCode || "",
                accountName: acc?.accountName || "",
                accountType: acc?.accountType || "",
            };
            if (debit > 0) {
                movements.push({
                    ...base,
                    direction: "IN",
                    side: "Debit",
                    amount: debit,
                });
            }
            if (credit > 0) {
                movements.push({
                    ...base,
                    direction: "OUT",
                    side: "Credit",
                    amount: credit,
                });
            }
            if (movements.length >= 300) break;
        }
        if (movements.length >= 300) break;
    }

    return {
        meta: {
            currency,
            from: from.toISOString(),
            to: to.toISOString(),
            generatedAt: new Date().toISOString(),
            accountCount: accounts.length,
            journalCount: journals.length,
            movementCount: movements.length,
        },
        kpis: {
            accounts: accounts.length,
            assets: byType.Asset?.count || 0,
            liabilities: byType.Liability?.count || 0,
            equity: byType.Equity?.count || 0,
            income: byType.Income?.count || 0,
            expense: byType.Expense?.count || 0,
            journalsInPeriod: journals.length,
            postedJournals: postedCount,
            openJournals: draftCount,
            periodDebit,
            periodCredit,
        },
        accountsByType: byType,
        accounts,
        journals: journals.map((j) => {
            const { lines, ...rest } = j;
            return rest;
        }),
        movements,
    };
};

// ════════════════════════════════════════════════════════════════════════
// Business ledger (BookkeepingEntry) — list / detail / summary / reports / export
// ════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;
const LEDGER_PAGE_SIZES = [20, 50, 100, 200];
const LEDGER_SORTS = {
    date: "transactionDate",
    amount: "amount",
    entryNumber: "entryNumber",
    type: "transactionType",
    created: "createdAt",
};
const REFUND_TYPES = ["customer_refund", "online_refund"];
const CUSTOMER_PAYMENT_TYPES = ["customer_payment", "repair_payment", "online_payment"];
const SUPPLIER_PAYMENT_TYPES = ["supplier_payment", "supplier_advance"];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toOid = (v) =>
    v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;
const csvList = (v) =>
    String(v || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

const ledgerRange = (query = {}) => {
    const now = new Date();
    const startOfDay = (d) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    };
    const endOfDay = (d) => {
        const x = new Date(d);
        x.setHours(23, 59, 59, 999);
        return x;
    };
    switch (String(query.preset || "")) {
        case "today":
            return { from: startOfDay(now), to: endOfDay(now) };
        case "yesterday": {
            const y = new Date(now.getTime() - DAY_MS);
            return { from: startOfDay(y), to: endOfDay(y) };
        }
        case "this_week": {
            const from = startOfDay(now);
            from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
            return { from, to: endOfDay(now) };
        }
        case "this_month":
            return {
                from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
                to: endOfDay(now),
            };
        default:
            return parseRange(query);
    }
};

/** Tenant + branch scope + UI filters. companyId always from the session. */
const buildLedgerMatch = (companyId, query = {}, managedBranchIds = null) => {
    const { from, to } = ledgerRange(query);
    // Aggregations do not auto-cast — always match ObjectIds.
    const match = {
        companyId: toOid(companyFilter(companyId).companyId),
        transactionDate: { $gte: from, $lte: to },
    };

    const requestedBranch = toOid(query.branchId);
    if (Array.isArray(managedBranchIds)) {
        const allowed = managedBranchIds.map(String);
        if (requestedBranch && !allowed.includes(String(requestedBranch))) {
            match.branchId = { $in: [] };
        } else {
            match.branchId = requestedBranch || {
                $in: managedBranchIds.map(toOid).filter(Boolean),
            };
        }
    } else if (requestedBranch) {
        match.branchId = requestedBranch;
    }

    const types = csvList(query.transactionType);
    if (types.length) match.transactionType = { $in: types };
    const modules = csvList(query.sourceModule);
    if (modules.length) match.sourceModule = { $in: modules };
    const methods = csvList(query.paymentMethod);
    if (methods.length) match.paymentMethod = { $in: methods };
    const statuses = csvList(query.status);
    if (statuses.length) match.status = { $in: statuses };
    if (query.account) match.account = String(query.account);
    if (query.direction === "in" || query.direction === "out") {
        match.direction = query.direction;
    }

    const warehouse = toOid(query.warehouseId);
    if (warehouse) match.warehouseId = warehouse;
    const party =
        toOid(query.partyId) ||
        toOid(query.customerId) ||
        toOid(query.supplierId) ||
        toOid(query.employeeId);
    if (party) match.partyId = party;
    if (query.customerId) match.partyType = "Customer";
    if (query.supplierId) match.partyType = "Supplier";
    if (query.employeeId) match.partyType = "Employee";
    const creator = toOid(query.createdBy);
    if (creator) match.createdBy = creator;

    const search = String(query.search || "").trim();
    if (search) {
        const upper = search.toUpperCase();
        match.$or = [
            { entryNumber: upper },
            { sourceNumber: upper },
            { imeis: upper },
            { paymentReference: search },
            { searchText: { $regex: escapeRegex(search.toLowerCase()) } },
        ];
    }
    return { match, from, to };
};

const LEDGER_LIST_FIELDS =
    "entryNumber transactionDate transactionType sourceModule sourceType sourceId sourceNumber description partyType partyId partyName branchId toBranchId warehouseId toWarehouseId productName sku imeis quantity amount account direction cashIn cashOut currency paymentMethod paymentProvider paymentReference status isReversal createdByName createdAt relatedDocuments metadata.movementType";

const listEntries = async (companyId, query = {}, managedBranchIds = null) => {
    const { match, from, to } = buildLedgerMatch(companyId, query, managedBranchIds);
    const limit = LEDGER_PAGE_SIZES.includes(Number(query.limit)) ? Number(query.limit) : 50;
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const sortField = LEDGER_SORTS[query.sortBy] || "transactionDate";
    const dir = query.sortOrder === "asc" ? 1 : -1;

    const [rows, total] = await Promise.all([
        BookkeepingEntry.find(match)
            .select(LEDGER_LIST_FIELDS)
            .populate("branchId", "name")
            .populate("toBranchId", "name")
            .populate("warehouseId", "warehouseName")
            .sort({ [sortField]: dir, _id: dir })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        BookkeepingEntry.countDocuments(match),
    ]);
    await presentRows(companyId, rows);

    return {
        entries: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
        },
        meta: { from: from.toISOString(), to: to.toISOString(), currency: DEFAULT_CURRENCY },
    };
};

const SOURCE_MILESTONES = {
    SalesOrder: {
        model: "../model/salesOrder",
        fields: "orderNumber createdAt approvedAt stockUpdatedAt cancelledAt deliveryDate",
        steps: [
            ["createdAt", "Sales order created"],
            ["approvedAt", "Sales order approved"],
            ["stockUpdatedAt", "Stock deducted"],
            ["deliveryDate", "Delivered"],
            ["cancelledAt", "Cancelled"],
        ],
    },
    RepairTicket: {
        model: "../model/repairTicket",
        fields: "ticketNumber createdAt completedDate pickupDate",
        steps: [
            ["createdAt", "Repair ticket created"],
            ["completedDate", "Repair completed"],
            ["pickupDate", "Picked up by customer"],
        ],
    },
    CompanyOrder: {
        model: "../model/marketplace/companyOrder",
        fields: "orderNumber createdAt confirmedAt shippedAt deliveredAt cancelledAt",
        steps: [
            ["createdAt", "Online order placed"],
            ["confirmedAt", "Online order confirmed"],
            ["shippedAt", "Shipped"],
            ["deliveredAt", "Delivered"],
            ["cancelledAt", "Cancelled"],
        ],
    },
    Payment: {
        model: "../model/payment",
        fields: "paymentNumber createdAt approvedAt postedAt reversedAt",
        steps: [
            ["createdAt", "Payment created"],
            ["approvedAt", "Payment approved"],
            ["postedAt", "Payment posted"],
            ["reversedAt", "Payment reversed"],
        ],
    },
};

const getEntry = async (companyId, id, managedBranchIds = null) => {
    const oid = toOid(id);
    if (!oid) throw new AppError("Invalid bookkeeping entry id.", 400);
    const entry = await BookkeepingEntry.findOne({ _id: oid, ...companyFilter(companyId) })
        .populate("branchId", "name")
        .populate("toBranchId", "name")
        .populate("warehouseId", "warehouseName")
        .populate("toWarehouseId", "warehouseName")
        .lean();
    if (!entry) throw new AppError("Bookkeeping entry not found.", 404);
    if (
        Array.isArray(managedBranchIds) &&
        !managedBranchIds.map(String).includes(String(entry.branchId?._id || entry.branchId))
    ) {
        throw new AppError("You cannot view entries outside your branches.", 403);
    }
    await presentRows(companyId, [entry]);

    const relatedIds = [
        entry.sourceId,
        ...(entry.relatedDocuments || []).map((d) => d.id),
    ].filter(Boolean);

    const related = await BookkeepingEntry.find({
        ...companyFilter(companyId),
        _id: { $ne: entry._id },
        $or: [
            { sourceId: { $in: relatedIds } },
            { "relatedDocuments.id": { $in: relatedIds } },
        ],
    })
        .select("entryNumber transactionDate transactionType sourceModule sourceNumber description amount account direction status")
        .sort({ transactionDate: 1 })
        .limit(50)
        .lean();

    const timeline = [];
    const milestone = SOURCE_MILESTONES[entry.sourceType];
    if (milestone) {
        const doc = await require(milestone.model)
            .findOne({ _id: entry.sourceId, ...companyFilter(companyId) })
            .select(milestone.fields)
            .lean();
        for (const [field, label] of milestone.steps) {
            if (doc?.[field]) timeline.push({ at: doc[field], label, kind: "document" });
        }
    }
    for (const row of [entry, ...related]) {
        timeline.push({
            at: row.transactionDate,
            label: row.description || row.transactionType,
            kind: "ledger",
            entryId: row._id,
            entryNumber: row.entryNumber,
            amount: row.amount,
            direction: row.direction,
            status: row.status,
        });
    }
    timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

    return { entry, related, timeline };
};

const sumEffect = (account) => ({
    $sum: {
        $reduce: {
            input: {
                $filter: {
                    input: "$effects",
                    as: "e",
                    cond: { $eq: ["$$e.account", account] },
                },
            },
            initialValue: 0,
            in: { $add: ["$$value", "$$this.amount"] },
        },
    },
});

const sumIfType = (types, field = "$amount") => ({
    $sum: { $cond: [{ $in: ["$transactionType", types] }, field, 0] },
});

/** Reservation rows posted before they got their own type (on-hand stock unchanged). */
const NOT_LEGACY_RESERVATION = {
    $not: [
        {
            $and: [
                { $eq: ["$sourceType", "StockMovement"] },
                { $regexMatch: { input: { $ifNull: ["$description", ""] }, regex: "Marketplace reservation" } },
            ],
        },
    ],
};

const periodGroupFields = {
    count: { $sum: 1 },
    revenue: sumEffect("REVENUE"),
    purchases: sumEffect("PURCHASES"),
    expenses: sumEffect("EXPENSE"),
    cashIn: { $sum: "$cashIn" },
    cashOut: { $sum: "$cashOut" },
    customerPayments: sumIfType(CUSTOMER_PAYMENT_TYPES, "$cashIn"),
    supplierPayments: sumIfType(SUPPLIER_PAYMENT_TYPES, "$cashOut"),
    refunds: sumIfType(REFUND_TYPES, "$cashOut"),
    stockInQty: {
        $sum: {
            $cond: [
                {
                    $and: [
                        { $eq: ["$account", "INVENTORY"] },
                        { $eq: ["$direction", "in"] },
                        NOT_LEGACY_RESERVATION,
                    ],
                },
                "$quantity",
                0,
            ],
        },
    },
    stockOutQty: {
        $sum: {
            $cond: [
                {
                    $and: [
                        { $eq: ["$account", "INVENTORY"] },
                        { $eq: ["$direction", "out"] },
                        NOT_LEGACY_RESERVATION,
                    ],
                },
                "$quantity",
                0,
            ],
        },
    },
};

/** Totals never include voided rows, even when the list filter shows them. */
const withoutVoided = (match) => ({
    ...match,
    status: match.status
        ? { $in: match.status.$in.filter((s) => s !== "voided") }
        : { $ne: "voided" },
});

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundRow = (row = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === "number" ? r2(v) : v;
    return out;
};

const getLedgerSummary = async (companyId, query = {}, managedBranchIds = null) => {
    const { match, from, to } = buildLedgerMatch(companyId, query, managedBranchIds);
    const periodMatch = withoutVoided(match);

    // Closing balances: everything up to `to` within tenant + branch scope only.
    const closingMatch = {
        companyId: match.companyId,
        transactionDate: { $lte: to },
        status: { $ne: "voided" },
    };
    if (match.branchId) closingMatch.branchId = match.branchId;

    const [period, closing] = await Promise.all([
        BookkeepingEntry.aggregate([
            { $match: periodMatch },
            { $group: { _id: null, ...periodGroupFields } },
        ]),
        BookkeepingEntry.aggregate([
            { $match: closingMatch },
            { $unwind: "$effects" },
            { $group: { _id: "$effects.account", balance: { $sum: "$effects.amount" } } },
        ]),
    ]);

    const p = roundRow(period[0] || {});
    delete p._id;
    const balances = {};
    for (const row of closing) balances[row._id] = r2(row.balance);

    return {
        meta: { from: from.toISOString(), to: to.toISOString(), currency: DEFAULT_CURRENCY },
        period: {
            entries: p.count || 0,
            totalSales: p.revenue || 0,
            totalPurchases: p.purchases || 0,
            totalExpenses: p.expenses || 0,
            customerPayments: p.customerPayments || 0,
            supplierPayments: p.supplierPayments || 0,
            refunds: p.refunds || 0,
            moneyIn: p.cashIn || 0,
            moneyOut: p.cashOut || 0,
            netCashMovement: r2((p.cashIn || 0) - (p.cashOut || 0)),
            stockInQty: p.stockInQty || 0,
            stockOutQty: p.stockOutQty || 0,
        },
        closingBalances: {
            cash: balances.CASH || 0,
            bank: balances.BANK || 0,
            receivable: balances.RECEIVABLE || 0,
            payable: balances.PAYABLE || 0,
        },
    };
};

const REPORT_GROUPS = {
    day: { $dateToString: { format: "%Y-%m-%d", date: "$transactionDate" } },
    month: { $dateToString: { format: "%Y-%m", date: "$transactionDate" } },
    branch: "$branchId",
    module: "$sourceModule",
    paymentMethod: "$paymentMethod",
    type: "$transactionType",
};

const getLedgerReport = async (companyId, query = {}, managedBranchIds = null) => {
    const groupBy = REPORT_GROUPS[query.groupBy] ? query.groupBy : "day";
    const { match, from, to } = buildLedgerMatch(companyId, query, managedBranchIds);
    const rows = await BookkeepingEntry.aggregate([
        { $match: withoutVoided(match) },
        { $group: { _id: REPORT_GROUPS[groupBy], ...periodGroupFields } },
        { $sort: { _id: 1 } },
        { $limit: 1000 },
    ]);

    let branchNames = {};
    if (groupBy === "branch") {
        const Branch = require("../model/branch");
        const ids = rows.map((r) => r._id).filter(Boolean);
        const branches = await Branch.find({ _id: { $in: ids } }).select("name").lean();
        branchNames = Object.fromEntries(branches.map((b) => [String(b._id), b.name]));
    }

    return {
        meta: { groupBy, from: from.toISOString(), to: to.toISOString(), currency: DEFAULT_CURRENCY },
        rows: rows.map((r) => {
            const row = roundRow(r);
            const key = r._id == null ? "" : String(r._id);
            return {
                ...row,
                _id: undefined,
                key,
                label: groupBy === "branch" ? branchNames[key] || "No branch" : key || "—",
                netCashMovement: r2((r.cashIn || 0) - (r.cashOut || 0)),
            };
        }),
    };
};

const EXPORT_LIMIT = 50_000;

const exportLedger = async (companyId, query = {}, managedBranchIds = null) => {
    const ExcelJS = require("exceljs");
    const format = query.format === "csv" ? "csv" : "xlsx";
    const { match, from, to } = buildLedgerMatch(companyId, query, managedBranchIds);
    const rows = await BookkeepingEntry.find(match)
        .select(LEDGER_LIST_FIELDS)
        .populate("branchId", "name")
        .sort({ transactionDate: -1, _id: -1 })
        .limit(EXPORT_LIMIT)
        .lean();

    for (let i = 0; i < rows.length; i += 1000) {
        await presentRows(companyId, rows.slice(i, i + 1000));
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Bookkeeping");
    sheet.columns = [
        { header: "Entry No.", key: "entryNumber", width: 14 },
        { header: "Date", key: "date", width: 20 },
        { header: "Type", key: "type", width: 20 },
        { header: "Source", key: "source", width: 16 },
        { header: "Document No.", key: "documentNumber", width: 18 },
        { header: "Reference", key: "sourceNumber", width: 18 },
        { header: "Description", key: "description", width: 40 },
        { header: "Product", key: "productName", width: 28 },
        { header: "Party", key: "partyName", width: 24 },
        { header: "Branch", key: "branch", width: 18 },
        { header: "Stock", key: "stock", width: 10 },
        { header: "Stock Before → After", key: "stockBeforeAfter", width: 18 },
        { header: "Reserved", key: "reserved", width: 10 },
        { header: "Sold", key: "sold", width: 10 },
        { header: "Available", key: "available", width: 10 },
        { header: "Amount", key: "amount", width: 14 },
        { header: "Money In", key: "moneyIn", width: 14 },
        { header: "Money Out", key: "moneyOut", width: 14 },
        { header: "Payment Status", key: "paymentStatus", width: 16 },
        { header: "Payment Method", key: "paymentWay", width: 20 },
        { header: "Payment Ref.", key: "paymentReference", width: 20 },
        { header: "SKU", key: "sku", width: 16 },
        { header: "IMEI", key: "imeis", width: 24 },
        { header: "Created By", key: "createdByName", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };
    const qtyOnly = (r) => ["StockMovement", "BranchTransfer"].includes(r.sourceType);
    for (const r of rows) {
        const q = r.qtyChange || {};
        sheet.addRow({
            entryNumber: r.entryNumber,
            date: r.transactionDate ? new Date(r.transactionDate).toISOString().replace("T", " ").slice(0, 16) : "",
            type: r.typeLabel,
            source: r.sourceLabel,
            documentNumber: r.documentNumber,
            sourceNumber: r.sourceNumber,
            description: r.description,
            productName: r.productName,
            partyName: r.partyName,
            branch: r.branchId?.name || "",
            stock: q.stock || null,
            stockBeforeAfter: r.stockBefore === undefined ? "" : `${r.stockBefore} → ${r.stockAfter}`,
            reserved: q.reserved || null,
            sold: q.sold || null,
            available: q.available || null,
            amount: qtyOnly(r) ? null : r.amount || null,
            moneyIn: r.cashIn || null,
            moneyOut: r.cashOut || null,
            paymentStatus: String(r.paymentStatus || "").replace(/_/g, " "),
            paymentWay: r.paymentWay,
            paymentReference: r.paymentReference,
            sku: r.sku,
            imeis: (r.imeis || []).join(", "),
            createdByName: r.createdByName,
        });
    }

    const stamp = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    const buffer =
        format === "csv"
            ? await workbook.csv.writeBuffer()
            : await workbook.xlsx.writeBuffer();
    return {
        buffer: Buffer.from(buffer),
        filename: `bookkeeping_${stamp}.${format}`,
        contentType:
            format === "csv"
                ? "text/csv; charset=utf-8"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        rowCount: rows.length,
        truncated: rows.length >= EXPORT_LIMIT,
    };
};

module.exports = {
    getDashboard,
    listEntries,
    getEntry,
    getLedgerSummary,
    getLedgerReport,
    exportLedger,
};
