const ExcelJS = require("exceljs");

const MAX_EXPORT_ATTENDANCE = 25000;

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

const fmtTime = (d) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
};

const minsLabel = (mins) => {
    const m = Math.max(num(mins), 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h}h ${String(r).padStart(2, "0")}m`;
};

const buildAttendanceWorkbook = async ({
    records = [],
    dailyRows = [],
    meta = {},
} = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Lowkia ERP";
    workbook.created = new Date();
    workbook.modified = new Date();

    const exportedAt = meta.exportedAt || new Date();
    const exportedBy = str(meta.exportedBy) || "System";
    const filterLines = meta.filters || {};
    const cards = meta.cards || {};

    // ── Daily Roster (optional) ───────────────────────────
    if (dailyRows.length > 0) {
        const rosterDefs = [
            { h: "Emp Code", k: "text", w: 12, g: C.gProduct, groupStart: true },
            { h: "Employee", k: "text", w: 22, g: C.gProduct },
            { h: "Branch", k: "text", w: 16, g: C.gStock, groupStart: true },
            { h: "Department", k: "text", w: 16, g: C.gCatalog, groupStart: true },
            { h: "Designation", k: "text", w: 16, g: C.gCatalog },
            { h: "Shift", k: "text", w: 16, g: C.gCatalog },
            { h: "Shift Start", k: "center", w: 11, g: C.gCatalog },
            { h: "Shift End", k: "center", w: 11, g: C.gCatalog },
            { h: "Status", k: "status", w: 14, g: C.gStatus, groupStart: true },
            { h: "Check In", k: "center", w: 18, g: C.gMeta, groupStart: true },
            { h: "Check Out", k: "center", w: 18, g: C.gMeta },
            { h: "Worked", k: "text", w: 10, g: C.gStock, groupStart: true },
            { h: "Worked Min", k: "qty", w: 11, g: C.gStock },
            { h: "Late Min", k: "qty", w: 10, g: C.gStatus, groupStart: true },
            { h: "Early Leave", k: "qty", w: 11, g: C.gStatus },
            { h: "OT Min", k: "qty", w: 10, g: C.gMoney, groupStart: true },
            { h: "Approved OT", k: "qty", w: 12, g: C.gMoney },
        ];

        const roster = buildSheetChrome(
            workbook,
            "Daily Roster",
            "FF0D9488",
            rosterDefs,
            "  Lowkia ERP   ·   Daily Attendance Roster",
            `  ${str(filterLines.date) || "Selected day"}    ·    ${fmtDateTime(exportedAt)}`
        );

        let rr = roster.headerRow;
        let rz = 0;
        let workedSum = 0;
        let lateSum = 0;
        let otSum = 0;
        for (const row of dailyRows) {
            const worked = num(row.workingMinutes);
            workedSum += worked;
            lateSum += num(row.lateMinutes);
            otSum += num(row.overtimeMinutes);
            rr += 1;
            appendDataRow(
                roster.sheet,
                rr,
                rosterDefs,
                [
                    str(row.employeeCode),
                    str(row.employeeName),
                    str(row.branchName),
                    str(row.departmentName),
                    str(row.designationName),
                    str(row.shiftName),
                    str(row.shiftStart),
                    str(row.shiftEnd),
                    str(row.status),
                    fmtTime(row.checkIn),
                    fmtTime(row.checkOut),
                    str(row.workingHoursLabel) || minsLabel(worked),
                    worked,
                    num(row.lateMinutes),
                    num(row.earlyLeaveMinutes),
                    num(row.overtimeMinutes),
                    num(row.approvedOvertimeMinutes),
                ],
                rz++ % 2 === 1
            );
        }
        rr += 1;
        roster.sheet.getRow(rr).height = 8;
        fillRow(roster.sheet, rr, 1, roster.colCount, C.canvas);
        rr += 1;
        appendTotalsRow(roster.sheet, rr, rosterDefs, [
            "TOTALS",
            `${dailyRows.length} employees`,
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
            workedSum,
            lateSum,
            "",
            otSum,
            "",
        ]);
        freezeFilter(
            roster.sheet,
            roster.headerRow,
            roster.colCount,
            Math.max(roster.headerRow, rr - 2)
        );
    }

    // ── Attendance Records ────────────────────────────────
    const recDefs = [
        { h: "Code", k: "text", w: 14, g: C.gProduct, groupStart: true },
        { h: "Work Date", k: "center", w: 12, g: C.gMeta },
        { h: "Emp Code", k: "text", w: 12, g: C.gProduct, groupStart: true },
        { h: "Employee", k: "text", w: 22, g: C.gProduct },
        { h: "Branch", k: "text", w: 16, g: C.gStock, groupStart: true },
        { h: "Department", k: "text", w: 16, g: C.gCatalog, groupStart: true },
        { h: "Designation", k: "text", w: 16, g: C.gCatalog },
        { h: "Shift", k: "text", w: 16, g: C.gCatalog },
        { h: "Status", k: "status", w: 14, g: C.gStatus, groupStart: true },
        { h: "In Status", k: "center", w: 12, g: C.gStatus },
        { h: "Out Status", k: "center", w: 12, g: C.gStatus },
        { h: "Check In", k: "center", w: 18, g: C.gMeta, groupStart: true },
        { h: "Check Out", k: "center", w: 18, g: C.gMeta },
        { h: "Gross Min", k: "qty", w: 10, g: C.gStock, groupStart: true },
        { h: "Worked Min", k: "qty", w: 11, g: C.gStock },
        { h: "Late Min", k: "qty", w: 10, g: C.gStatus, groupStart: true },
        { h: "Early Leave", k: "qty", w: 11, g: C.gStatus },
        { h: "OT Min", k: "qty", w: 10, g: C.gMoney, groupStart: true },
        { h: "Approved OT", k: "qty", w: 12, g: C.gMoney },
        { h: "Breaks", k: "qty", w: 8, g: C.gMeta, groupStart: true },
        { h: "Platform In", k: "text", w: 12, g: C.gMeta },
        { h: "Platform Out", k: "text", w: 12, g: C.gMeta },
    ];

    const recSheet = buildSheetChrome(
        workbook,
        "Attendance Records",
        "FF0369A1",
        recDefs,
        "  Lowkia ERP   ·   Attendance Records",
        `  Punch / status ledger    ·    ${fmtDateTime(exportedAt)}`
    );

    let ar = recSheet.headerRow;
    let az = 0;
    let sumWorked = 0;
    let sumLate = 0;
    let sumOt = 0;
    const statusCounts = {};

    for (const row of records) {
        const worked = num(row.actualWorkedMinutes || row.workingMinutes);
        const late = num(row.lateMinutes);
        const ot = num(row.overtimeMinutes);
        sumWorked += worked;
        sumLate += late;
        sumOt += ot;
        const st = str(row.attendanceStatus) || "Unknown";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
        const breaks = Array.isArray(row.breaks) ? row.breaks.length : 0;

        ar += 1;
        appendDataRow(
            recSheet.sheet,
            ar,
            recDefs,
            [
                str(row.attendanceCode),
                str(row.workDate) || fmtDate(row.attendanceDate),
                str(row.employeeCode),
                str(row.employeeName),
                str(row.branchName) ||
                    refName(row.branchId, ["name", "branchCode"]),
                str(row.departmentName),
                str(row.designationName),
                str(row.shiftName) ||
                    refName(row.shiftId, ["shiftName", "name"]),
                str(row.attendanceStatus),
                str(row.checkInStatus),
                str(row.checkOutStatus),
                fmtTime(row.checkIn),
                fmtTime(row.checkOut),
                num(row.grossWorkedMinutes),
                worked,
                late,
                num(row.earlyLeaveMinutes),
                ot,
                num(row.approvedOvertimeMinutes),
                breaks,
                str(row.checkInPlatform),
                str(row.checkOutPlatform),
            ],
            az++ % 2 === 1
        );
    }

    ar += 1;
    recSheet.sheet.getRow(ar).height = 8;
    fillRow(recSheet.sheet, ar, 1, recSheet.colCount, C.canvas);
    ar += 1;
    appendTotalsRow(recSheet.sheet, ar, recDefs, [
        "TOTALS",
        `${records.length} records`,
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
        sumWorked,
        sumLate,
        "",
        sumOt,
        "",
        "",
        "",
        "",
    ]);
    freezeFilter(
        recSheet.sheet,
        recSheet.headerRow,
        recSheet.colCount,
        Math.max(recSheet.headerRow, ar - 2)
    );

    // ── Breaks ────────────────────────────────────────────
    const breakDefs = [
        { h: "Work Date", k: "center", w: 12, g: C.gMeta, groupStart: true },
        { h: "Emp Code", k: "text", w: 12, g: C.gProduct, groupStart: true },
        { h: "Employee", k: "text", w: 22, g: C.gProduct },
        { h: "Type", k: "center", w: 12, g: C.gStatus, groupStart: true },
        { h: "Start", k: "center", w: 18, g: C.gMeta, groupStart: true },
        { h: "End", k: "center", w: 18, g: C.gMeta },
        { h: "Duration Min", k: "qty", w: 12, g: C.gStock, groupStart: true },
    ];

    const breakSheet = buildSheetChrome(
        workbook,
        "Breaks",
        "FFB45309",
        breakDefs,
        "  Lowkia ERP   ·   Attendance Breaks",
        `  Break detail from exported records    ·    ${fmtDateTime(exportedAt)}`
    );

    let br = breakSheet.headerRow;
    let bz = 0;
    let breakMinSum = 0;
    let breakCount = 0;
    for (const row of records) {
        const breaks = Array.isArray(row.breaks) ? row.breaks : [];
        for (const b of breaks) {
            const dur = num(b.durationMinutes);
            breakMinSum += dur;
            breakCount += 1;
            br += 1;
            appendDataRow(
                breakSheet.sheet,
                br,
                breakDefs,
                [
                    str(row.workDate) || fmtDate(row.attendanceDate),
                    str(row.employeeCode),
                    str(row.employeeName),
                    str(b.type),
                    fmtTime(b.startTime),
                    fmtTime(b.endTime),
                    dur,
                ],
                bz++ % 2 === 1
            );
        }
    }
    if (breakCount > 0) {
        br += 1;
        breakSheet.sheet.getRow(br).height = 8;
        fillRow(breakSheet.sheet, br, 1, breakSheet.colCount, C.canvas);
        br += 1;
        appendTotalsRow(breakSheet.sheet, br, breakDefs, [
            "TOTALS",
            `${breakCount} breaks`,
            "",
            "",
            "",
            "",
            breakMinSum,
        ]);
    }
    freezeFilter(
        breakSheet.sheet,
        breakSheet.headerRow,
        breakSheet.colCount,
        Math.max(breakSheet.headerRow, br)
    );

    // ── Export Summary ────────────────────────────────────
    const sum = workbook.addWorksheet("Export Summary", {
        properties: { tabColor: { argb: "FF64748B" }, defaultRowHeight: 22 },
        views: [{ showGridLines: false }],
    });
    setWidths(sum, [3, 28, 3, 28, 3, 18, 3, 18, 3]);

    sum.mergeCells(1, 1, 1, 9);
    const st = sum.getCell(1, 1);
    st.value = "  Lowkia ERP   ·   Attendance Export Summary";
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

    const card = (row, col, label, value) => {
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
        sum.getRow(row).height = 20;
        sum.getRow(row + 1).height = 32;
    };

    card(5, 2, "RECORDS", records.length);
    card(5, 4, "ROSTER ROWS", dailyRows.length);
    card(5, 6, "WORKED MIN", sumWorked);
    card(5, 8, "LATE MIN", sumLate);

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
    kvRow = kv(kvRow, "Date", str(filterLines.date));
    kvRow = kv(kvRow, "Month / Year", [
        filterLines.month,
        filterLines.year,
    ]
        .filter(Boolean)
        .join(" / "));
    kvRow = kv(kvRow, "Branch", str(filterLines.branchId));
    kvRow = kv(kvRow, "Status", str(filterLines.status));
    kvRow = kv(kvRow, "Employee", str(filterLines.employeeId));
    kvRow += 1;
    kvRow = section(kvRow, "RECORD STATUS BREAKDOWN");
    for (const key of Object.keys(statusCounts).sort()) {
        kvRow = kv(kvRow, key, statusCounts[key]);
    }
    if (Object.keys(cards).length) {
        kvRow += 1;
        kvRow = section(kvRow, "DAILY CARDS");
        for (const [k, v] of Object.entries(cards)) {
            kvRow = kv(kvRow, k, v);
        }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const buildExportFilename = (query = {}) => {
    const date = str(query.date || query.workDate);
    if (date) return `attendance_${date}.xlsx`;
    const month = str(query.month);
    const year = str(query.year);
    if (month && year) return `attendance_${year}_${month.padStart(2, "0")}.xlsx`;
    return `attendance_${fmtDate(new Date())}.xlsx`;
};

module.exports = {
    buildAttendanceWorkbook,
    buildExportFilename,
    MAX_EXPORT_ATTENDANCE,
};
