const ExcelJS = require("exceljs");

const MAX_EXPORT_ORDERS = 25000;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const str = (v) => {
    if (v == null) return "";
    return String(v).trim();
};

const fmtDate = (d) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const fmtDateTime = (d) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString().replace("T", " ").slice(0, 19);
};

const refName = (ref, fallbacks = []) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    for (const key of fallbacks) {
        if (ref[key]) return str(ref[key]);
    }
    return str(ref.name || ref.code || "");
};

const styleHeader = (row) => {
    row.font = { bold: true };
    row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF5" },
    };
    row.alignment = { vertical: "middle", wrapText: true };
};

const autoWidth = (sheet, widths) => {
    widths.forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
    });
};

const applyTableExtras = (sheet, colCount) => {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (sheet.rowCount > 1) {
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: sheet.rowCount, column: colCount },
        };
    }
};

/**
 * @param {object} opts
 * @param {Array} opts.orders - populated SalesOrder docs (lean or mongoose)
 * @param {Array} opts.payments - Payment docs
 * @param {object} opts.meta - export summary metadata
 * @returns {Promise<Buffer>}
 */
const buildSalesOrderWorkbook = async ({
    orders = [],
    payments = [],
    meta = {},
} = {}) => {
    if (orders.length > MAX_EXPORT_ORDERS) {
        const err = new Error(
            `Export limited to ${MAX_EXPORT_ORDERS} orders. Narrow your filters.`
        );
        err.statusCode = 400;
        throw err;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Lowkia ERP";
    workbook.created = new Date();
    workbook.modified = new Date();

    // ── Sheet 1: Sales Orders ─────────────────────────────
    const soSheet = workbook.addWorksheet("Sales Orders", {
        properties: { defaultRowHeight: 18 },
    });
    const soHeaders = [
        "Order Number",
        "Order Date",
        "Status",
        "Sales Type",
        "Customer Name",
        "Customer Phone",
        "Customer Email",
        "Branch",
        "Warehouse",
        "Payment Status",
        "Payment Method",
        "Subtotal",
        "Discount",
        "Tax",
        "Shipping",
        "Other Charges",
        "Grand Total",
        "Paid Amount",
        "Due Amount",
        "Reference Number",
        "Created By",
        "Item Count",
    ];
    soSheet.addRow(soHeaders);
    styleHeader(soSheet.getRow(1));

    let totalSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalItems = 0;

    for (const o of orders) {
        const itemCount = Array.isArray(o.items) ? o.items.length : 0;
        totalItems += itemCount;
        totalSales += num(o.grandTotal);
        totalDiscount += num(o.discount);
        totalTax += num(o.tax);
        totalPaid += num(o.paidAmount);
        totalDue += num(o.dueAmount);

        soSheet.addRow([
            str(o.orderNumber),
            fmtDate(o.orderDate),
            str(o.status),
            str(o.salesType),
            str(o.customerName) ||
                refName(o.customerId, ["name", "companyName"]),
            str(o.customerPhone) || refName(o.customerId, ["phone"]),
            str(o.customerEmail) || refName(o.customerId, ["email"]),
            refName(o.branchId, ["name", "code", "branchCode"]),
            refName(o.warehouseId, ["warehouseName", "warehouseCode", "name"]),
            str(o.paymentStatus),
            str(o.paymentMethod),
            num(o.subtotal),
            num(o.discount),
            num(o.tax),
            num(o.shippingCost),
            num(o.otherCharges),
            num(o.grandTotal),
            num(o.paidAmount),
            num(o.dueAmount),
            str(o.referenceNumber),
            refName(o.createdBy, ["name", "email"]),
            itemCount,
        ]);
    }

    autoWidth(soSheet, [
        16, 12, 14, 12, 22, 14, 22, 16, 16, 14, 14, 12, 12, 10, 12, 12, 12, 12,
        12, 16, 18, 10,
    ]);
    applyTableExtras(soSheet, soHeaders.length);

    // Number format for money columns (L–S = 12–19)
    for (let c = 12; c <= 19; c++) {
        soSheet.getColumn(c).numFmt = "#,##0.00";
    }

    // ── Sheet 2: Order Items ──────────────────────────────
    const itemSheet = workbook.addWorksheet("Order Items");
    const itemHeaders = [
        "Order Number",
        "Order Date",
        "Product",
        "SKU",
        "Variant",
        "Qty",
        "Unit Price",
        "Discount",
        "Tax",
        "Line Total",
        "Tracking Type",
        "IMEIs",
        "Stock Warehouse",
    ];
    itemSheet.addRow(itemHeaders);
    styleHeader(itemSheet.getRow(1));

    for (const o of orders) {
        const lines = Array.isArray(o.items) ? o.items : [];
        if (lines.length === 0) {
            itemSheet.addRow([
                str(o.orderNumber),
                fmtDate(o.orderDate),
                "",
                "",
                "",
                0,
                0,
                0,
                0,
                0,
                "",
                "",
                "",
            ]);
            continue;
        }
        for (const line of lines) {
            const variant = line.productVariantId;
            const variantLabel =
                (variant &&
                    (variant.combinationString ||
                        variant.sku ||
                        str(variant._id))) ||
                "";
            const imeis = Array.isArray(line.imeis)
                ? line.imeis.map(str).filter(Boolean).join(", ")
                : "";
            itemSheet.addRow([
                str(o.orderNumber),
                fmtDate(o.orderDate),
                str(line.productName) ||
                    refName(line.productId, ["name", "productCode"]),
                str(line.sku) ||
                    (variant && str(variant.sku)) ||
                    refName(line.productId, ["productCode"]),
                variantLabel,
                num(line.quantity),
                num(line.unitPrice),
                num(line.discount),
                num(line.tax),
                num(line.total),
                str(line.trackingType),
                imeis,
                refName(line.stockWarehouseId, [
                    "warehouseName",
                    "warehouseCode",
                ]),
            ]);
        }
    }

    autoWidth(itemSheet, [
        16, 12, 28, 16, 18, 8, 12, 10, 10, 12, 12, 28, 16,
    ]);
    applyTableExtras(itemSheet, itemHeaders.length);
    for (const c of [6, 7, 8, 9, 10]) {
        itemSheet.getColumn(c).numFmt = "#,##0.00";
    }
    itemSheet.getColumn(6).numFmt = "#,##0.####";

    // ── Sheet 3: Payments ─────────────────────────────────
    const paySheet = workbook.addWorksheet("Payments");
    const payHeaders = [
        "Order Number",
        "Payment Number",
        "Payment Date",
        "Method",
        "Reference",
        "Amount",
        "Status",
    ];
    paySheet.addRow(payHeaders);
    styleHeader(paySheet.getRow(1));

    const orderNumById = new Map(
        orders.map((o) => [String(o._id), str(o.orderNumber)])
    );

    for (const p of payments) {
        const soId = p.salesOrderId
            ? String(p.salesOrderId._id || p.salesOrderId)
            : p.referenceId
              ? String(p.referenceId)
              : "";
        paySheet.addRow([
            orderNumById.get(soId) || "",
            str(p.paymentNumber),
            fmtDate(p.paymentDate),
            str(p.paymentMethod),
            str(p.paymentMethodReference || p.providerReference || ""),
            num(p.amount),
            str(p.status),
        ]);
    }

    autoWidth(paySheet, [16, 18, 12, 14, 20, 12, 12]);
    applyTableExtras(paySheet, payHeaders.length);
    paySheet.getColumn(6).numFmt = "#,##0.00";

    // ── Sheet 4: Export Summary ───────────────────────────
    const sumSheet = workbook.addWorksheet("Export Summary");
    sumSheet.addRow(["Field", "Value"]);
    styleHeader(sumSheet.getRow(1));
    const filterLines = meta.filters || {};
    const summaryRows = [
        ["Export Date", fmtDateTime(meta.exportedAt || new Date())],
        ["Exported By", str(meta.exportedBy || "")],
        ["Company", str(meta.companyName || meta.companyId || "")],
        ["Trash Mode", filterLines.trash ? "Yes" : "No"],
        ["Search", str(filterLines.search || "")],
        ["Status", str(filterLines.status || "All")],
        ["Date From", str(filterLines.dateFrom || "")],
        ["Date To", str(filterLines.dateTo || "")],
        ["Sort", str(filterLines.sort || "newest")],
        ["Total Orders", orders.length],
        ["Total Line Items", totalItems],
        ["Total Sales (Grand Total)", totalSales],
        ["Total Discount", totalDiscount],
        ["Total Tax", totalTax],
        ["Total Paid", totalPaid],
        ["Total Due", totalDue],
        ["Payment Rows", payments.length],
    ];
    for (const row of summaryRows) sumSheet.addRow(row);
    autoWidth(sumSheet, [28, 36]);
    for (const r of [12, 13, 14, 15, 16]) {
        sumSheet.getRow(r).getCell(2).numFmt = "#,##0.00";
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const from = str(query.dateFrom || query.fromDate || query.startDate);
    const to = str(query.dateTo || query.toDate || query.endDate);
    const today = fmtDate(new Date());
    if (from && to) return `sales_orders_${from}_to_${to}.xlsx`;
    if (from) return `sales_orders_from_${from}.xlsx`;
    if (to) return `sales_orders_to_${to}.xlsx`;
    return `sales_orders_${today}.xlsx`;
};

module.exports = {
    buildSalesOrderWorkbook,
    buildExportFilename,
    MAX_EXPORT_ORDERS,
};
