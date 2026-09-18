const ExcelJS = require("exceljs");

const MAX_EXPORT_REPAIR_TICKETS = 25000;

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

const branchLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.name || ref.branchCode || ref.code || "");
};

const techLabel = (ref) => {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    return str(ref.name || ref.email || "");
};

const buildRepairTicketWorkbook = async ({ tickets = [], meta = {} } = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Lowkia ERP";
    workbook.created = new Date();
    workbook.modified = new Date();

    const exportedAt = meta.exportedAt || new Date();
    const exportedBy = str(meta.exportedBy) || "System";
    const filterLines = meta.filters || {};

    // ── Tickets ───────────────────────────────────────────
    const ticketDefs = [
        { h: "Ticket #", k: "text", w: 14, g: C.gProduct, groupStart: true },
        { h: "Repair Code", k: "text", w: 13, g: C.gProduct },
        { h: "Barcode", k: "text", w: 14, g: C.gProduct },
        { h: "Status", k: "status", w: 16, g: C.gStatus, groupStart: true },
        { h: "Priority", k: "center", w: 10, g: C.gStatus },
        { h: "Source", k: "center", w: 14, g: C.gCatalog, groupStart: true },
        { h: "Tracking", k: "center", w: 11, g: C.gCatalog },
        { h: "Service Type", k: "text", w: 16, g: C.gCatalog },
        { h: "Customer", k: "text", w: 20, g: C.gCatalog, groupStart: true },
        { h: "Phone", k: "text", w: 14, g: C.gCatalog },
        { h: "Email", k: "text", w: 18, g: C.gCatalog },
        { h: "Branch", k: "text", w: 16, g: C.gStock, groupStart: true },
        { h: "Received", k: "center", w: 12, g: C.gMeta, groupStart: true },
        { h: "Expected", k: "center", w: 12, g: C.gMeta },
        { h: "Completed", k: "center", w: 12, g: C.gMeta },
        { h: "Pickup", k: "center", w: 12, g: C.gMeta },
        { h: "Pay Method", k: "center", w: 14, g: C.gMoney, groupStart: true },
        { h: "Pay Status", k: "status", w: 11, g: C.gMoney },
        { h: "Total", k: "money", w: 12, g: C.gMoney },
        { h: "Paid", k: "money", w: 11, g: C.gMoney },
        { h: "Due", k: "money", w: 11, g: C.gMoney },
        { h: "Warranty", k: "center", w: 12, g: C.gStatus, groupStart: true },
        { h: "Warranty Type", k: "text", w: 14, g: C.gStatus },
        { h: "Warranty Exp", k: "center", w: 12, g: C.gStatus },
        { h: "Repaired By", k: "text", w: 14, g: C.gMeta, groupStart: true },
        { h: "Technician", k: "text", w: 16, g: C.gMeta },
    ];

    const ticketSheet = buildSheetChrome(
        workbook,
        "Tickets",
        "FF0D9488",
        ticketDefs,
        "  Lowkia ERP   ·   Repair Tickets",
        `  Service tickets overview    ·    ${fmtDateTime(exportedAt)}`
    );

    let tr = ticketSheet.headerRow;
    let tz = 0;
    let sumTotal = 0;
    let sumPaid = 0;
    let sumDue = 0;
    const statusCounts = {};

    for (const t of tickets) {
        const total = num(t.totalAmount);
        const paid = num(t.paidAmount);
        const due = num(t.dueAmount);
        sumTotal += total;
        sumPaid += paid;
        sumDue += due;
        const st = str(t.status) || "Unknown";
        statusCounts[st] = (statusCounts[st] || 0) + 1;

        tr += 1;
        appendDataRow(
            ticketSheet.sheet,
            tr,
            ticketDefs,
            [
                str(t.ticketNumber),
                str(t.repairCode),
                str(t.barcode),
                str(t.status),
                str(t.priority),
                str(t.ticketSource),
                str(t.trackingType),
                str(t.serviceType),
                str(t.customerName),
                str(t.phone),
                str(t.email),
                branchLabel(t.branchId),
                fmtDate(t.receivedDate),
                fmtDate(t.expectedDeliveryDate),
                fmtDate(t.completedDate),
                fmtDate(t.pickupDate),
                str(t.paymentMethod),
                str(t.paymentStatus),
                total,
                paid,
                due,
                t.isWarranty || t.warrantyChecked ? "Yes" : "No",
                str(t.warrantyType),
                fmtDate(t.warrantyExpiry),
                str(t.repairedBy),
                techLabel(t.assignedTechnician),
            ],
            tz++ % 2 === 1
        );
    }

    tr += 1;
    ticketSheet.sheet.getRow(tr).height = 8;
    fillRow(ticketSheet.sheet, tr, 1, ticketSheet.colCount, C.canvas);
    tr += 1;
    appendTotalsRow(ticketSheet.sheet, tr, ticketDefs, [
        "TOTALS",
        `${tickets.length} tickets`,
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
        sumTotal,
        sumPaid,
        sumDue,
        "",
        "",
        "",
        "",
        "",
    ]);
    freezeFilter(
        ticketSheet.sheet,
        ticketSheet.headerRow,
        ticketSheet.colCount,
        Math.max(ticketSheet.headerRow, tr - 2)
    );

    // ── Devices ───────────────────────────────────────────
    const deviceDefs = [
        { h: "Ticket #", k: "text", w: 14, g: C.gProduct, groupStart: true },
        { h: "Status", k: "status", w: 14, g: C.gStatus, groupStart: true },
        { h: "Product", k: "text", w: 24, g: C.gCatalog, groupStart: true },
        { h: "Brand", k: "text", w: 14, g: C.gCatalog },
        { h: "Model", k: "text", w: 14, g: C.gCatalog },
        { h: "Category", k: "text", w: 14, g: C.gCatalog },
        { h: "Color", k: "text", w: 12, g: C.gCatalog },
        { h: "Serial", k: "text", w: 16, g: C.gStock, groupStart: true },
        { h: "IMEI 1", k: "text", w: 18, g: C.gStock },
        { h: "IMEI 2", k: "text", w: 18, g: C.gStock },
        { h: "Accessories", k: "text", w: 20, g: C.gMeta, groupStart: true },
        { h: "Problem", k: "text", w: 32, g: C.gStatus, groupStart: true },
        { h: "Tech Remark", k: "text", w: 24, g: C.gStatus },
        { h: "Diagnosis", k: "text", w: 24, g: C.gStatus },
        { h: "Solution", k: "text", w: 24, g: C.gStatus },
        { h: "Service Details", k: "text", w: 24, g: C.gMeta, groupStart: true },
        { h: "Internal Note", k: "text", w: 22, g: C.gMeta },
        { h: "Diag Charge", k: "money", w: 12, g: C.gMoney, groupStart: true },
        { h: "Service", k: "money", w: 11, g: C.gMoney },
        { h: "Parts", k: "money", w: 11, g: C.gMoney },
        { h: "Labor", k: "money", w: 11, g: C.gMoney },
        { h: "Discount", k: "money", w: 11, g: C.gMoney },
        { h: "Tax", k: "money", w: 10, g: C.gMoney },
        { h: "Other", k: "money", w: 10, g: C.gMoney },
        { h: "Total", k: "money", w: 12, g: C.gMoney },
    ];

    const deviceSheet = buildSheetChrome(
        workbook,
        "Devices",
        "FF0369A1",
        deviceDefs,
        "  Lowkia ERP   ·   Repair Devices",
        `  Device, problem, and pricing detail    ·    ${fmtDateTime(exportedAt)}`
    );

    let dr = deviceSheet.headerRow;
    let dz = 0;
    for (const t of tickets) {
        const d = t.device || {};
        const accessories = Array.isArray(d.accessories)
            ? d.accessories.filter(Boolean).join(", ")
            : str(d.accessories);
        dr += 1;
        appendDataRow(
            deviceSheet.sheet,
            dr,
            deviceDefs,
            [
                str(t.ticketNumber),
                str(t.status),
                str(d.productName),
                str(d.brand),
                str(d.model),
                str(d.category),
                str(d.color),
                str(d.serialNumber),
                str(d.imei1),
                str(d.imei2),
                accessories,
                str(d.problemDescription),
                str(d.technicianRemark),
                str(t.diagnosis),
                str(t.repairSolution),
                str(t.serviceDetails),
                str(t.internalNote),
                num(t.diagnosisCharge),
                num(t.serviceCharge),
                num(t.partsCost),
                num(t.laborCost),
                num(t.discount),
                num(t.tax),
                num(t.otherCharges),
                num(t.totalAmount),
            ],
            dz++ % 2 === 1
        );
    }
    freezeFilter(
        deviceSheet.sheet,
        deviceSheet.headerRow,
        deviceSheet.colCount,
        Math.max(deviceSheet.headerRow, dr)
    );

    // ── Export Summary ────────────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 28, 3, 28, 3, 18, 3, 18, 3]);

    sum.mergeCells(1, 1, 1, 9);
    const st = sum.getCell(1, 1);
    st.value = "  Lowkia ERP   ·   Repair Export Summary";
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

    card(5, 2, "TICKETS", tickets.length);
    card(5, 4, "TOTAL AMOUNT", sumTotal, true);
    card(5, 6, "PAID", sumPaid, true);
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
    kvRow = kv(kvRow, "Trash", filterLines.trash ? "Yes" : "No");
    kvRow = kv(kvRow, "Sort", str(filterLines.sort || "newest"));
    kvRow += 1;
    kvRow = section(kvRow, "STATUS BREAKDOWN");
    const statusKeys = Object.keys(statusCounts).sort();
    for (const key of statusKeys) {
        kvRow = kv(kvRow, key, statusCounts[key]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const today = fmtDate(new Date());
    const trash =
        query.deleted === "true" ||
        query.trash === "true" ||
        query.deleted === true;
    if (trash) return `repair_tickets_trash_${today}.xlsx`;
    const status = str(query.status)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    if (status) return `repair_tickets_${status}_${today}.xlsx`;
    return `repair_tickets_${today}.xlsx`;
};

module.exports = {
    buildRepairTicketWorkbook,
    buildExportFilename,
    MAX_EXPORT_REPAIR_TICKETS,
};
