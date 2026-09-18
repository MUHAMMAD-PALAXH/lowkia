const ExcelJS = require("exceljs");

const MAX_EXPORT_ORDERS = 25000;

/**
 * Soft professional palette — airy, high contrast headers, calm body.
 * Group separation via header colors + left accent on group starts.
 */
const C = {
    ink: "FF1E293B",
    muted: "FF64748B",
    softMuted: "FF94A3B8",
    paper: "FFFFFFFF",
    canvas: "FFF8FAFC",
    zebra: "FFF1F5F9",
    line: "FFE2E8F0",
    lineSoft: "FFF1F5F9",

    // Brand accents (teal family)
    brand: "FF0D9488",
    brandDeep: "FF0F766E",
    brandInk: "FFFFFFFF",
    brandMist: "FFF0FDFA",
    brandWash: "FFCCFBF1",

    // Group header tints (subtle, distinct)
    gOrder: "FF0F766E",
    gCustomer: "FF0369A1",
    gPlace: "FF4338CA",
    gPay: "FFB45309",
    gMoney: "FF047857",
    gMeta: "FF475569",

    okBg: "FFECFDF5",
    okFg: "FF065F46",
    warnBg: "FFFFFBEB",
    warnFg: "FF92400E",
    badBg: "FFFEF2F2",
    badFg: "FF991B1B",
    infoBg: "FFF0F9FF",
    infoFg: "FF075985",

    totalBg: "FFECFDF5",
    totalFg: "FF134E4A",};


const borderHair = {
    top: { style: "hair", color: { argb: C.line } },
    left: { style: "hair", color: { argb: C.line } },
    bottom: { style: "hair", color: { argb: C.line } },
    right: { style: "hair", color: { argb: C.line } },
};

const borderSoft = {
    top: { style: "thin", color: { argb: C.line } },
    left: { style: "thin", color: { argb: C.line } },
    bottom: { style: "thin", color: { argb: C.line } },
    right: { style: "thin", color: { argb: C.line } },
};

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const str = (v) => {
    if (v == null) return "";
    return String(v).trim();
};

const dash = (v) => {
    const s = str(v);
    return s === "" ? "—" : s;
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

const fillRow = (sheet, rowNum, from, to, argb) => {
    for (let c = from; c <= to; c++) {
        sheet.getRow(rowNum).getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb },
        };
    }
};

/**
 * Column definition:
 * { h, k, w, g?, groupStart? }  header, kind, width, group color, group edge
 */
const buildSheetChrome = (workbook, name, tabArgb, colDefs, title, subtitle) => {
    const sheet = workbook.addWorksheet(name, {
        properties: {
            defaultRowHeight: 22,
            tabColor: { argb: tabArgb },
        },
        pageSetup: {
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            horizontalCentered: true,
            margins: {
                left: 0.4,
                right: 0.4,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2,
            },
        },
        views: [{ showGridLines: false }],
    });

    const colCount = colDefs.length;
    const widths = colDefs.map((d) => d.w);
    setWidths(sheet, widths);

    // Row 1 — brand title
    sheet.mergeCells(1, 1, 1, colCount);
    const t = sheet.getCell(1, 1);
    t.value = title;
    t.font = {
        name: "Calibri",
        size: 18,
        bold: true,
        color: { argb: C.brandInk },
    };
    t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sheet.getRow(1).height = 34;
    fillRow(sheet, 1, 1, colCount, C.brandDeep);

    // Row 2 — soft accent strip
    sheet.mergeCells(2, 1, 2, colCount);
    sheet.getRow(2).height = 6;
    fillRow(sheet, 2, 1, colCount, C.brand);

    // Row 3 — subtitle / meta
    sheet.mergeCells(3, 1, 3, colCount);
    const sub = sheet.getCell(3, 1);
    sub.value = subtitle;
    sub.font = {
        name: "Calibri",
        size: 10,
        color: { argb: C.muted },
        italic: true,
    };
    sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sheet.getRow(3).height = 24;
    fillRow(sheet, 3, 1, colCount, C.brandMist);

    // Row 4 — spacer air
    sheet.getRow(4).height = 10;
    fillRow(sheet, 4, 1, colCount, C.canvas);

    // Row 5 — column headers (group-colored)
    const headerRow = 5;
    sheet.getRow(headerRow).height = 28;
    colDefs.forEach((def, i) => {
        const cell = sheet.getRow(headerRow).getCell(i + 1);
        cell.value = def.h;
        cell.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.brandInk },
        };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: def.g || C.brandDeep },
        };
        cell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };
        cell.border = {
            top: { style: "thin", color: { argb: def.g || C.brandDeep } },
            bottom: { style: "medium", color: { argb: C.brand } },
            left: {
                style: def.groupStart ? "medium" : "hair",
                color: { argb: def.groupStart ? "FFFFFFFF" : "40FFFFFF" },
            },
            right: { style: "hair", color: { argb: "40FFFFFF" } },
        };
    });

    return { sheet, headerRow, colCount, colDefs, widths };
};

const statusTone = (raw) => {
    const s = str(raw).toLowerCase();
    if (
        /paid|completed|approved|confirmed|success|active|received/.test(s)
    ) {
        return { bg: C.okBg, fg: C.okFg };
    }
    if (/partial|pending|processing|draft|hold/.test(s)) {
        return { bg: C.warnBg, fg: C.warnFg };
    }
    if (/cancel|refund|fail|void|reject|delete/.test(s)) {
        return { bg: C.badBg, fg: C.badFg };
    }
    return { bg: C.infoBg, fg: C.infoFg };
};

const paintCell = (cell, kind, zebra, _u, groupStart = false) => {
    cell.border = {
        top: { style: "hair", color: { argb: C.line } },
        bottom: { style: "hair", color: { argb: C.line } },
        left: {
            style: groupStart ? "medium" : "hair",
            color: { argb: groupStart ? C.brand : C.line },
        },
        right: { style: "hair", color: { argb: C.line } },
    };

    if (kind === "status") {
        const tone = statusTone(cell.value);
        cell.value = dash(cell.value);
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: tone.bg },
        };
        cell.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: tone.fg },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = borderSoft;
        return;
    }

    const bg = zebra ? C.zebra : C.paper;
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bg },
    };
    cell.font = {
        name: "Calibri",
        size: 10,
        color: { argb: C.ink },
    };

    if (kind === "money") {
        if (cell.value === "" || cell.value == null) cell.value = 0;
        cell.numFmt = '#,##0.00';
        cell.alignment = { vertical: "middle", horizontal: "right" };
    } else if (kind === "qty") {
        if (cell.value === "" || cell.value == null) cell.value = 0;
        cell.numFmt = "#,##0.####";
        cell.alignment = { vertical: "middle", horizontal: "right" };
    } else if (kind === "center") {
        cell.value = dash(cell.value);
        cell.alignment = { vertical: "middle", horizontal: "center" };
    } else {
        cell.value = dash(cell.value);
        cell.alignment = {
            vertical: "middle",
            horizontal: "left",
            indent: 1,
        };
    }
};

const appendDataRow = (sheet, rowNum, colDefs, values, zebra) => {
    const row = sheet.getRow(rowNum);
    row.height = 24;
    let vi = 0;
    colDefs.forEach((def, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[vi++];
        paintCell(cell, def.k, zebra, false, !!def.groupStart);
    });
};

const appendTotalsRow = (sheet, rowNum, colDefs, values) => {
    const row = sheet.getRow(rowNum);
    row.height = 26;
    let vi = 0;
    colDefs.forEach((def, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[vi++];
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
        cell.border = {
            top: { style: "medium", color: { argb: C.brand } },
            bottom: { style: "medium", color: { argb: C.brandDeep } },
            left: { style: "hair", color: { argb: C.line } },
            right: { style: "hair", color: { argb: C.line } },
        };
        if (def.k === "money") {
            if (cell.value === "" || cell.value == null) cell.value = 0;
            cell.numFmt = '#,##0.00';
            cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (def.k === "qty") {
            if (cell.value === "" || cell.value == null) cell.value = 0;
            cell.numFmt = "#,##0.####";
            cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (def.k === "center" || def.k === "status") {
            cell.alignment = { vertical: "middle", horizontal: "center" };
        } else {
            cell.alignment = {
                vertical: "middle",
                horizontal: "left",
                indent: 1,
            };
        }
    });
};

const freezeFilter = (sheet, headerRow, colCount, lastDataRow) => {
    sheet.views = [
        {
            state: "frozen",
            ySplit: headerRow,
            showGridLines: false,
            activeCell: "A6",
        },
    ];
    if (lastDataRow >= headerRow) {
        sheet.autoFilter = {
            from: { row: headerRow, column: 1 },
            to: { row: lastDataRow, column: colCount },
        };
    }
};

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
        filterLines.status ? `Status ${filterLines.status}` : null,
        filterLines.dateFrom || filterLines.dateTo
            ? `${filterLines.dateFrom || "…"} → ${filterLines.dateTo || "…"}`
            : null,
        filterLines.search ? `"${filterLines.search}"` : null,
        filterLines.trash ? "Trash" : null,
    ]
        .filter(Boolean)
        .join("   ·   ");

    let totalSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalItems = 0;
    let totalShipping = 0;
    let totalOther = 0;
    let totalSubtotal = 0;

    // ── Sales Orders ─────────────────────────────────────
    const soDefs = [
        // Order
        { h: "Order No.", k: "text", w: 15, g: C.gOrder, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gOrder },
        { h: "Status", k: "status", w: 14, g: C.gOrder },
        { h: "Type", k: "center", w: 11, g: C.gOrder },
        // Customer
        { h: "Customer", k: "text", w: 24, g: C.gCustomer, groupStart: true },
        { h: "Phone", k: "center", w: 14, g: C.gCustomer },
        { h: "Email", k: "text", w: 22, g: C.gCustomer },
        // Place
        { h: "Branch", k: "text", w: 15, g: C.gPlace, groupStart: true },
        { h: "Warehouse", k: "text", w: 14, g: C.gPlace },
        // Payment
        { h: "Pay Status", k: "status", w: 13, g: C.gPay, groupStart: true },
        { h: "Method", k: "center", w: 13, g: C.gPay },
        // Money
        { h: "Subtotal", k: "money", w: 13, g: C.gMoney, groupStart: true },
        { h: "Discount", k: "money", w: 11, g: C.gMoney },
        { h: "Tax", k: "money", w: 10, g: C.gMoney },
        { h: "Shipping", k: "money", w: 11, g: C.gMoney },
        { h: "Other", k: "money", w: 10, g: C.gMoney },
        { h: "Grand Total", k: "money", w: 13, g: C.gMoney },
        { h: "Paid", k: "money", w: 12, g: C.gMoney },
        { h: "Due", k: "money", w: 11, g: C.gMoney },
        // Meta
        { h: "Reference", k: "text", w: 15, g: C.gMeta, groupStart: true },
        { h: "Created By", k: "text", w: 16, g: C.gMeta },
        { h: "Items", k: "qty", w: 8, g: C.gMeta },
    ];

    const so = buildSheetChrome(
        workbook,
        "Sales Orders",
        C.brandDeep,
        soDefs,
        "  Lowkia ERP   ·   Sales Orders",
        `  ${fmtDateTime(exportedAt)}    ·    ${exportedBy}${
            filterHint ? "    ·    " + filterHint : ""
        }    ·    ${orders.length} order(s)`
    );

    let r = so.headerRow;
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

        r += 1;
        appendDataRow(
            so.sheet,
            r,
            soDefs,
            [
                str(o.orderNumber),
                fmtDate(o.orderDate),
                str(o.status),
                str(o.salesType),
                str(o.customerName) ||
                    refName(o.customerId, ["name", "companyName"]),
                str(o.customerPhone) || refName(o.customerId, ["phone"]),
                str(o.customerEmail) || refName(o.customerId, ["email"]),
                refName(o.branchId, ["name", "code", "branchCode"]),
                refName(o.warehouseId, [
                    "warehouseName",
                    "warehouseCode",
                    "name",
                ]),
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
            ],
            i % 2 === 1
        );
    });

    // Air before totals
    r += 1;
    so.sheet.getRow(r).height = 8;
    fillRow(so.sheet, r, 1, so.colCount, C.canvas);

    r += 1;
    appendTotalsRow(so.sheet, r, soDefs, [
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
    ]);
    freezeFilter(so.sheet, so.headerRow, so.colCount, r - 2);

    // ── Order Items ───────────────────────────────────────
    const itemDefs = [
        { h: "Order No.", k: "text", w: 15, g: C.gOrder, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gOrder },
        { h: "Product", k: "text", w: 30, g: C.gCustomer, groupStart: true },
        { h: "SKU", k: "text", w: 14, g: C.gCustomer },
        { h: "Variant", k: "text", w: 16, g: C.gCustomer },
        { h: "Qty", k: "qty", w: 9, g: C.gMoney, groupStart: true },
        { h: "Unit Price", k: "money", w: 12, g: C.gMoney },
        { h: "Discount", k: "money", w: 11, g: C.gMoney },
        { h: "Tax", k: "money", w: 10, g: C.gMoney },
        { h: "Line Total", k: "money", w: 12, g: C.gMoney },
        { h: "Tracking", k: "center", w: 12, g: C.gMeta, groupStart: true },
        { h: "IMEIs", k: "text", w: 28, g: C.gMeta },
        { h: "Stock WH", k: "text", w: 14, g: C.gMeta },
    ];

    const items = buildSheetChrome(
        workbook,
        "Order Items",
        "FF0369A1",
        itemDefs,
        "  Lowkia ERP   ·   Order Line Items",
        `  One row per product line    ·    IMEIs joined when multiple    ·    ${fmtDateTime(exportedAt)}`
    );

    let ir = items.headerRow;
    let itemLineCount = 0;
    let itemQtySum = 0;
    let itemTotalSum = 0;
    let zi = 0;

    for (const o of orders) {
        const lines = Array.isArray(o.items) ? o.items : [];
        if (lines.length === 0) {
            ir += 1;
            appendDataRow(
                items.sheet,
                ir,
                itemDefs,
                [
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
                ],
                zi++ % 2 === 1
            );
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
            ir += 1;
            appendDataRow(
                items.sheet,
                ir,
                itemDefs,
                [
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
                ],
                zi++ % 2 === 1
            );
        }
    }

    ir += 1;
    items.sheet.getRow(ir).height = 8;
    fillRow(items.sheet, ir, 1, items.colCount, C.canvas);
    ir += 1;
    appendTotalsRow(items.sheet, ir, itemDefs, [
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
    ]);
    freezeFilter(items.sheet, items.headerRow, items.colCount, ir - 2);

    // ── Payments ──────────────────────────────────────────
    const payDefs = [
        { h: "Order No.", k: "text", w: 15, g: C.gOrder, groupStart: true },
        { h: "Payment No.", k: "text", w: 17, g: C.gPay, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gPay },
        { h: "Method", k: "center", w: 13, g: C.gPay },
        { h: "Reference", k: "text", w: 20, g: C.gPay },
        { h: "Amount", k: "money", w: 14, g: C.gMoney, groupStart: true },
        { h: "Status", k: "status", w: 12, g: C.gMoney },
    ];

    const pays = buildSheetChrome(
        workbook,
        "Payments",
        "FF047857",
        payDefs,
        "  Lowkia ERP   ·   Payments",
        `  Ledger payments for exported sales orders    ·    ${fmtDateTime(exportedAt)}`
    );

    const orderNumById = new Map(
        orders.map((o) => [String(o._id), str(o.orderNumber)])
    );

    let pr = pays.headerRow;
    let payAmountSum = 0;
    payments.forEach((p, i) => {
        const soId = p.salesOrderId
            ? String(p.salesOrderId._id || p.salesOrderId)
            : p.referenceId
              ? String(p.referenceId)
              : "";
        payAmountSum += num(p.amount);
        pr += 1;
        appendDataRow(
            pays.sheet,
            pr,
            payDefs,
            [
                orderNumById.get(soId) || "",
                str(p.paymentNumber),
                fmtDate(p.paymentDate),
                str(p.paymentMethod),
                str(p.paymentMethodReference || p.providerReference || ""),
                num(p.amount),
                str(p.status),
            ],
            i % 2 === 1
        );
    });

    pr += 1;
    pays.sheet.getRow(pr).height = 8;
    fillRow(pays.sheet, pr, 1, pays.colCount, C.canvas);
    pr += 1;
    appendTotalsRow(pays.sheet, pr, payDefs, [
        "TOTALS",
        `${payments.length} payments`,
        "",
        "",
        "",
        payAmountSum,
        "",
    ]);
    freezeFilter(
        pays.sheet,
        pays.headerRow,
        pays.colCount,
        Math.max(pays.headerRow, pr - 2)
    );

    // ── Summary (card layout) ─────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 26, 3, 22, 3, 18, 3, 18, 3]);

    // Full-bleed title across used cols
    sum.mergeCells(1, 1, 1, 9);
    const st = sum.getCell(1, 1);
    st.value = "  Lowkia ERP   ·   Export Summary";
    st.font = {
        name: "Calibri",
        size: 18,
        bold: true,
        color: { argb: C.brandInk },
    };
    st.alignment = { vertical: "middle", horizontal: "left" };
    sum.getRow(1).height = 36;
    fillRow(sum, 1, 1, 9, C.brandDeep);

    sum.getRow(2).height = 6;
    fillRow(sum, 2, 1, 9, C.brand);

    sum.mergeCells(3, 1, 3, 9);
    sum.getCell(3, 1).value = `  Generated ${fmtDateTime(exportedAt)}    ·    ${exportedBy}`;
    sum.getCell(3, 1).font = {
        name: "Calibri",
        size: 10,
        italic: true,
        color: { argb: C.muted },
    };
    sum.getCell(3, 1).alignment = { vertical: "middle", indent: 1 };
    sum.getRow(3).height = 24;
    fillRow(sum, 3, 1, 9, C.brandMist);

    sum.getRow(4).height = 14;

    const card = (row, col, label, value, money = false) => {
        const a = sum.getCell(row, col);
        const b = sum.getCell(row + 1, col);
        a.value = label;
        a.font = {
            name: "Calibri",
            size: 9,
            bold: true,
            color: { argb: C.softMuted },
        };
        a.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.brandMist },
        };
        a.alignment = { horizontal: "center", vertical: "middle" };
        a.border = borderSoft;
        b.value = value;
        b.font = {
            name: "Calibri",
            size: 16,
            bold: true,
            color: { argb: C.brandDeep },
        };
        b.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.paper },
        };
        b.alignment = { horizontal: "center", vertical: "middle" };
        b.border = borderSoft;
        if (money) b.numFmt = '#,##0.00';
        sum.getRow(row).height = 18;
        sum.getRow(row + 1).height = 32;
    };

    card(5, 2, "ORDERS", orders.length);
    card(5, 4, "LINE ITEMS", totalItems);
    card(5, 6, "PAYMENTS", payments.length);
    card(5, 8, "GRAND TOTAL", totalSales, true);

    const section = (row, label) => {
        sum.mergeCells(row, 2, row, 8);
        const c = sum.getCell(row, 2);
        c.value = `  ${label}`;
        c.font = {
            name: "Calibri",
            size: 11,
            bold: true,
            color: { argb: C.ink },
        };
        c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.zebra },
        };
        c.alignment = { vertical: "middle" };
        sum.getRow(row).height = 26;
        // paint side spacers
        [1, 3, 5, 7, 9].forEach((sc) => {
            sum.getCell(row, sc).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: C.canvas },
            };
        });
        return row + 1;
    };

    const kv = (row, label, value, money = false) => {
        const a = sum.getCell(row, 2);
        const b = sum.getCell(row, 4);
        sum.mergeCells(row, 4, row, 8);
        a.value = label;
        a.font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.muted },
        };
        a.alignment = { vertical: "middle", indent: 1 };
        a.border = borderHair;
        a.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.paper },
        };
        b.value = value;
        b.font = { name: "Calibri", size: 10, color: { argb: C.ink } };
        b.alignment = {
            vertical: "middle",
            horizontal: money ? "right" : "left",
            indent: money ? 0 : 1,
        };
        b.border = borderHair;
        b.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.paper },
        };
        if (money) b.numFmt = '#,##0.00';
        sum.getRow(row).height = 22;
        return row + 1;
    };

    let sr = 9;
    sr = section(sr, "FILTERS");
    sr = kv(sr, "Trash mode", filterLines.trash ? "Yes" : "No");
    sr = kv(sr, "Search", str(filterLines.search || "—"));
    sr = kv(sr, "Status", str(filterLines.status || "All"));
    sr = kv(sr, "Date from", str(filterLines.dateFrom || "—"));
    sr = kv(sr, "Date to", str(filterLines.dateTo || "—"));
    sr = kv(sr, "Sort", str(filterLines.sort || "newest"));
    sr += 1;
    sr = section(sr, "FINANCIALS (stored Sales Order values)");
    sr = kv(sr, "Subtotal", totalSubtotal, true);
    sr = kv(sr, "Discount", totalDiscount, true);
    sr = kv(sr, "Tax", totalTax, true);
    sr = kv(sr, "Shipping", totalShipping, true);
    sr = kv(sr, "Other charges", totalOther, true);
    sr = kv(sr, "Grand total", totalSales, true);
    sr = kv(sr, "Paid", totalPaid, true);
    sr = kv(sr, "Due", totalDue, true);
    sr = kv(sr, "Payment ledger sum", payAmountSum, true);

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
