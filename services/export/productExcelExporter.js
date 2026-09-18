const ExcelJS = require("exceljs");

const MAX_EXPORT_PRODUCTS = 25000;

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

const buildProductWorkbook = async ({
    products = [],
    variants = [],
    meta = {},
} = {}) => {
    if (products.length > MAX_EXPORT_PRODUCTS) {
        const err = new Error(
            `Export limited to ${MAX_EXPORT_PRODUCTS} products. Narrow your filters.`
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
        filterLines.approvalStatus
            ? `Approval ${filterLines.approvalStatus}`
            : null,
        filterLines.categoryId ? `Category filter` : null,
        filterLines.brandId ? `Brand filter` : null,
        filterLines.lowStock ? "Low stock" : null,
        filterLines.search ? `"${filterLines.search}"` : null,
        filterLines.trash ? "Trash" : null,
    ]
        .filter(Boolean)
        .join("   ·   ");

    const productById = new Map(
        products.map((p) => [String(p._id), p])
    );

    let sumTotalStock = 0;
    let sumAvailable = 0;
    let sumReserved = 0;
    let sumStockValue = 0;
    let sumImeiCount = 0;
    let sumSoldQty = 0;
    let lowStockCount = 0;

    // ── Products ──────────────────────────────────────────
    const prodDefs = [
        {
            h: "Product Code",
            k: "text",
            w: 14,
            g: C.gProduct,
            groupStart: true,
        },
        { h: "Name", k: "text", w: 28, g: C.gProduct },
        { h: "SKU", k: "text", w: 14, g: C.gProduct },
        { h: "Barcode", k: "text", w: 16, g: C.gProduct },
        { h: "Tracking", k: "center", w: 11, g: C.gProduct },
        { h: "Product Type", k: "center", w: 12, g: C.gProduct },
        { h: "Has Variants", k: "center", w: 11, g: C.gProduct },
        {
            h: "Category",
            k: "text",
            w: 16,
            g: C.gCatalog,
            groupStart: true,
        },
        { h: "Subcategory", k: "text", w: 16, g: C.gCatalog },
        { h: "Brand", k: "text", w: 14, g: C.gCatalog },
        { h: "Unit", k: "text", w: 10, g: C.gCatalog },
        {
            h: "Status",
            k: "status",
            w: 11,
            g: C.gStatus,
            groupStart: true,
        },
        { h: "Approval", k: "status", w: 12, g: C.gStatus },
        { h: "Published", k: "center", w: 10, g: C.gStatus },
        {
            h: "Purchase Price",
            k: "money",
            w: 13,
            g: C.gMoney,
            groupStart: true,
        },
        { h: "Cost Price", k: "money", w: 12, g: C.gMoney },
        { h: "Selling Price", k: "money", w: 12, g: C.gMoney },
        { h: "Wholesale", k: "money", w: 11, g: C.gMoney },
        { h: "Offer", k: "money", w: 11, g: C.gMoney },
        { h: "Gross Profit", k: "money", w: 12, g: C.gMoney },
        { h: "Margin %", k: "pct", w: 10, g: C.gMoney },
        {
            h: "Total Stock",
            k: "qty",
            w: 11,
            g: C.gStock,
            groupStart: true,
        },
        { h: "Available", k: "qty", w: 11, g: C.gStock },
        { h: "Reserved", k: "qty", w: 10, g: C.gStock },
        { h: "Stock Value", k: "money", w: 13, g: C.gStock },
        { h: "IMEI Count", k: "qty", w: 11, g: C.gStock },
        { h: "Low Stock", k: "status", w: 11, g: C.gStock },
        { h: "Reorder Level", k: "qty", w: 12, g: C.gStock },
        {
            h: "Sold Qty",
            k: "qty",
            w: 10,
            g: C.gMeta,
            groupStart: true,
        },
        { h: "Source Type", k: "center", w: 13, g: C.gMeta },
        { h: "Created At", k: "center", w: 12, g: C.gMeta },
    ];

    const prod = buildSheetChrome(
        workbook,
        "Products",
        C.brandDeep,
        prodDefs,
        "  Lowkia ERP   ·   Products",
        `  ${fmtDateTime(exportedAt)}    ·    ${exportedBy}${
            filterHint ? "    ·    " + filterHint : ""
        }    ·    ${products.length} product(s)`
    );

    let r = prod.headerRow;
    products.forEach((p, i) => {
        const totalStock = num(p.totalStock);
        const available = num(p.availableStock);
        const reserved = num(p.reservedStock);
        const stockValue = num(p.stockValue);
        const imeiCount = num(p.totalImeiCount);
        const soldQty = num(p.soldQty);

        sumTotalStock += totalStock;
        sumAvailable += available;
        sumReserved += reserved;
        sumStockValue += stockValue;
        sumImeiCount += imeiCount;
        sumSoldQty += soldQty;
        if (p.isLowStock) lowStockCount += 1;

        r += 1;
        appendDataRow(
            prod.sheet,
            r,
            prodDefs,
            [
                str(p.productCode),
                str(p.name),
                str(p.sku),
                str(p.barcode),
                str(p.trackingType),
                str(p.productType),
                yesNo(p.hasVariants),
                refName(p.proCategoryId, ["name"]),
                refName(p.proSubCategoryId, ["name"]),
                refName(p.proBrandId, ["name"]),
                refName(p.unitId, ["name", "shortName"]),
                str(p.status),
                str(p.approvalStatus),
                yesNo(p.isPublished),
                num(p.purchasePrice),
                num(p.costPrice),
                num(p.sellingPrice),
                num(p.wholesalePrice),
                num(p.offerPrice),
                num(p.grossProfit),
                num(p.profitMarginPercent),
                totalStock,
                available,
                reserved,
                stockValue,
                imeiCount,
                p.isLowStock ? "Low" : "OK",
                num(p.reorderLevel),
                soldQty,
                str(p.productSourceType),
                fmtDate(p.createdAt),
            ],
            i % 2 === 1
        );
    });

    r += 1;
    prod.sheet.getRow(r).height = 8;
    fillRow(prod.sheet, r, 1, prod.colCount, C.canvas);

    r += 1;
    appendTotalsRow(prod.sheet, r, prodDefs, [
        "TOTALS",
        `${products.length} products`,
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
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        sumTotalStock,
        sumAvailable,
        sumReserved,
        sumStockValue,
        sumImeiCount,
        `${lowStockCount} low`,
        "",
        sumSoldQty,
        "",
        "",
    ]);
    freezeFilter(prod.sheet, prod.headerRow, prod.colCount, r - 2);

    // ── Variants ──────────────────────────────────────────
    const varDefs = [
        {
            h: "Product Code",
            k: "text",
            w: 14,
            g: C.gProduct,
            groupStart: true,
        },
        { h: "Product Name", k: "text", w: 26, g: C.gProduct },
        { h: "Combination", k: "text", w: 20, g: C.gProduct },
        { h: "SKU", k: "text", w: 14, g: C.gCatalog, groupStart: true },
        { h: "Barcode", k: "text", w: 16, g: C.gCatalog },
        { h: "Qty", k: "qty", w: 9, g: C.gStock, groupStart: true },
        {
            h: "Purchase",
            k: "money",
            w: 12,
            g: C.gMoney,
            groupStart: true,
        },
        { h: "Cost", k: "money", w: 11, g: C.gMoney },
        { h: "Selling", k: "money", w: 11, g: C.gMoney },
        { h: "Wholesale", k: "money", w: 11, g: C.gMoney },
        { h: "Offer", k: "money", w: 11, g: C.gMoney },
        { h: "Status", k: "status", w: 13, g: C.gStatus, groupStart: true },
        { h: "Default", k: "center", w: 9, g: C.gStatus },
    ];

    const vars = buildSheetChrome(
        workbook,
        "Variants",
        "FF0369A1",
        varDefs,
        "  Lowkia ERP   ·   Product Variants",
        `  One row per variant    ·    ${variants.length} variant(s)    ·    ${fmtDateTime(exportedAt)}`
    );

    let vr = vars.headerRow;
    let varQtySum = 0;
    variants.forEach((v, i) => {
        const pid = String(v.productId?._id || v.productId || "");
        const parent = productById.get(pid);
        const qty = num(v.quantity);
        varQtySum += qty;

        vr += 1;
        appendDataRow(
            vars.sheet,
            vr,
            varDefs,
            [
                parent ? str(parent.productCode) : "",
                parent ? str(parent.name) : "",
                str(v.combinationString),
                str(v.sku),
                str(v.barcode),
                qty,
                num(v.purchasePrice),
                num(v.costPrice),
                num(v.sellingPrice),
                num(v.wholesalePrice),
                num(v.offerPrice),
                str(v.status),
                yesNo(v.isDefaultVariant),
            ],
            i % 2 === 1
        );
    });

    vr += 1;
    vars.sheet.getRow(vr).height = 8;
    fillRow(vars.sheet, vr, 1, vars.colCount, C.canvas);
    vr += 1;
    appendTotalsRow(vars.sheet, vr, varDefs, [
        "TOTALS",
        `${variants.length} variants`,
        "",
        "",
        "",
        varQtySum,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ]);
    freezeFilter(vars.sheet, vars.headerRow, vars.colCount, vr - 2);

    // ── Warehouse Stock ───────────────────────────────────
    const whDefs = [
        {
            h: "Product Code",
            k: "text",
            w: 14,
            g: C.gProduct,
            groupStart: true,
        },
        { h: "Product Name", k: "text", w: 26, g: C.gProduct },
        {
            h: "Warehouse Code",
            k: "text",
            w: 15,
            g: C.gStock,
            groupStart: true,
        },
        { h: "Warehouse Name", k: "text", w: 20, g: C.gStock },
        { h: "Qty", k: "qty", w: 10, g: C.gStock, groupStart: true },
        { h: "Available", k: "qty", w: 11, g: C.gStock },
        { h: "Reserved", k: "qty", w: 10, g: C.gStock },
    ];

    const wh = buildSheetChrome(
        workbook,
        "Warehouse Stock",
        "FF4338CA",
        whDefs,
        "  Lowkia ERP   ·   Warehouse Stock",
        `  Per-warehouse breakdown    ·    ${fmtDateTime(exportedAt)}`
    );

    let wr = wh.headerRow;
    let whRowCount = 0;
    let whQtySum = 0;
    let whAvailSum = 0;
    let whResSum = 0;
    let wz = 0;

    for (const p of products) {
        const rows = Array.isArray(p.warehouseStock) ? p.warehouseStock : [];
        if (rows.length === 0) continue;
        for (const row of rows) {
            whRowCount += 1;
            const qty = num(row.quantity);
            const avail = num(row.availableQuantity);
            const res = num(row.reservedQuantity);
            whQtySum += qty;
            whAvailSum += avail;
            whResSum += res;

            wr += 1;
            appendDataRow(
                wh.sheet,
                wr,
                whDefs,
                [
                    str(p.productCode),
                    str(p.name),
                    refName(row.warehouseId, ["warehouseCode", "code"]),
                    refName(row.warehouseId, [
                        "warehouseName",
                        "name",
                    ]),
                    qty,
                    avail,
                    res,
                ],
                wz++ % 2 === 1
            );
        }
    }

    wr += 1;
    wh.sheet.getRow(wr).height = 8;
    fillRow(wh.sheet, wr, 1, wh.colCount, C.canvas);
    wr += 1;
    appendTotalsRow(wh.sheet, wr, whDefs, [
        "TOTALS",
        `${whRowCount} rows`,
        "",
        "",
        whQtySum,
        whAvailSum,
        whResSum,
    ]);
    freezeFilter(
        wh.sheet,
        wh.headerRow,
        wh.colCount,
        Math.max(wh.headerRow, wr - 2)
    );

    // ── Export Summary ────────────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 26, 3, 22, 3, 18, 3, 18, 3]);

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
        if (money) b.numFmt = "#,##0.00";
        sum.getRow(row).height = 18;
        sum.getRow(row + 1).height = 32;
    };

    card(5, 2, "PRODUCTS", products.length);
    card(5, 4, "VARIANTS", variants.length);
    card(5, 6, "LOW STOCK", lowStockCount);
    card(5, 8, "STOCK VALUE", sumStockValue, true);

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
        if (money) b.numFmt = "#,##0.00";
        sum.getRow(row).height = 22;
        return row + 1;
    };

    let sr = 9;
    sr = section(sr, "FILTERS");
    sr = kv(sr, "Trash mode", filterLines.trash ? "Yes" : "No");
    sr = kv(sr, "Search", str(filterLines.search || "—"));
    sr = kv(sr, "Status", str(filterLines.status || "All"));
    sr = kv(
        sr,
        "Approval",
        str(filterLines.approvalStatus || "All")
    );
    sr = kv(
        sr,
        "Category",
        str(filterLines.categoryId || filterLines.category || "All")
    );
    sr = kv(
        sr,
        "Brand",
        str(filterLines.brandId || filterLines.brand || "All")
    );
    sr = kv(
        sr,
        "Tracking",
        str(filterLines.trackingType || "All")
    );
    sr = kv(
        sr,
        "Low stock only",
        filterLines.lowStock ? "Yes" : "No"
    );
    sr = kv(sr, "Sort", str(filterLines.sort || filterLines.sortBy || "newest"));
    sr += 1;
    sr = section(sr, "INVENTORY KPIs");
    sr = kv(sr, "Product count", products.length);
    sr = kv(sr, "Variant count", variants.length);
    sr = kv(sr, "Low stock count", lowStockCount);
    sr = kv(sr, "Total stock (units)", sumTotalStock);
    sr = kv(sr, "Available stock (units)", sumAvailable);
    sr = kv(sr, "Reserved stock (units)", sumReserved);
    sr = kv(sr, "Stock value (sum)", sumStockValue, true);
    sr = kv(sr, "IMEI count (sum)", sumImeiCount);
    sr = kv(sr, "Sold qty (sum)", sumSoldQty);
    sr = kv(sr, "Warehouse stock rows", whRowCount);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const from = str(query.dateFrom || query.fromDate || query.startDate);
    const to = str(query.dateTo || query.toDate || query.endDate);
    const today = fmtDate(new Date());
    if (from && to) return `products_${from}_to_${to}.xlsx`;
    if (from) return `products_from_${from}.xlsx`;
    if (to) return `products_to_${to}.xlsx`;
    return `products_${today}.xlsx`;
};

module.exports = {
    buildProductWorkbook,
    buildExportFilename,
    MAX_EXPORT_PRODUCTS,
};
