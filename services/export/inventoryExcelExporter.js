const ExcelJS = require("exceljs");

const MAX_EXPORT_INVENTORY = 25000;

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

const movementCustomer = (m) => {
    for (const key of ["salesOrderId", "salesReturnId"]) {
        const ref = m[key];
        if (!ref || typeof ref !== "object") continue;
        if (ref.customerId && typeof ref.customerId === "object") {
            return {
                code: str(ref.customerId.customerCode),
                name: str(ref.customerId.name),
                phone: str(ref.customerId.phone || ref.customerPhone),
            };
        }
        if (ref.customerName || ref.customerPhone) {
            return {
                code: "",
                name: str(ref.customerName),
                phone: str(ref.customerPhone),
            };
        }
    }
    return { code: "", name: "", phone: "" };
};

const buildInventoryWorkbook = async ({
    stockRows = [],
    lowStockRows = [],
    movements = [],
    imeis = [],
    stats = {},
    meta = {},
} = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Lowkia ERP";
    workbook.created = new Date();
    workbook.modified = new Date();

    const exportedAt = meta.exportedAt || new Date();
    const exportedBy = str(meta.exportedBy) || "System";
    const filterLines = meta.filters || {};

    // ── Warehouse Stock ───────────────────────────────────
    const stockDefs = [
        { h: "Product Code", k: "text", w: 14, g: C.gProduct, groupStart: true },
        { h: "Product Name", k: "text", w: 26, g: C.gProduct },
        { h: "SKU", k: "text", w: 14, g: C.gCatalog, groupStart: true },
        { h: "Variant", k: "text", w: 18, g: C.gCatalog },
        { h: "Tracking", k: "center", w: 11, g: C.gCatalog },
        { h: "Source", k: "center", w: 12, g: C.gCatalog },
        { h: "Warehouse Code", k: "text", w: 14, g: C.gStock, groupStart: true },
        { h: "Warehouse Name", k: "text", w: 20, g: C.gStock },
        { h: "Branch", k: "text", w: 16, g: C.gStock },
        { h: "Status", k: "status", w: 13, g: C.gStatus, groupStart: true },
        { h: "On Hand", k: "qty", w: 10, g: C.gStock, groupStart: true },
        { h: "Reserved", k: "qty", w: 10, g: C.gStock },
        { h: "Available", k: "qty", w: 11, g: C.gStock },
        { h: "Reorder", k: "qty", w: 10, g: C.gStock },
        { h: "Avg Cost", k: "money", w: 12, g: C.gMoney, groupStart: true },
        { h: "Value", k: "money", w: 14, g: C.gMoney },
        { h: "Updated", k: "center", w: 12, g: C.gMeta, groupStart: true },
    ];

    const stockSheet = buildSheetChrome(
        workbook,
        "Warehouse Stock",
        "FF0D9488",
        stockDefs,
        "  Lowkia ERP   ·   Warehouse Stock",
        `  Stock balances by warehouse    ·    ${fmtDateTime(exportedAt)}`
    );

    let sr = stockSheet.headerRow;
    let z = 0;
    let sumOnHand = 0;
    let sumReserved = 0;
    let sumAvailable = 0;
    let sumValue = 0;

    for (const row of stockRows) {
        const product = row.productId || {};
        const warehouse = row.warehouseId || {};
        const branch = row.branchId || {};
        const variant = row.productVariantId || {};
        const onHand = num(row.currentStock);
        const reserved = num(row.reservedStock);
        const available = num(row.availableStock);
        const value =
            num(row.inventoryValue) > 0
                ? num(row.inventoryValue)
                : onHand * num(row.averageCost);
        sumOnHand += onHand;
        sumReserved += reserved;
        sumAvailable += available;
        sumValue += value;

        sr += 1;
        appendDataRow(
            stockSheet.sheet,
            sr,
            stockDefs,
            [
                str(product.productCode),
                str(product.name),
                str(row.sku || product.sku || variant.sku),
                str(variant.combinationString),
                str(product.trackingType || row.trackingType),
                str(product.productSourceType || row.productSourceType),
                str(warehouse.warehouseCode),
                str(warehouse.warehouseName),
                str(branch.name || branch.branchCode),
                str(row.stockStatus),
                onHand,
                reserved,
                available,
                num(row.reorderLevel),
                num(row.averageCost),
                value,
                fmtDate(row.updatedAt),
            ],
            z++ % 2 === 1
        );
    }

    sr += 1;
    stockSheet.sheet.getRow(sr).height = 8;
    fillRow(stockSheet.sheet, sr, 1, stockSheet.colCount, C.canvas);
    sr += 1;
    appendTotalsRow(stockSheet.sheet, sr, stockDefs, [
        "TOTALS",
        `${stockRows.length} rows`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        sumOnHand,
        sumReserved,
        sumAvailable,
        "",
        "",
        sumValue,
        "",
    ]);
    freezeFilter(
        stockSheet.sheet,
        stockSheet.headerRow,
        stockSheet.colCount,
        Math.max(stockSheet.headerRow, sr - 2)
    );

    // ── Low Stock ─────────────────────────────────────────
    const lowDefs = [
        { h: "Product Code", k: "text", w: 14, g: C.gProduct, groupStart: true },
        { h: "Product Name", k: "text", w: 26, g: C.gProduct },
        { h: "SKU", k: "text", w: 14, g: C.gCatalog, groupStart: true },
        { h: "Warehouse", k: "text", w: 22, g: C.gStock, groupStart: true },
        { h: "Status", k: "status", w: 13, g: C.gStatus, groupStart: true },
        { h: "Available", k: "qty", w: 11, g: C.gStock, groupStart: true },
        { h: "Reorder", k: "qty", w: 10, g: C.gStock },
        { h: "On Hand", k: "qty", w: 10, g: C.gStock },
        { h: "Value", k: "money", w: 14, g: C.gMoney, groupStart: true },
    ];

    const lowSheet = buildSheetChrome(
        workbook,
        "Low Stock",
        "FFB45309",
        lowDefs,
        "  Lowkia ERP   ·   Low / Out of Stock",
        `  Reorder alerts    ·    ${fmtDateTime(exportedAt)}`
    );

    let lr = lowSheet.headerRow;
    let lz = 0;
    for (const row of lowStockRows) {
        const product = row.productId || {};
        const warehouse = row.warehouseId || {};
        const value =
            num(row.inventoryValue) > 0
                ? num(row.inventoryValue)
                : num(row.currentStock) * num(row.averageCost);
        lr += 1;
        appendDataRow(
            lowSheet.sheet,
            lr,
            lowDefs,
            [
                str(product.productCode),
                str(product.name),
                str(row.sku || product.sku),
                dash(
                    str(warehouse.warehouseCode) && str(warehouse.warehouseName)
                        ? `${warehouse.warehouseCode} — ${warehouse.warehouseName}`
                        : warehouse.warehouseName || warehouse.warehouseCode
                ),
                str(row.stockStatus),
                num(row.availableStock),
                num(row.reorderLevel),
                num(row.currentStock),
                value,
            ],
            lz++ % 2 === 1
        );
    }
    freezeFilter(
        lowSheet.sheet,
        lowSheet.headerRow,
        lowSheet.colCount,
        Math.max(lowSheet.headerRow, lr)
    );

    // ── Movements ─────────────────────────────────────────
    const movDefs = [
        { h: "Movement #", k: "text", w: 16, g: C.gProduct, groupStart: true },
        { h: "Date", k: "center", w: 12, g: C.gMeta },
        { h: "Direction", k: "status", w: 11, g: C.gStatus, groupStart: true },
        { h: "Type", k: "center", w: 14, g: C.gStatus },
        { h: "Product", k: "text", w: 24, g: C.gCatalog, groupStart: true },
        { h: "SKU", k: "text", w: 14, g: C.gCatalog },
        { h: "Customer", k: "text", w: 20, g: C.gCatalog },
        { h: "Warehouse", k: "text", w: 20, g: C.gStock, groupStart: true },
        { h: "From Qty", k: "qty", w: 10, g: C.gStock, groupStart: true },
        { h: "Qty", k: "qty", w: 10, g: C.gStock },
        { h: "To Qty", k: "qty", w: 10, g: C.gStock },
        { h: "GRN", k: "text", w: 14, g: C.gMeta, groupStart: true },
        { h: "Remarks", k: "text", w: 22, g: C.gMeta },
    ];

    const movSheet = buildSheetChrome(
        workbook,
        "Movements",
        "FF0369A1",
        movDefs,
        "  Lowkia ERP   ·   Stock Movements",
        `  Ledger history    ·    ${fmtDateTime(exportedAt)}`
    );

    let mr = movSheet.headerRow;
    let mz = 0;
    let movQtySum = 0;
    for (const m of movements) {
        const product = m.productId || {};
        const warehouse = m.warehouseId || {};
        const cust = movementCustomer(m);
        const qty = num(m.quantity);
        movQtySum += qty;
        mr += 1;
        appendDataRow(
            movSheet.sheet,
            mr,
            movDefs,
            [
                str(m.movementNumber),
                fmtDate(m.movementDate || m.createdAt),
                str(m.movementDirection),
                str(m.movementType),
                str(m.productName || product.name),
                str(m.sku || product.productCode),
                dash(
                    [cust.code, cust.name, cust.phone].filter(Boolean).join(" — ")
                ),
                str(warehouse.warehouseName || warehouse.warehouseCode),
                num(m.previousStock),
                qty,
                num(m.currentStock),
                str(m.grnId?.grnNumber || m.grnNumber),
                str(m.remarks || m.note || m.reason),
            ],
            mz++ % 2 === 1
        );
    }
    mr += 1;
    movSheet.sheet.getRow(mr).height = 8;
    fillRow(movSheet.sheet, mr, 1, movSheet.colCount, C.canvas);
    mr += 1;
    appendTotalsRow(movSheet.sheet, mr, movDefs, [
        "TOTALS",
        `${movements.length} rows`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        movQtySum,
        "",
        "",
        "",
    ]);
    freezeFilter(
        movSheet.sheet,
        movSheet.headerRow,
        movSheet.colCount,
        Math.max(movSheet.headerRow, mr - 2)
    );

    // ── IMEI Stock ────────────────────────────────────────
    const imeiDefs = [
        { h: "IMEI", k: "text", w: 20, g: C.gProduct, groupStart: true },
        { h: "Product Code", k: "text", w: 14, g: C.gCatalog, groupStart: true },
        { h: "Product Name", k: "text", w: 24, g: C.gCatalog },
        { h: "Variant", k: "text", w: 18, g: C.gCatalog },
        { h: "Branch", k: "text", w: 18, g: C.gStock, groupStart: true },
        { h: "Status", k: "status", w: 12, g: C.gStatus, groupStart: true },
        { h: "Updated", k: "center", w: 12, g: C.gMeta, groupStart: true },
    ];

    const imeiSheet = buildSheetChrome(
        workbook,
        "IMEI Stock",
        "FF4338CA",
        imeiDefs,
        "  Lowkia ERP   ·   IMEI / Serialized Units",
        `  Unit-level stock    ·    ${fmtDateTime(exportedAt)}`
    );

    let ir = imeiSheet.headerRow;
    let iz = 0;
    for (const row of imeis) {
        const product = row.productId || {};
        const variant = row.variantId || {};
        const branch = row.currentBranchId || {};
        ir += 1;
        appendDataRow(
            imeiSheet.sheet,
            ir,
            imeiDefs,
            [
                str(row.imei),
                str(product.productCode),
                str(product.name),
                str(variant.combinationString || variant.sku),
                str(branch.name || branch.branchCode),
                str(row.status),
                fmtDate(row.updatedAt),
            ],
            iz++ % 2 === 1
        );
    }
    freezeFilter(
        imeiSheet.sheet,
        imeiSheet.headerRow,
        imeiSheet.colCount,
        Math.max(imeiSheet.headerRow, ir)
    );

    // ── Export Summary ────────────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 28, 3, 28, 3, 18, 3, 18, 3]);

    sum.mergeCells(1, 1, 1, 9);
    const st = sum.getCell(1, 1);
    st.value = "  Lowkia ERP   ·   Stock Export Summary";
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

    card(5, 2, "STOCK ROWS", stockRows.length);
    card(5, 4, "ON HAND QTY", sumOnHand);
    card(5, 6, "AVAILABLE", sumAvailable);
    card(5, 8, "STOCK VALUE", sumValue, true);

    card(8, 2, "LOW STOCK", lowStockRows.length);
    card(8, 4, "MOVEMENTS", movements.length);
    card(8, 6, "IMEI UNITS", imeis.length);
    card(8, 8, "SKU COUNT", num(stats.totalSkus));

    let kvRow = 12;
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
    kvRow = kv(kvRow, "Warehouse", str(filterLines.warehouseId));
    kvRow = kv(kvRow, "Stock status", str(filterLines.stockStatus));
    kvRow = kv(kvRow, "Movement type", str(filterLines.movementType));
    kvRow = kv(kvRow, "IMEI status", str(filterLines.imeiStatus));
    kvRow += 1;
    kvRow = section(kvRow, "LIVE STATS (API)");
    kvRow = kv(kvRow, "Total qty", num(stats.totalQty));
    kvRow = kv(kvRow, "Available qty", num(stats.availableQty));
    kvRow = kv(kvRow, "Reserved qty", num(stats.reservedQty));
    kvRow = kv(kvRow, "Inventory value", num(stats.inventoryValue));
    kvRow = kv(kvRow, "Low stock count", num(stats.lowStock));
    kvRow = kv(kvRow, "Out of stock", num(stats.outOfStock));
    kvRow = kv(kvRow, "IMEI available", num(stats.imeiAvailable));

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const today = fmtDate(new Date());
    const wh = str(query.warehouseId).slice(-6);
    if (wh) return `stock_${wh}_${today}.xlsx`;
    return `stock_${today}.xlsx`;
};

module.exports = {
    buildInventoryWorkbook,
    buildExportFilename,
    MAX_EXPORT_INVENTORY,
};
