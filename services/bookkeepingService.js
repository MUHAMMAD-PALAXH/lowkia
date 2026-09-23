const Account = require("../model/account");
const Journal = require("../model/journal");
const { companyFilter } = require("../utils/tenantScope");
const { DEFAULT_CURRENCY } = require("../config/finance");

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

module.exports = { getDashboard };
