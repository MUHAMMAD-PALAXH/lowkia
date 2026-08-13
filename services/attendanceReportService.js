const mongoose = require("mongoose");
const Attendance = require("../model/attendance");
const Employee = require("../model/employee");
const Shift = require("../model/shift");
const Leave = require("../model/leave");
const Branch = require("../model/branch");
const AppError = require("../utils/appError");
const settingsService = require("./settingsService");
const attendancePolicyService = require("./attendancePolicyService");
const {
    formatWorkDate,
    formatWeekday,
    startOfWorkDay
} = require("../utils/timezone");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const emptyCards = () => ({
    present: 0,
    late: 0,
    absent: 0,
    leave: 0,
    incomplete: 0,
    halfDay: 0,
    holiday: 0,
    weeklyOff: 0,
    remote: 0,
    totalEmployees: 0
});

const bumpCard = (cards, status) => {
    switch (status) {
        case "Present":
            cards.present += 1;
            break;
        case "Late":
            cards.late += 1;
            cards.present += 1;
            break;
        case "Absent":
            cards.absent += 1;
            break;
        case "Leave":
            cards.leave += 1;
            break;
        case "Incomplete":
            cards.incomplete += 1;
            break;
        case "Half Day":
            cards.halfDay += 1;
            break;
        case "Holiday":
            cards.holiday += 1;
            break;
        case "Weekend":
            cards.weeklyOff += 1;
            break;
        case "Remote":
        case "Work From Home":
            cards.remote += 1;
            cards.present += 1;
            break;
        default:
            break;
    }
};

const isWeeklyOffFor = (shift, policy, weekday) => {
    const offs =
        (shift?.weeklyOff && shift.weeklyOff.length
            ? shift.weeklyOff
            : policy?.weeklyOff) || [];
    return offs.map(String).includes(String(weekday));
};

const formatMinutes = (mins) => {
    const m = Math.max(Number(mins) || 0, 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h}h ${String(r).padStart(2, "0")}m`;
};

/**
 * Owner daily dashboard for a work date.
 */
const getDailyReport = async (query = {}, managedBranchIds = null) => {
    const timezone = await settingsService.getTimezone();
    const policy = await attendancePolicyService.getActiveOrDefault();
    const now = new Date();
    const workDate =
        query.date || query.workDate || formatWorkDate(now, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate))) {
        throw new AppError("date must be YYYY-MM-DD.", 400);
    }

    const weekday = formatWeekday(startOfWorkDay(workDate, timezone), timezone);
    const dayStart = startOfWorkDay(workDate, timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const empFilter = {
        ...NOT_DELETED,
        isActive: { $ne: false },
        employmentStatus: { $in: ["Active", "On Leave"] }
    };

    const { applyBranchScopeFilter } = require("../middleware/hrAccess");
    applyBranchScopeFilter(
        empFilter,
        managedBranchIds,
        query.branchId && toObjectId(query.branchId)
            ? toObjectId(query.branchId)
            : null
    );
    if (query.departmentId && toObjectId(query.departmentId)) {
        empFilter.departmentId = toObjectId(query.departmentId);
    }
    if (query.shiftId && toObjectId(query.shiftId)) {
        empFilter.shiftId = toObjectId(query.shiftId);
    }
    if (query.employeeId && toObjectId(query.employeeId)) {
        empFilter._id = toObjectId(query.employeeId);
    }

    const employees = await Employee.find(empFilter)
        .populate("branchId", "branchCode name")
        .populate("departmentId", "departmentCode departmentName")
        .populate("shiftId", "shiftCode shiftName startTime endTime weeklyOff")
        .populate("designationId", "designationCode designationName")
        .sort({ fullName: 1, firstName: 1 })
        .lean();

    const employeeIds = employees.map((e) => e._id);

    const [attendanceRows, leaveRows] = await Promise.all([
        employeeIds.length
            ? Attendance.find({
                  employeeId: { $in: employeeIds },
                  workDate,
                  ...NOT_DELETED
              }).lean()
            : Promise.resolve([]),
        employeeIds.length
            ? Leave.find({
                  employeeId: { $in: employeeIds },
                  approvalStatus: "Approved",
                  isDeleted: { $ne: true },
                  startDate: { $lte: dayEnd },
                  endDate: { $gte: dayStart }
              }).lean()
            : Promise.resolve([])
    ]);

    const attByEmp = new Map(
        attendanceRows.map((a) => [String(a.employeeId), a])
    );
    const leaveByEmp = new Map();
    for (const lv of leaveRows) {
        leaveByEmp.set(String(lv.employeeId), lv);
    }

    // Prefetch holidays covering this workDate (avoid N+1)
    const Holiday = require("../model/holiday");
    const holidaysToday = await Holiday.find({
        ...NOT_DELETED,
        status: "Active",
        workDates: workDate
    }).lean();

    const holidayForBranch = (branchId) => {
        const bid = branchId ? String(branchId) : null;
        for (const h of holidaysToday) {
            const branches = (h.applicableBranchIds || []).map(String);
            if (!branches.length) return h;
            if (bid && branches.includes(bid)) return h;
        }
        return null;
    };

    const cards = emptyCards();
    cards.totalEmployees = employees.length;
    const rows = [];

    for (const emp of employees) {
        const eid = String(emp._id);
        const att = attByEmp.get(eid);
        const leave = leaveByEmp.get(eid);
        const holiday = holidayForBranch(emp.branchId?._id || emp.branchId);
        const shift = emp.shiftId || null;
        const weeklyOff = isWeeklyOffFor(shift, policy, weekday);

        let status = "Absent";
        if (att) {
            status = att.attendanceStatus || "Present";
            if (att.checkIn && !att.checkOut && status !== "Late") {
                status = att.isLate ? "Late" : "Incomplete";
            }
        } else if (leave && leave.leaveDuration === "Full Day") {
            status = "Leave";
        } else if (holiday) {
            status = "Holiday";
        } else if (weeklyOff) {
            status = "Weekend";
        } else if (leave) {
            status = "Leave";
        }

        if (query.status && String(query.status) !== status) {
            continue;
        }

        bumpCard(cards, status);

        const worked =
            Number(att?.actualWorkedMinutes || att?.workingMinutes) || 0;

        rows.push({
            employeeId: emp._id,
            employeeCode: emp.employeeCode,
            employeeName:
                emp.fullName || `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
            branchId: emp.branchId?._id || emp.branchId || null,
            branchName: emp.branchId?.name || "",
            departmentId: emp.departmentId?._id || emp.departmentId || null,
            departmentName: emp.departmentId?.departmentName || "",
            designationName: emp.designationId?.designationName || "",
            shiftId: shift?._id || null,
            shiftName: shift?.shiftName || "",
            shiftStart: shift?.startTime || "",
            shiftEnd: shift?.endTime || "",
            attendanceId: att?._id || null,
            checkIn: att?.checkIn || null,
            checkOut: att?.checkOut || null,
            checkInLocation:
                att?.locationName ||
                (att?.latitude != null && att?.longitude != null
                    ? `${Number(att.latitude).toFixed(4)}, ${Number(att.longitude).toFixed(4)}`
                    : ""),
            checkOutLocation:
                att?.checkOutLocationName ||
                (att?.checkOutLatitude != null && att?.checkOutLongitude != null
                    ? `${Number(att.checkOutLatitude).toFixed(4)}, ${Number(att.checkOutLongitude).toFixed(4)}`
                    : ""),
            workingMinutes: worked,
            workingHoursLabel: formatMinutes(worked),
            lateMinutes: Number(att?.lateMinutes) || 0,
            earlyLeaveMinutes: Number(att?.earlyLeaveMinutes) || 0,
            overtimeMinutes: Number(att?.overtimeMinutes) || 0,
            approvedOvertimeMinutes: Number(att?.approvedOvertimeMinutes) || 0,
            status,
            isLate: Boolean(att?.isLate),
            isOnLeave: Boolean(leave),
            isHoliday: Boolean(holiday),
            isWeeklyOff: weeklyOff
        });
    }

    // Recompute cards if status filter reduced rows
    if (query.status) {
        const filtered = emptyCards();
        filtered.totalEmployees = rows.length;
        for (const r of rows) bumpCard(filtered, r.status);
        Object.assign(cards, filtered);
    }

    return {
        timezone,
        workDate,
        weekday,
        cards,
        employees: rows,
        filters: {
            branchId: query.branchId || null,
            departmentId: query.departmentId || null,
            shiftId: query.shiftId || null,
            employeeId: query.employeeId || null,
            status: query.status || null
        }
    };
};

const summarizeAttendanceRows = (rows = []) => {
    const summary = {
        present: 0,
        late: 0,
        absent: 0,
        halfDay: 0,
        leave: 0,
        holiday: 0,
        weeklyOff: 0,
        incomplete: 0,
        totalWorkingMinutes: 0,
        totalLateMinutes: 0,
        totalEarlyLeaveMinutes: 0,
        totalOvertimeMinutes: 0,
        approvedOvertimeMinutes: 0,
        records: rows.length,
        workingDaysPresent: 0
    };

    for (const r of rows) {
        const s = r.attendanceStatus;
        if (s === "Present") {
            summary.present += 1;
            summary.workingDaysPresent += 1;
        } else if (s === "Late") {
            summary.late += 1;
            summary.present += 1;
            summary.workingDaysPresent += 1;
        } else if (s === "Absent") summary.absent += 1;
        else if (s === "Half Day") {
            summary.halfDay += 1;
            summary.workingDaysPresent += 1;
        } else if (s === "Leave") summary.leave += 1;
        else if (s === "Holiday") summary.holiday += 1;
        else if (s === "Weekend") summary.weeklyOff += 1;
        else if (s === "Incomplete") summary.incomplete += 1;
        else if (s === "Remote" || s === "Work From Home") {
            summary.present += 1;
            summary.workingDaysPresent += 1;
        }

        summary.totalWorkingMinutes +=
            Number(r.actualWorkedMinutes || r.workingMinutes) || 0;
        summary.totalLateMinutes += Number(r.lateMinutes) || 0;
        summary.totalEarlyLeaveMinutes += Number(r.earlyLeaveMinutes) || 0;
        summary.totalOvertimeMinutes += Number(r.overtimeMinutes) || 0;
        summary.approvedOvertimeMinutes +=
            Number(r.approvedOvertimeMinutes) || 0;
    }

    summary.totalWorkingHours = Number(
        (summary.totalWorkingMinutes / 60).toFixed(2)
    );
    summary.totalWorkingHoursLabel = formatMinutes(summary.totalWorkingMinutes);
    summary.approvedOvertimeHours = Number(
        (summary.approvedOvertimeMinutes / 60).toFixed(2)
    );
    summary.approvedOvertimeHoursLabel = formatMinutes(
        summary.approvedOvertimeMinutes
    );

    // Payroll-ready payload
    summary.payroll = {
        workingDays: summary.workingDaysPresent,
        presentDays: summary.present,
        absentDays: summary.absent,
        leaveDays: summary.leave,
        halfDays: summary.halfDay,
        lateMinutes: summary.totalLateMinutes,
        earlyLeaveMinutes: summary.totalEarlyLeaveMinutes,
        approvedOvertimeMinutes: summary.approvedOvertimeMinutes
    };

    return summary;
};

/**
 * Monthly report — per employee rows + optional single employee.
 */
const getMonthlyReport = async (query = {}, managedBranchIds = null) => {
    const timezone = await settingsService.getTimezone();
    const now = new Date();
    const today = formatWorkDate(now, timezone);
    const year = Number(query.year) || Number(today.slice(0, 4));
    const month = Number(query.month) || Number(today.slice(5, 7));
    if (month < 1 || month > 12) throw new AppError("Invalid month.", 400);

    const empFilter = {
        ...NOT_DELETED,
        isActive: { $ne: false }
    };
    const { applyBranchScopeFilter } = require("../middleware/hrAccess");
    applyBranchScopeFilter(
        empFilter,
        managedBranchIds,
        query.branchId && toObjectId(query.branchId)
            ? toObjectId(query.branchId)
            : null
    );
    if (query.departmentId && toObjectId(query.departmentId)) {
        empFilter.departmentId = toObjectId(query.departmentId);
    }
    if (query.employeeId && toObjectId(query.employeeId)) {
        empFilter._id = toObjectId(query.employeeId);
    }

    const employees = await Employee.find(empFilter)
        .populate("branchId", "branchCode name")
        .populate("departmentId", "departmentCode departmentName")
        .sort({ fullName: 1, firstName: 1 })
        .lean();

    const employeeIds = employees.map((e) => e._id);
    const attendanceRows = employeeIds.length
        ? await Attendance.find({
              employeeId: { $in: employeeIds },
              year,
              month,
              ...NOT_DELETED
          }).lean()
        : [];

    const byEmp = new Map();
    for (const a of attendanceRows) {
        const key = String(a.employeeId);
        if (!byEmp.has(key)) byEmp.set(key, []);
        byEmp.get(key).push(a);
    }

    const employeesOut = employees.map((emp) => {
        const rows = byEmp.get(String(emp._id)) || [];
        const summary = summarizeAttendanceRows(rows);
        return {
            employeeId: emp._id,
            employeeCode: emp.employeeCode,
            employeeName:
                emp.fullName ||
                `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
            branchId: emp.branchId?._id || emp.branchId || null,
            branchName: emp.branchId?.name || "",
            departmentName: emp.departmentId?.departmentName || "",
            ...summary
        };
    });

    const totals = summarizeAttendanceRows(attendanceRows);
    totals.employeeCount = employeesOut.length;

    return {
        timezone,
        year,
        month,
        totals,
        employees: employeesOut,
        filters: {
            branchId: query.branchId || null,
            departmentId: query.departmentId || null,
            employeeId: query.employeeId || null
        }
    };
};

/**
 * Branch rollup for a single work date (default today).
 */
const getBranchReport = async (query = {}, managedBranchIds = null) => {
    const daily = await getDailyReport(query, managedBranchIds);
    const byBranch = new Map();

    for (const row of daily.employees) {
        const key = String(row.branchId || "none");
        if (!byBranch.has(key)) {
            byBranch.set(key, {
                branchId: row.branchId,
                branchName: row.branchName || "Unassigned",
                totalEmployees: 0,
                present: 0,
                late: 0,
                absent: 0,
                leave: 0,
                incomplete: 0,
                holiday: 0,
                weeklyOff: 0,
                halfDay: 0
            });
        }
        const b = byBranch.get(key);
        b.totalEmployees += 1;
        bumpCard(b, row.status);
    }

    // Include branches with zero employees if filtering all
    if (!query.branchId) {
        const branches = await Branch.find({
            ...NOT_DELETED,
            status: "Active"
        })
            .select("branchCode name")
            .lean();
        for (const br of branches) {
            const key = String(br._id);
            if (!byBranch.has(key)) {
                byBranch.set(key, {
                    branchId: br._id,
                    branchName: br.name,
                    totalEmployees: 0,
                    present: 0,
                    late: 0,
                    absent: 0,
                    leave: 0,
                    incomplete: 0,
                    holiday: 0,
                    weeklyOff: 0,
                    halfDay: 0
                });
            }
        }
    }

    return {
        timezone: daily.timezone,
        workDate: daily.workDate,
        weekday: daily.weekday,
        cards: daily.cards,
        branches: [...byBranch.values()].sort((a, b) =>
            String(a.branchName).localeCompare(String(b.branchName))
        )
    };
};

module.exports = {
    getDailyReport,
    getMonthlyReport,
    getBranchReport,
    summarizeAttendanceRows,
    formatMinutes
};
