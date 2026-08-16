const AppError = require("../utils/appError");
const salesReportService = require("./salesReportService");
const purchaseReportService = require("./purchaseReportService");
const inventoryReportService = require("./inventoryReportService");
const repairReportService = require("./repairReportService");
const profitLossReportService = require("./profitLossReportService");

const n = (value) => Number(value) || 0;
const asDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
};
const id = (value) => (value == null ? "" : String(value._id || value));

const resultValue = (result) =>
    result.status === "fulfilled" ? result.value : null;
const resultError = (result, module) =>
    result.status === "rejected"
        ? {
              module,
              message: result.reason?.message || `${module} report failed.`,
          }
        : null;

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const common = {
        from: query.from,
        to: query.to,
        branchId: query.branchId,
        groupBy: query.groupBy || "day",
    };
    const results = await Promise.allSettled([
        salesReportService.getDashboard(
            companyId,
            { ...common, page: 1, limit: 5 },
            managedBranchIds
        ),
        purchaseReportService.getDashboard(
            companyId,
            { ...common, page: 1, limit: 5 },
            managedBranchIds
        ),
        inventoryReportService.getDashboard(
            companyId,
            {
                ...common,
                stockPage: 1,
                stockLimit: 5,
                movementPage: 1,
                movementLimit: 5,
            },
            managedBranchIds
        ),
        repairReportService.getDashboard(
            companyId,
            { ...common, page: 1, limit: 5 },
            managedBranchIds
        ),
        profitLossReportService.getDashboard(
            companyId,
            common,
            managedBranchIds
        ),
    ]);
    const [salesResult, purchaseResult, inventoryResult, repairResult, profitResult] =
        results;
    const sales = resultValue(salesResult);
    const purchases = resultValue(purchaseResult);
    const inventory = resultValue(inventoryResult);
    const repairs = resultValue(repairResult);
    const profitLoss = resultValue(profitResult);
    const errors = [
        resultError(salesResult, "sales"),
        resultError(purchaseResult, "purchases"),
        resultError(inventoryResult, "inventory"),
        resultError(repairResult, "repairs"),
        resultError(profitResult, "profitLoss"),
    ].filter(Boolean);
    if (errors.length === results.length) {
        throw new AppError(
            errors[0]?.message || "Executive overview could not be generated.",
            503
        );
    }

    const salesSummary = sales?.summary || {};
    const purchaseSummary = purchases?.summary || {};
    const inventorySummary = inventory?.summary || {};
    const repairSummary = repairs?.summary || {};
    const profitSummary = profitLoss?.summary || {};
    const currency =
        profitLoss?.meta?.currency ||
        sales?.meta?.currency ||
        purchases?.meta?.currency ||
        inventory?.meta?.currency ||
        repairs?.meta?.currency ||
        "USD";

    const alerts = [];
    const pushAlert = (condition, severity, title, detail, value, route) => {
        if (condition) {
            alerts.push({ severity, title, detail, value, route });
        }
    };
    pushAlert(
        n(repairSummary.overdueTickets) > 0,
        "critical",
        "Overdue repair tickets",
        "Repair jobs have passed their expected delivery date.",
        n(repairSummary.overdueTickets),
        "RepairReport"
    );
    pushAlert(
        n(inventorySummary.outOfStockCount) > 0,
        "critical",
        "Products out of stock",
        "Stock snapshots require replenishment attention.",
        n(inventorySummary.outOfStockCount),
        "InventoryReport"
    );
    pushAlert(
        n(inventorySummary.reorderAlertCount) > 0,
        "warning",
        "Reorder alerts",
        "Available stock is at or below configured reorder levels.",
        n(inventorySummary.reorderAlertCount),
        "InventoryReport"
    );
    pushAlert(
        n(salesSummary.dueAmount) > 0,
        "warning",
        "Customer receivables",
        "Completed sales still have outstanding balances.",
        n(salesSummary.dueAmount),
        "SalesReport"
    );
    pushAlert(
        n(purchaseSummary.payableOutstanding) > 0,
        "warning",
        "Supplier payables",
        "Supplier balances remain outstanding.",
        n(purchaseSummary.payableOutstanding),
        "PurchaseReport"
    );
    pushAlert(
        profitLoss?.meta?.reliability?.cogsCoveragePercent < 100,
        "info",
        "Provisional profit",
        "COGS coverage is incomplete; net profit is operational, not audited.",
        n(profitLoss?.meta?.reliability?.cogsCoveragePercent),
        "ProfitLoss"
    );

    const activities = [];
    for (const row of sales?.transactions?.items || []) {
        activities.push({
            id: id(row._id),
            module: "Sale",
            number: row.orderNumber || "Sales order",
            date: row.orderDate,
            party: row.customerName || "Walk-in customer",
            status: row.status || "",
            amount: n(row.grandTotal),
            route: "SalesOrders",
        });
    }
    for (const row of purchases?.transactions?.items || []) {
        activities.push({
            id: id(row.id || row._id),
            module: "Purchase",
            number: row.purchaseOrderNo || row.number || "Purchase order",
            date: row.orderDate || row.date,
            party: row.supplierName || row.supplier?.name || "Supplier",
            status: row.status || "",
            amount: n(row.grandTotal || row.poCommitment),
            route: "PurchaseOrders",
        });
    }
    for (const row of repairs?.tickets?.items || []) {
        activities.push({
            id: id(row.id || row._id),
            module: "Repair",
            number: row.ticketNumber || "Repair ticket",
            date: row.receivedDate,
            party: row.customerName || "Customer",
            status: row.status || "",
            amount: n(row.totalAmount),
            route: "RepairTickets",
        });
    }
    for (const row of inventory?.movementRows?.items || []) {
        activities.push({
            id: id(row.id || row.movementId),
            module: "Inventory",
            number: row.movementNumber || "Stock movement",
            date: row.movementDate || row.date,
            party: row.productName || row.name || "Product",
            status: `${row.movementType || ""} ${row.movementDirection || ""}`.trim(),
            amount: n(row.totalCost),
            route: "InventoryReport",
        });
    }
    activities.sort((a, b) => {
        const left = asDate(a.date)?.getTime() || 0;
        const right = asDate(b.date)?.getTime() || 0;
        return right - left;
    });

    const warnings = [
        ...(inventory?.meta?.reliability?.warnings || []).map((message) => ({
            module: "inventory",
            message,
        })),
        ...(profitLoss?.meta?.reliability?.warnings || []).map((message) => ({
            module: "profitLoss",
            message,
        })),
        ...errors,
    ];

    return {
        meta: {
            reportType: "executive_overview",
            generatedAt: new Date().toISOString(),
            currency,
            filters: common,
            partial: errors.length > 0,
            availableModules: {
                sales: !!sales,
                purchases: !!purchases,
                inventory: !!inventory,
                repairs: !!repairs,
                profitLoss: !!profitLoss,
            },
            warnings,
        },
        executive: {
            totalRevenue: n(profitSummary.totalRevenue),
            netProfit: n(profitSummary.netProfit),
            netMargin: n(profitSummary.netMargin),
            cashCollected: n(profitSummary.cashCollected),
            receivables: n(profitSummary.receivables),
            stockValue: n(inventorySummary.stockValue),
            salesOrders: n(salesSummary.orderCount),
            purchaseOrders: n(purchaseSummary.poCount),
            openRepairs: n(repairSummary.openTickets),
            overdueRepairs: n(repairSummary.overdueTickets),
            lowStock: n(inventorySummary.lowStockCount),
            outOfStock: n(inventorySummary.outOfStockCount),
        },
        sales: {
            netSales: n(salesSummary.netSales),
            grossSales: n(salesSummary.grossSales),
            returns: n(salesSummary.returnAmount),
            orders: n(salesSummary.orderCount),
            collected: n(salesSummary.paidAmount),
            due: n(salesSummary.dueAmount),
            averageOrderValue: n(salesSummary.averageOrderValue),
            statusBreakdown: sales?.statusBreakdown || [],
        },
        purchases: {
            commitment: n(purchaseSummary.poCommitment),
            receivedValue: n(purchaseSummary.receivedValue),
            orders: n(purchaseSummary.poCount),
            paid: n(purchaseSummary.paymentsPaid),
            outstanding: n(purchaseSummary.payableOutstanding),
            receiptRate: n(purchaseSummary.receiptRate),
            statusBreakdown: purchases?.statusBreakdown || [],
        },
        inventory: {
            stockValue: n(inventorySummary.stockValue),
            totalStock: n(inventorySummary.totalStock),
            availableStock: n(inventorySummary.availableStock),
            reservedStock: n(inventorySummary.reservedStock),
            skuCount: n(inventorySummary.skuCount),
            lowStock: n(inventorySummary.lowStockCount),
            outOfStock: n(inventorySummary.outOfStockCount),
            reorderAlerts: n(inventorySummary.reorderAlertCount),
            topStockValue: (inventory?.topStockValue || []).slice(0, 5),
        },
        repairs: {
            totalTickets: n(repairSummary.totalTickets),
            openTickets: n(repairSummary.openTickets),
            completedTickets: n(repairSummary.completedTickets),
            overdueTickets: n(repairSummary.overdueTickets),
            revenue: n(repairSummary.revenue),
            due: n(repairSummary.due),
            slaComplianceRate: n(repairSummary.slaComplianceRate),
            statusBreakdown: repairs?.statusBreakdown || [],
        },
        profitLoss: {
            totalRevenue: n(profitSummary.totalRevenue),
            cogs: n(profitSummary.cogs),
            grossProfit: n(profitSummary.grossProfit),
            operatingExpenses: n(profitSummary.totalOperatingExpenses),
            netProfit: n(profitSummary.netProfit),
            grossMargin: n(profitSummary.grossMargin),
            netMargin: n(profitSummary.netMargin),
            comparison: profitLoss?.comparison || {},
            trend: profitLoss?.trend || [],
            provisional: !!profitLoss?.meta?.reliability?.provisional,
            cogsCoveragePercent: n(
                profitLoss?.meta?.reliability?.cogsCoveragePercent
            ),
        },
        alerts,
        topProducts: (profitLoss?.topProducts || []).slice(0, 8),
        branchPerformance: profitLoss?.branchBreakdown || [],
        recentActivity: activities.slice(0, 12),
    };
};

module.exports = { getDashboard };
