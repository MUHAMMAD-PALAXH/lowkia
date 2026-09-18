const ExcelJS = require("exceljs");

const MAX_EXPORT_PURCHASE_ORDERS = 25000;

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

    brand: "FF0D9488",
    brandDeep: "FF0F766E",
    brandInk: "FFFFFFFF",
    brandMist: "FFF0FDFA",
    brandWash: "FFCCFBF1",

    gProduct: "FF0F766E",
    gCatalog: "FF0369A1",
    gStatus: "FFB45309",
    gMoney: "FF047857",
    gStock: "FF4338CA",
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
    totalFg: "FF134E4A",
};

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

const yesNo = (v) => (v ? "Yes" : "No");

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

    sheet.mergeCells(2, 1, 2, colCount);
    sheet.getRow(2).height = 6;
    fillRow(sheet, 2, 1, colCount, C.brand);

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

    sheet.getRow(4).height = 10;
    fillRow(sheet, 4, 1, colCount, C.canvas);

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
        /paid|completed|approved|confirmed|success|active|received|^ok$|in stock/.test(
            s
        )
    ) {
        return { bg: C.okBg, fg: C.okFg };
    }
    if (/partial|pending|processing|draft|hold|low|out of stock/.test(s)) {
        return { bg: C.warnBg, fg: C.warnFg };
    }
    if (/cancel|refund|fail|void|reject|delete|inactive|archived|discontinued/.test(
        s
    )) {
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
        cell.numFmt = "#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
    } else if (kind === "qty") {
        if (cell.value === "" || cell.value == null) cell.value = 0;
        cell.numFmt = "#,##0.####";
        cell.alignment = { vertical: "middle", horizontal: "right" };
    } else if (kind === "pct") {
        if (cell.value === "" || cell.value == null) cell.value = 0;
        cell.numFmt = '0.00"%"';
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
            cell.numFmt = "#,##0.00";
            cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (def.k === "qty") {
            if (cell.value === "" || cell.value == null) cell.value = 0;
            cell.numFmt = "#,##0.####";
            cell.alignment = { vertical: "middle", horizontal: "right" };
        } else if (def.k === "pct") {
            if (cell.value === "" || cell.value == null) cell.value = 0;
            cell.numFmt = '0.00"%"';
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

const supplierLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.name || ref.companyName || ref.supplierCode || "");
};

const warehouseLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.warehouseName || ref.name || ref.warehouseCode || "");
};

const branchLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.name || ref.branchCode || ref.code || "");
};

const userLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.name || ref.email || "");
};

const buildPurchaseOrderWorkbook = async ({ orders = [], meta = {} } = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Lowkia ERP";
    workbook.created = new Date();
    workbook.modified = new Date();

    const exportedAt = meta.exportedAt || new Date();
    const exportedBy = str(meta.exportedBy) || "System";
    const filterLines = meta.filters || {};

    // ── Purchase Orders ───────────────────────────────────
    const poDefs = [
        { h: "PO No.", k: "text", w: 15, g: C.gProduct, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gMeta },
        { h: "Expected", k: "center", w: 12, g: C.gMeta },
        { h: "Status", k: "status", w: 16, g: C.gStatus, groupStart: true },
        { h: "Type", k: "center", w: 11, g: C.gCatalog, groupStart: true },
        { h: "Supplier", k: "text", w: 22, g: C.gCatalog, groupStart: true },
        { h: "Phone", k: "text", w: 14, g: C.gCatalog },
        { h: "Branch", k: "text", w: 16, g: C.gStock, groupStart: true },
        { h: "Warehouse", k: "text", w: 16, g: C.gStock },
        { h: "Pay Status", k: "status", w: 12, g: C.gMoney, groupStart: true },
        { h: "Terms", k: "center", w: 12, g: C.gMoney },
        { h: "Subtotal", k: "money", w: 12, g: C.gMoney, groupStart: true },
        { h: "Discount", k: "money", w: 11, g: C.gMoney },
        { h: "Tax", k: "money", w: 10, g: C.gMoney },
        { h: "Shipping", k: "money", w: 11, g: C.gMoney },
        { h: "Other", k: "money", w: 10, g: C.gMoney },
        { h: "Grand Total", k: "money", w: 13, g: C.gMoney },
        { h: "Paid", k: "money", w: 11, g: C.gMoney },
        { h: "Due", k: "money", w: 11, g: C.gMoney },
        { h: "Items", k: "qty", w: 8, g: C.gMeta, groupStart: true },
        { h: "Reference", k: "text", w: 14, g: C.gMeta },
        { h: "Supplier Acc.", k: "center", w: 14, g: C.gStatus, groupStart: true },
        { h: "Created By", k: "text", w: 16, g: C.gMeta, groupStart: true },
    ];

    const poSheet = buildSheetChrome(
        workbook,
        "Purchase Orders",
        "FF0D9488",
        poDefs,
        "  Lowkia ERP   ·   Purchase Orders",
        `  Supplier orders overview    ·    ${fmtDateTime(exportedAt)}`
    );

    let pr = poSheet.headerRow;
    let pz = 0;
    let sumSub = 0;
    let sumDisc = 0;
    let sumTax = 0;
    let sumShip = 0;
    let sumOther = 0;
    let sumGrand = 0;
    let sumPaid = 0;
    let sumDue = 0;
    let sumItems = 0;
    const statusCounts = {};

    for (const o of orders) {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemCount = items.reduce((n, it) => n + (num(it.quantity) || 0), 0);
        const sub = num(o.subtotal);
        const disc = num(o.discount);
        const tax = num(o.tax);
        const ship = num(o.shippingCost);
        const other = num(o.otherCharges);
        const grand = num(o.grandTotal);
        const paid = num(o.paidAmount);
        const due = num(o.dueAmount);
        sumSub += sub;
        sumDisc += disc;
        sumTax += tax;
        sumShip += ship;
        sumOther += other;
        sumGrand += grand;
        sumPaid += paid;
        sumDue += due;
        sumItems += itemCount;
        const st = str(o.status) || "Unknown";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
        const supplier = o.supplierId || {};

        pr += 1;
        appendDataRow(
            poSheet.sheet,
            pr,
            poDefs,
            [
                str(o.purchaseOrderNo),
                fmtDate(o.orderDate || o.createdAt),
                fmtDate(o.expectedDeliveryDate),
                str(o.status),
                str(o.purchaseType),
                supplierLabel(supplier),
                str(supplier.phone),
                branchLabel(o.branchId),
                warehouseLabel(o.warehouseId),
                str(o.paymentStatus),
                str(o.paymentTerms),
                sub,
                disc,
                tax,
                ship,
                other,
                grand,
                paid,
                due,
                itemCount,
                str(o.referenceNo),
                str(o.supplierAcceptanceStatus),
                userLabel(o.createdBy),
            ],
            pz++ % 2 === 1
        );
    }

    pr += 1;
    poSheet.sheet.getRow(pr).height = 8;
    fillRow(poSheet.sheet, pr, 1, poSheet.colCount, C.canvas);
    pr += 1;
    appendTotalsRow(poSheet.sheet, pr, poDefs, [
        "TOTALS",
        `${orders.length} POs`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        sumSub,
        sumDisc,
        sumTax,
        sumShip,
        sumOther,
        sumGrand,
        sumPaid,
        sumDue,
        sumItems,
        "",
        "",
        "",
    ]);
    freezeFilter(
        poSheet.sheet,
        poSheet.headerRow,
        poSheet.colCount,
        Math.max(poSheet.headerRow, pr - 2)
    );

    // ── Line Items ────────────────────────────────────────
    const itemDefs = [
        { h: "PO No.", k: "text", w: 15, g: C.gProduct, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gMeta },
        { h: "Status", k: "status", w: 14, g: C.gStatus, groupStart: true },
        { h: "Supplier", k: "text", w: 20, g: C.gCatalog, groupStart: true },
        { h: "Product", k: "text", w: 26, g: C.gCatalog, groupStart: true },
        { h: "SKU", k: "text", w: 14, g: C.gCatalog },
        { h: "Variant", k: "text", w: 16, g: C.gCatalog },
        { h: "Tracking", k: "center", w: 11, g: C.gCatalog },
        { h: "Qty", k: "qty", w: 9, g: C.gStock, groupStart: true },
        { h: "Received", k: "qty", w: 10, g: C.gStock },
        { h: "Sent", k: "qty", w: 9, g: C.gStock },
        { h: "Damaged", k: "qty", w: 10, g: C.gStock },
        { h: "Pending", k: "qty", w: 10, g: C.gStock },
        { h: "Unit Price", k: "money", w: 12, g: C.gMoney, groupStart: true },
        { h: "Discount", k: "money", w: 11, g: C.gMoney },
        { h: "Tax", k: "money", w: 10, g: C.gMoney },
        { h: "Line Total", k: "money", w: 12, g: C.gMoney },
        { h: "Remarks", k: "text", w: 20, g: C.gMeta, groupStart: true },
    ];

    const itemSheet = buildSheetChrome(
        workbook,
        "Line Items",
        "FF0369A1",
        itemDefs,
        "  Lowkia ERP   ·   Purchase Order Lines",
        `  Products ordered / received    ·    ${fmtDateTime(exportedAt)}`
    );

    let ir = itemSheet.headerRow;
    let iz = 0;
    let lineQty = 0;
    let lineValue = 0;

    for (const o of orders) {
        const items = Array.isArray(o.items) ? o.items : [];
        for (const it of items) {
            const qty = num(it.quantity);
            const total = num(it.total);
            lineQty += qty;
            lineValue += total;
            ir += 1;
            appendDataRow(
                itemSheet.sheet,
                ir,
                itemDefs,
                [
                    str(o.purchaseOrderNo),
                    fmtDate(o.orderDate || o.createdAt),
                    str(o.status),
                    supplierLabel(o.supplierId),
                    str(it.productName),
                    str(it.sku),
                    str(it.variantLabel),
                    str(it.trackingType),
                    qty,
                    num(it.receivedQuantity),
                    num(it.supplierSentQuantity),
                    num(it.damagedQuantity),
                    num(it.pendingQuantity),
                    num(it.purchasePrice),
                    num(it.discount),
                    num(it.tax),
                    total,
                    str(it.remarks),
                ],
                iz++ % 2 === 1
            );
        }
    }

    ir += 1;
    itemSheet.sheet.getRow(ir).height = 8;
    fillRow(itemSheet.sheet, ir, 1, itemSheet.colCount, C.canvas);
    ir += 1;
    appendTotalsRow(itemSheet.sheet, ir, itemDefs, [
        "TOTALS",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        lineQty,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        lineValue,
        "",
    ]);
    freezeFilter(
        itemSheet.sheet,
        itemSheet.headerRow,
        itemSheet.colCount,
        Math.max(itemSheet.headerRow, ir - 2)
    );

    // ── Export Summary ────────────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 28, 3, 28, 3, 18, 3, 18, 3]);

    sum.mergeCells(1, 1, 1, 9);
    const st = sum.getCell(1, 1);
    st.value = "  Lowkia ERP   ·   Purchase Orders Export Summary";
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
    sum.getCell(3, 1).value =
        `  Generated ${fmtDateTime(exportedAt)}    ·    ${exportedBy}`;
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
            color: { argb: C.ink },
        };
        b.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.paper },
        };
        b.alignment = { horizontal: "center", vertical: "middle" };
        b.border = borderSoft;
        if (money) b.numFmt = "#,##0.00";
        sum.getRow(row).height = 20;
        sum.getRow(row + 1).height = 32;
    };

    card(5, 2, "PURCHASE ORDERS", orders.length);
    card(5, 4, "UNITS ORDERED", sumItems);
    card(5, 6, "GRAND TOTAL", sumGrand, true);
    card(5, 8, "DUE", sumDue, true);

    let kvRow = 9;
    const section = (r, title) => {
        sum.mergeCells(r, 2, r, 8);
        const c = sum.getCell(r, 2);
        c.value = title;
        c.font = {
            name: "Calibri",
            size: 11,
            bold: true,
            color: { argb: C.brandDeep },
        };
        c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: C.brandWash },
        };
        c.alignment = { vertical: "middle", indent: 1 };
        sum.getRow(r).height = 24;
        return r + 1;
    };
    const kv = (r, label, value) => {
        sum.getCell(r, 2).value = label;
        sum.getCell(r, 2).font = {
            name: "Calibri",
            size: 10,
            color: { argb: C.muted },
        };
        sum.getCell(r, 4).value = value == null || value === "" ? "—" : value;
        sum.getCell(r, 4).font = {
            name: "Calibri",
            size: 10,
            bold: true,
            color: { argb: C.ink },
        };
        sum.getRow(r).height = 20;
        return r + 1;
    };

    kvRow = section(kvRow, "FILTERS APPLIED");
    kvRow = kv(kvRow, "Search", str(filterLines.search));
    kvRow = kv(kvRow, "Status", str(filterLines.status));
    kvRow = kv(kvRow, "Type", str(filterLines.purchaseType));
    kvRow = kv(kvRow, "Trash", filterLines.trash ? "Yes" : "No");
    kvRow = kv(
        kvRow,
        "Date range",
        [filterLines.dateFrom, filterLines.dateTo].filter(Boolean).join(" → ")
    );
    kvRow = kv(kvRow, "Sort", str(filterLines.sort || "newest"));
    kvRow += 1;
    kvRow = section(kvRow, "STATUS BREAKDOWN");
    for (const key of Object.keys(statusCounts).sort()) {
        kvRow = kv(kvRow, key, statusCounts[key]);
    }
    kvRow += 1;
    kvRow = section(kvRow, "MONEY");
    kvRow = kv(kvRow, "Subtotal", sumSub);
    kvRow = kv(kvRow, "Discount", sumDisc);
    kvRow = kv(kvRow, "Tax", sumTax);
    kvRow = kv(kvRow, "Paid", sumPaid);
    kvRow = kv(kvRow, "Due", sumDue);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const from = str(query.dateFrom || query.fromDate || query.startDate);
    const to = str(query.dateTo || query.toDate || query.endDate);
    const today = fmtDate(new Date());
    const trash =
        query.deleted === "true" ||
        query.trash === "true" ||
        query.deleted === true;
    if (trash) return `purchase_orders_trash_${today}.xlsx`;
    if (from && to) return `purchase_orders_${from}_to_${to}.xlsx`;
    if (from) return `purchase_orders_from_${from}.xlsx`;
    if (to) return `purchase_orders_to_${to}.xlsx`;
    const status = str(query.status)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    if (status) return `purchase_orders_${status}_${today}.xlsx`;
    return `purchase_orders_${today}.xlsx`;
};

module.exports = {
    buildPurchaseOrderWorkbook,
    buildExportFilename,
    MAX_EXPORT_PURCHASE_ORDERS,
};
