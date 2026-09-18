const ExcelJS = require("exceljs");

const MAX_EXPORT_ORDERS = 25000;

/** Lowkia-aligned professional palette (teal / slate — not flashy). */
const C = {
    brand: "FF0F766E", // deep teal
    brandSoft: "FFCCFBF1",
    headerBg: "FF134E4A",
    headerFg: "FFFFFFFF",
    zebra: "FFF0FDFA",
    white: "FFFFFFFF",
    border: "FFCBD5E1",
    text: "FF0F172A",
    muted: "FF64748B",
    money: "FF0F172A",
    totalBg: "FFECFDF5",
    totalFg: "FF065F46",
    sectionBg: "FFE2E8F0",
    kpiLabel: "FF475569",
    ok: "FFDCFCE7",
    okText: "FF166534",
    warn: "FFFEF3C7",
    warnText: "FF92400E",
    danger: "FFFEE2E2",
    dangerText: "FF991B1B",
    info: "FFE0F2FE",
    infoText: "FF075985",
    titleBand: "FF0F766E",
};

const thinBorder = {
    top: { style: "thin", color: { argb: C.border } },
    left: { style: "thin", color: { argb: C.border } },
    bottom: { style: "thin", color: { argb: C.border } },
    right: { style: "thin", color: { argb: C.border } },
};

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
    return dt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
};

const refName = (ref, fallbacks = []) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    for (const key of fallbacks) {
        if (ref[key]) return str(ref[key]);
    }
    return str(ref.name || ref.code || "");
};

const setWidths = (sheet, widths) => {
    widths.forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
    });
};

const paintRange = (sheet, row, fromCol, toCol, fillArgb) => {
    for (let c = fromCol; c <= toCol; c++) {
        const cell = sheet.getRow(row).getCell(c);
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillArgb },
        };
    }
};

const addTitleBlock = (sheet, colCount, title, subtitle) => {
    sheet.mergeCells(1, 1, 1, colCount);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = {
        name: "Calibri",
        size: 16,
        bold: true,
        color: { argb: C.headerFg },
    };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: C.titleBand },
    };
    sheet.getRow(1).height = 28;
    paintRange(sheet, 1, 1, colCount, C.titleBand);

    sheet.mergeCells(2, 1, 2, colCount);
    const sub = sheet.getCell(2, 1);
    sub.value = subtitle;
    sub.font = {
        name: "Calibri",
        size: 10,
        italic: true,
        color: { argb: C.muted },
    };
    sub.alignment = { vertical: "middle", horizontal: "left" };
    sub.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: C.brandSoft },
    };
    sheet.getRow(2).height = 20;
    paintRange(sheet, 2, 1, colCount, C.brandSoft);

    return 3; // next data header row
};

const styleColumnHeader = (row, colCount) => {
    row.height = 24;
    for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.font = {
            name: "Calibri",
            size: 11,
            bold: true,
            color: { argb: C.headerFg },
        };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.headerBg },
        };
        cell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };
        cell.border = thinBorder;
    }
};

const alignCell = (cell, kind) => {
    const base = { vertical: "middle", wrapText: false };
    if (kind === "money" || kind === "qty") {
        cell.alignment = { ...base, horizontal: "right" };
    } else if (kind === "center") {
        cell.alignment = { ...base, horizontal: "center" };
    } else {
        cell.alignment = { ...base, horizontal: "left" };
    }
    cell.font = {
        name: "Calibri",
        size: 10,
        color: { argb: kind === "money" ? C.money : C.text },
    };
    cell.border = thinBorder;
};

const statusFill = (raw) => {
    const s = str(raw).toLowerCase();
    if (
        s.includes("paid") ||
        s.includes("completed") ||
        s.includes("approved") ||
        s.includes("confirmed") ||
        s.includes("success")
    ) {
        return { bg: C.ok, fg: C.okText };
    }
    if (
        s.includes("partial") ||
        s.includes("pending") ||
        s.includes("processing") ||
        s.includes("draft")
    ) {
        return { bg: C.warn, fg: C.warnText };
    }
    if (
        s.includes("cancel") ||
        s.includes("refund") ||
        s.includes("fail") ||
        s.includes("void")
    ) {
        return { bg: C.danger, fg: C.dangerText };
    }
    return { bg: C.info, fg: C.infoText };
};

const applyStatusChip = (cell, value) => {
    const v = str(value);
    cell.value = v || "—";
    const { bg, fg } = statusFill(v);
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bg },
    };
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: fg } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder;
};

const styleDataRow = (row, colKinds, zebra) => {
    row.height = 20;
    for (let c = 1; c <= colKinds.length; c++) {
        const cell = row.getCell(c);
        const kind = colKinds[c - 1];
        if (kind === "status") {
            applyStatusChip(cell, cell.value);
        } else {
            alignCell(cell, kind);
            if (zebra) {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: C.zebra },
                };
            }
        }
        if (kind === "money") cell.numFmt = '#,##0.00';
        if (kind === "qty") cell.numFmt = '#,##0.####';
        if (cell.value === "" || cell.value == null) {
            if (kind !== "status") cell.value = "—";
        }
    }
};

const styleTotalsRow = (row, colKinds) => {
    row.height = 22;
    for (let c = 1; c <= colKinds.length; c++) {
        const cell = row.getCell(c);
        const kind = colKinds[c - 1];
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.totalBg },
        };
        cell.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.totalFg },
        };
        cell.border = thinBorder;
        alignCell(cell, kind === "text" ? "text" : kind);
        cell.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.totalFg },
        };
        if (kind === "money") cell.numFmt = '#,##0.00';
        if (kind === "qty") cell.numFmt = '#,##0.####';
    }
};

const freezeAndFilter = (sheet, headerRow, colCount, lastDataRow) => {
    sheet.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
    if (lastDataRow >= headerRow) {
        sheet.autoFilter = {
            from: { row: headerRow, column: 1 },
            to: { row: lastDataRow, column: colCount },
        };
    }
};

/**
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
    workbook.company = "Lowkia";
    workbook.created = new Date();
    workbook.modified = new Date();

    const exportedAt = meta.exportedAt || new Date();
    const exportedBy = str(meta.exportedBy || "System");
    const filterLines = meta.filters || {};
    const filterHint = [
        filterLines.status ? `Status: ${filterLines.status}` : null,
        filterLines.dateFrom || filterLines.dateTo
            ? `Dates: ${filterLines.dateFrom || "…"} → ${filterLines.dateTo || "…"}`
            : null,
        filterLines.search ? `Search: ${filterLines.search}` : null,
        filterLines.trash ? "Trash view" : null,
    ]
        .filter(Boolean)
        .join("  ·  ");

    let totalSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalItems = 0;
    let totalShipping = 0;
    let totalOther = 0;
    let totalSubtotal = 0;

    // ═══════════════════════════════════════════════════════
    // Sheet 1 — Sales Orders
    // ═══════════════════════════════════════════════════════
    const soSheet = workbook.addWorksheet("Sales Orders", {
        properties: { defaultRowHeight: 18, tabColor: { argb: C.brand } },
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
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
    const soKinds = [
        "text",
        "center",
        "status",
        "center",
        "text",
        "center",
        "text",
        "text",
        "text",
        "status",
        "center",
        "money",
        "money",
        "money",
        "money",
        "money",
        "money",
        "money",
        "money",
        "text",
        "text",
        "qty",
    ];

    const soHeaderRow = addTitleBlock(
        soSheet,
        soHeaders.length,
        "LOWKIA ERP  ·  Sales Orders",
        `Exported ${fmtDateTime(exportedAt)}  ·  By ${exportedBy}${
            filterHint ? "  ·  " + filterHint : ""
        }`
    );
    soSheet.getRow(soHeaderRow).values = [null, ...soHeaders];
    styleColumnHeader(soSheet.getRow(soHeaderRow), soHeaders.length);

    let soRowIdx = soHeaderRow;
    orders.forEach((o, i) => {
        const itemCount = Array.isArray(o.items) ? o.items.length : 0;
        totalItems += itemCount;
        totalSales += num(o.grandTotal);
        totalDiscount += num(o.discount);
        totalTax += num(o.tax);
        totalPaid += num(o.paidAmount);
        totalDue += num(o.dueAmount);
        totalShipping += num(o.shippingCost);
        totalOther += num(o.otherCharges);
        totalSubtotal += num(o.subtotal);

        soRowIdx += 1;
        const row = soSheet.getRow(soRowIdx);
        row.values = [
            null,
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
        ];
        styleDataRow(row, soKinds, i % 2 === 1);
    });

    // Totals footer
    soRowIdx += 1;
    const soTotal = soSheet.getRow(soRowIdx);
    soTotal.values = [
        null,
        "TOTALS",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        totalSubtotal,
        totalDiscount,
        totalTax,
        totalShipping,
        totalOther,
        totalSales,
        totalPaid,
        totalDue,
        "",
        "",
        totalItems,
    ];
    styleTotalsRow(soTotal, soKinds);

    setWidths(soSheet, [
        15, 12, 14, 11, 22, 14, 22, 14, 14, 13, 13, 11, 11, 10, 11, 12, 12, 12,
        11, 14, 16, 10,
    ]);
    freezeAndFilter(soSheet, soHeaderRow, soHeaders.length, soRowIdx - 1);

    // ═══════════════════════════════════════════════════════
    // Sheet 2 — Order Items
    // ═══════════════════════════════════════════════════════
    const itemSheet = workbook.addWorksheet("Order Items", {
        properties: { defaultRowHeight: 18, tabColor: { argb: "FF0EA5E9" } },
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });
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
    const itemKinds = [
        "text",
        "center",
        "text",
        "text",
        "text",
        "qty",
        "money",
        "money",
        "money",
        "money",
        "center",
        "text",
        "text",
    ];

    const itemHeaderRow = addTitleBlock(
        itemSheet,
        itemHeaders.length,
        "LOWKIA ERP  ·  Order Line Items",
        `One row per product line  ·  IMEIs joined when multiple  ·  ${fmtDateTime(exportedAt)}`
    );
    itemSheet.getRow(itemHeaderRow).values = [null, ...itemHeaders];
    styleColumnHeader(itemSheet.getRow(itemHeaderRow), itemHeaders.length);

    let itemRowIdx = itemHeaderRow;
    let itemLineCount = 0;
    let itemQtySum = 0;
    let itemTotalSum = 0;
    let itemZebra = 0;

    for (const o of orders) {
        const lines = Array.isArray(o.items) ? o.items : [];
        if (lines.length === 0) {
            itemRowIdx += 1;
            const row = itemSheet.getRow(itemRowIdx);
            row.values = [
                null,
                str(o.orderNumber),
                fmtDate(o.orderDate),
                "(no lines)",
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
            ];
            styleDataRow(row, itemKinds, itemZebra++ % 2 === 1);
            continue;
        }
        for (const line of lines) {
            itemLineCount += 1;
            itemQtySum += num(line.quantity);
            itemTotalSum += num(line.total);
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
            itemRowIdx += 1;
            const row = itemSheet.getRow(itemRowIdx);
            row.values = [
                null,
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
            ];
            styleDataRow(row, itemKinds, itemZebra++ % 2 === 1);
        }
    }

    itemRowIdx += 1;
    const itemTotal = itemSheet.getRow(itemRowIdx);
    itemTotal.values = [
        null,
        "TOTALS",
        "",
        `${itemLineCount} lines`,
        "",
        "",
        itemQtySum,
        "",
        "",
        "",
        itemTotalSum,
        "",
        "",
        "",
    ];
    styleTotalsRow(itemTotal, itemKinds);

    setWidths(itemSheet, [
        15, 12, 28, 14, 16, 8, 11, 10, 10, 12, 12, 26, 16,
    ]);
    freezeAndFilter(
        itemSheet,
        itemHeaderRow,
        itemHeaders.length,
        itemRowIdx - 1
    );

    // ═══════════════════════════════════════════════════════
    // Sheet 3 — Payments
    // ═══════════════════════════════════════════════════════
    const paySheet = workbook.addWorksheet("Payments", {
        properties: { defaultRowHeight: 18, tabColor: { argb: "FF059669" } },
    });
    const payHeaders = [
        "Order Number",
        "Payment Number",
        "Payment Date",
        "Method",
        "Reference",
        "Amount",
        "Status",
    ];
    const payKinds = [
        "text",
        "text",
        "center",
        "center",
        "text",
        "money",
        "status",
    ];

    const payHeaderRow = addTitleBlock(
        paySheet,
        payHeaders.length,
        "LOWKIA ERP  ·  Payments",
        `Ledger payments linked to exported sales orders  ·  ${fmtDateTime(exportedAt)}`
    );
    paySheet.getRow(payHeaderRow).values = [null, ...payHeaders];
    styleColumnHeader(paySheet.getRow(payHeaderRow), payHeaders.length);

    const orderNumById = new Map(
        orders.map((o) => [String(o._id), str(o.orderNumber)])
    );

    let payRowIdx = payHeaderRow;
    let payAmountSum = 0;
    payments.forEach((p, i) => {
        const soId = p.salesOrderId
            ? String(p.salesOrderId._id || p.salesOrderId)
            : p.referenceId
              ? String(p.referenceId)
              : "";
        payAmountSum += num(p.amount);
        payRowIdx += 1;
        const row = paySheet.getRow(payRowIdx);
        row.values = [
            null,
            orderNumById.get(soId) || "",
            str(p.paymentNumber),
            fmtDate(p.paymentDate),
            str(p.paymentMethod),
            str(p.paymentMethodReference || p.providerReference || ""),
            num(p.amount),
            str(p.status),
        ];
        styleDataRow(row, payKinds, i % 2 === 1);
    });

    payRowIdx += 1;
    const payTotal = paySheet.getRow(payRowIdx);
    payTotal.values = [
        null,
        "TOTALS",
        `${payments.length} payments`,
        "",
        "",
        "",
        payAmountSum,
        "",
    ];
    styleTotalsRow(payTotal, payKinds);

    setWidths(paySheet, [15, 18, 12, 14, 22, 12, 12]);
    freezeAndFilter(
        paySheet,
        payHeaderRow,
        payHeaders.length,
        Math.max(payHeaderRow, payRowIdx - 1)
    );

    // ═══════════════════════════════════════════════════════
    // Sheet 4 — Export Summary (structured dashboard)
    // ═══════════════════════════════════════════════════════
    const sumSheet = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" } },
    });
    setWidths(sumSheet, [28, 42, 18, 18]);

    sumSheet.mergeCells(1, 1, 1, 4);
    const sTitle = sumSheet.getCell(1, 1);
    sTitle.value = "LOWKIA ERP  ·  Export Summary";
    sTitle.font = {
        name: "Calibri",
        size: 16,
        bold: true,
        color: { argb: C.headerFg },
    };
    sTitle.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: C.titleBand },
    };
    sTitle.alignment = { vertical: "middle", horizontal: "left" };
    sumSheet.getRow(1).height = 30;
    paintRange(sumSheet, 1, 1, 4, C.titleBand);

    const addSection = (row, label) => {
        sumSheet.mergeCells(row, 1, row, 4);
        const cell = sumSheet.getCell(row, 1);
        cell.value = label;
        cell.font = {
            name: "Calibri",
            size: 11,
            bold: true,
            color: { argb: C.text },
        };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.sectionBg },
        };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        sumSheet.getRow(row).height = 22;
        paintRange(sumSheet, row, 1, 4, C.sectionBg);
        return row + 1;
    };

    const addKV = (row, label, value, money = false) => {
        const a = sumSheet.getCell(row, 1);
        const b = sumSheet.getCell(row, 2);
        a.value = label;
        a.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.kpiLabel },
        };
        a.border = thinBorder;
        a.alignment = { vertical: "middle", horizontal: "left" };
        b.value = value;
        b.font = { name: "Calibri", size: 10, color: { argb: C.text } };
        b.border = thinBorder;
        b.alignment = {
            vertical: "middle",
            horizontal: money ? "right" : "left",
        };
        if (money) b.numFmt = '#,##0.00';
        sumSheet.getRow(row).height = 20;
        return row + 1;
    };

    const addKpi = (row, col, label, value, money = false) => {
        const labelCell = sumSheet.getCell(row, col);
        const valueCell = sumSheet.getCell(row + 1, col);
        labelCell.value = label;
        labelCell.font = {
            name: "Calibri",
            size: 9,
            bold: true,
            color: { argb: C.kpiLabel },
        };
        labelCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.brandSoft },
        };
        labelCell.alignment = { horizontal: "center", vertical: "middle" };
        labelCell.border = thinBorder;
        valueCell.value = value;
        valueCell.font = {
            name: "Calibri",
            size: 14,
            bold: true,
            color: { argb: C.brand },
        };
        valueCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.white },
        };
        valueCell.alignment = { horizontal: "center", vertical: "middle" };
        valueCell.border = thinBorder;
        if (money) valueCell.numFmt = '#,##0.00';
        sumSheet.getRow(row).height = 18;
        sumSheet.getRow(row + 1).height = 26;
    };

    let r = 3;
    r = addSection(r, "EXPORT META");
    r = addKV(r, "Export Date", fmtDateTime(exportedAt));
    r = addKV(r, "Exported By", exportedBy);
    r = addKV(r, "Company", str(meta.companyName || meta.companyId || "—"));
    r += 1;

    r = addSection(r, "APPLIED FILTERS");
    r = addKV(r, "Trash Mode", filterLines.trash ? "Yes" : "No");
    r = addKV(r, "Search", str(filterLines.search || "—"));
    r = addKV(r, "Status", str(filterLines.status || "All"));
    r = addKV(r, "Date From", str(filterLines.dateFrom || "—"));
    r = addKV(r, "Date To", str(filterLines.dateTo || "—"));
    r = addKV(r, "Sort", str(filterLines.sort || "newest"));
    r = addKV(r, "Branch ID", str(filterLines.branchId || "—"));
    r = addKV(r, "Warehouse ID", str(filterLines.warehouseId || "—"));
    r = addKV(r, "Customer ID", str(filterLines.customerId || "—"));
    r += 1;

    r = addSection(r, "KEY METRICS");
    const kpiRow = r;
    addKpi(kpiRow, 1, "ORDERS", orders.length);
    addKpi(kpiRow, 2, "LINE ITEMS", totalItems);
    addKpi(kpiRow, 3, "PAYMENTS", payments.length);
    addKpi(kpiRow, 4, "GRAND TOTAL", totalSales, true);
    r = kpiRow + 3;

    r = addSection(r, "FINANCIAL TOTALS (from stored Sales Order values)");
    r = addKV(r, "Subtotal", totalSubtotal, true);
    r = addKV(r, "Discount", totalDiscount, true);
    r = addKV(r, "Tax", totalTax, true);
    r = addKV(r, "Shipping", totalShipping, true);
    r = addKV(r, "Other Charges", totalOther, true);
    r = addKV(r, "Grand Total", totalSales, true);
    r = addKV(r, "Paid Amount", totalPaid, true);
    r = addKV(r, "Due Amount", totalDue, true);
    r = addKV(r, "Payment Ledger Sum", payAmountSum, true);

    sumSheet.views = [{ showGridLines: false }];

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
