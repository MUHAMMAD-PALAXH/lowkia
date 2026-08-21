const mongoose = require("mongoose");
const Attendance = require("../model/attendance");
const Employee = require("../model/employee");
const Branch = require("../model/branch");
const Leave = require("../model/leave");
const Shift = require("../model/shift");
const { generateAttendanceCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");

const settingsService = require("./settingsService");
const attendancePolicyService = require("./attendancePolicyService");
const holidayService = require("./holidayService");
const { resolveEmployeeFromUser } = require("../middleware/hrAccess");
const {
    formatWorkDate,
    formatWeekday,
    startOfWorkDay,
    combineWorkDateAndTime,
    isNightShiftTimes
} = require("../utils/timezone");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const minutesBetween = (start, end) => {
    if (!start || !end) return 0;
    return Math.max(
        0,
        Math.floor((new Date(end) - new Date(start)) / (1000 * 60))
    );
};

const sumBreakMinutes = (breaks = [], now = new Date()) => {
    let total = 0;
    for (const b of breaks) {
        if (!b?.startTime) continue;
        if (b.endTime) {
            total += Number(b.durationMinutes) || minutesBetween(b.startTime, b.endTime);
        } else {
            // Active break — count until now for live working display
            total += minutesBetween(b.startTime, now);
        }
    }
    return total;
};

const getActiveBreak = (breaks = []) =>
    (breaks || []).find((b) => b.startTime && !b.endTime) || null;

const saveAttendanceDoc = async (doc) => {
    try {
        await doc.save();
    } catch (err) {
        if (err?.code === 11000) {
            throw new AppError(
                "Attendance record already exists for this workday.",
                409
            );
        }
        if (err?.name === "ValidationError") {
            const msg = Object.values(err.errors || {})
                .map((e) => e.message)
                .filter(Boolean)
                .join(" ");
            throw new AppError(msg || "Invalid attendance data.", 400);
        }
        throw err;
    }
};

const branchNameOf = (branch) => {
    if (!branch) return "";
    if (typeof branch === "object") {
        return branch.name || branch.branchName || "";
    }
    return "";
};

/** Normalize populated refs / ObjectIds / strings to ObjectId. */
const refId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (typeof value === "object" && value._id != null) return refId(value._id);
    if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
        return new mongoose.Types.ObjectId(value);
    }
    return null;
};

/**
 * Resolve employee branch even when populate dropped the id (deleted branch, etc.).
 */
const resolveEmployeeBranch = async (employee) => {
    let branchId = refId(employee.branchId);
    if (!branchId) {
        const snap = await Employee.findById(employee._id)
            .select("branchId")
            .lean();
        branchId = refId(snap?.branchId);
    }
    if (!branchId) {
        throw new AppError(
            "Employee has no branch assigned. Open Setup → Employees and assign a branch.",
            400
        );
    }

    let branch =
        employee.branchId &&
        typeof employee.branchId === "object" &&
        (employee.branchId.name || employee.branchId.branchName)
            ? employee.branchId
            : null;
    if (!branch || !branchNameOf(branch)) {
        branch = await Branch.findOne({ _id: branchId, ...NOT_DELETED }).lean();
    }
    if (!branch) {
        throw new AppError(
            "Employee branch is missing or inactive. Reassign branch in Setup → Employees.",
            400
        );
    }

    return { branchId, branch };
};

const loadContext = async (user, companyIdOverride = null) => {
    const employee = await resolveEmployeeFromUser(user, { requireActive: true });
    let companyId = companyIdOverride || null;
    if (!companyId) {
        companyId = await ensureUserCompany(user);
    }
    if (!companyId && employee?.companyId) {
        companyId = employee.companyId;
    }
    if (!companyId) {
        throw new AppError("Company context is required for attendance.", 403);
    }
    if (employee?.companyId) {
        assertDocumentCompany(employee, companyId, "Employee");
    }
    const timezone = await settingsService.getTimezone(companyId);
    const policy = await attendancePolicyService.getActiveOrDefault(companyId);
    const now = new Date();
    const workDate = formatWorkDate(now, timezone);
    const weekday = formatWeekday(now, timezone);
    const attendanceDate = startOfWorkDay(workDate, timezone);

    let shift = employee.shiftId;
    if (shift && (!shift.startTime || shift.status === undefined)) {
        shift = await Shift.findOne({ _id: shift._id || shift, ...NOT_DELETED });
    }
    // An inactive shift must no longer control punches or weekly-off rules.
    // Employees can remain linked to it for history/configuration, so use the
    // active attendance policy as today's schedule until they are reassigned.
    if (
        shift &&
        (shift.status !== "Active" || shift.isDeleted === true)
    ) {
        shift = null;
    }
    if (!shift) {
        // Fallback synthetic shift from policy
        shift = {
            _id: null,
            shiftName: "Policy Default",
            startTime: policy.officeStartTime || "09:00",
            endTime: policy.officeEndTime || "18:00",
            lateGraceMinutes: policy.gracePeriodMinutes || 10,
            earlyLeaveGraceMinutes: policy.earlyLeaveThresholdMinutes || 0,
            overtimeAfterMinutes: policy.overtimeAfterMinutes || 30,
            minimumWorkingMinutes: policy.minimumWorkingMinutes || 480,
            weeklyOff: policy.weeklyOff || [],
            shiftType: "Regular"
        };
    }

    const { branchId, branch } = await resolveEmployeeBranch(employee);

    return {
        employee,
        companyId,
        timezone,
        policy,
        now,
        workDate,
        weekday,
        attendanceDate,
        shift,
        branch,
        branchId
    };
};

const findApprovedLeave = async (employeeId, workDateStr, timezone) => {
    const dayStart = startOfWorkDay(workDateStr, timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    return Leave.findOne({
        employeeId,
        approvalStatus: "Approved",
        isDeleted: { $ne: true },
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart }
    }).lean();
};

// An assigned shift owns its weekly-off list: clearing every day on the shift
// means "no weekly off". The policy default only applies to the synthetic
// shift used when the employee has no active shift assigned.
const weeklyOffDays = (shift, policy) => {
    if (shift && shift._id) return shift.weeklyOff || [];
    return (policy && policy.weeklyOff) || [];
};

const isWeeklyOff = (shift, policy, weekday) =>
    weeklyOffDays(shift, policy).map(String).includes(String(weekday));

const scheduledWindow = (workDate, shift, timezone) => {
    const night = isNightShiftTimes(shift.startTime, shift.endTime);
    const scheduledIn = combineWorkDateAndTime(
        workDate,
        shift.startTime,
        timezone
    );
    const scheduledOut = combineWorkDateAndTime(
        workDate,
        shift.endTime,
        timezone,
        { nextDay: night }
    );
    return { scheduledIn, scheduledOut, night };
};

const computeLateMinutes = ({ checkInAt, scheduledIn, shift, policy }) => {
    const grace =
        Number(shift.lateGraceMinutes) >= 0
            ? Number(shift.lateGraceMinutes)
            : Number(policy.gracePeriodMinutes) || 0;
    const thresholdExtra = Number(policy.lateThresholdMinutes) || 0;
    const allowedMs = (grace + thresholdExtra) * 60 * 1000;
    const diff = checkInAt - scheduledIn - allowedMs;
    if (diff <= 0) return 0;
    return Math.floor(diff / (1000 * 60));
};

const recomputeDurations = (attendance, { shift, policy, now = new Date() } = {}) => {
    const checkIn = attendance.checkIn ? new Date(attendance.checkIn) : null;
    const checkOut = attendance.checkOut ? new Date(attendance.checkOut) : null;
    const breakMinutes = sumBreakMinutes(attendance.breaks || [], checkOut || now);

    attendance.breakMinutes = breakMinutes;

    if (!checkIn) {
        attendance.grossWorkedMinutes = 0;
        attendance.actualWorkedMinutes = 0;
        attendance.workingMinutes = 0;
        attendance.workingHours = 0;
        return attendance;
    }

    const end = checkOut || now;
    const gross = minutesBetween(checkIn, end);
    const actual = Math.max(gross - breakMinutes, 0);
    attendance.grossWorkedMinutes = gross;
    attendance.actualWorkedMinutes = actual;
    attendance.workingMinutes = actual;
    attendance.workingHours = Number((actual / 60).toFixed(2));

    if (checkOut && attendance.scheduledOut) {
        const earlyGrace =
            Number(shift?.earlyLeaveGraceMinutes) >= 0
                ? Number(shift.earlyLeaveGraceMinutes)
                : Number(policy?.earlyLeaveThresholdMinutes) || 0;
        const earlyMs =
            new Date(attendance.scheduledOut) - checkOut - earlyGrace * 60 * 1000;
        attendance.earlyLeaveMinutes =
            earlyMs > 0 ? Math.floor(earlyMs / (1000 * 60)) : 0;
        attendance.leftEarly = attendance.earlyLeaveMinutes > 0;

        const otAfter =
            Number(shift?.overtimeAfterMinutes) >= 0
                ? Number(shift.overtimeAfterMinutes)
                : Number(policy?.overtimeAfterMinutes) || 0;
        const otMs =
            checkOut -
            new Date(attendance.scheduledOut) -
            otAfter * 60 * 1000;
        const potential = otMs > 0 ? Math.floor(otMs / (1000 * 60)) : 0;
        if (policy?.overtimeEnabled === false) {
            attendance.overtimeMinutes = 0;
        } else {
            attendance.overtimeMinutes = potential;
        }
        attendance.overtimeHours = Number(
            (attendance.overtimeMinutes / 60).toFixed(2)
        );
        attendance.isOvertime = attendance.overtimeMinutes > 0;

        if (attendance.earlyLeaveMinutes > 0) {
            attendance.checkOutStatus = "Early Leave";
        } else if (attendance.overtimeMinutes > 0) {
            attendance.checkOutStatus = "Overtime";
        } else {
            attendance.checkOutStatus = "Completed";
        }

        const minWork =
            Number(shift?.minimumWorkingMinutes) ||
            Number(policy?.minimumWorkingMinutes) ||
            480;
        const half =
            Number(policy?.halfDayThresholdMinutes) || Math.floor(minWork / 2);

        if (actual < half) {
            attendance.attendanceStatus = "Half Day";
        } else if (attendance.isLate) {
            attendance.attendanceStatus = "Late";
        } else {
            attendance.attendanceStatus = "Present";
        }
    } else if (checkIn && !checkOut) {
        // Open day: Incomplete, but keep Late visible when applicable
        attendance.attendanceStatus = attendance.isLate ? "Late" : "Incomplete";
        if (!attendance.checkOutStatus || attendance.checkOutStatus === "Completed") {
            attendance.checkOutStatus = "Manual";
        }
    }

    return attendance;
};

const scheduledMinutesOf = (row) => {
    if (row?.scheduledIn && row?.scheduledOut) {
        const mins = minutesBetween(row.scheduledIn, row.scheduledOut);
        if (mins > 0) return mins;
    }
    const shift = row?.shiftId;
    if (shift?.startTime && shift?.endTime) {
        const [sh, sm] = String(shift.startTime).split(":").map(Number);
        const [eh, em] = String(shift.endTime).split(":").map(Number);
        if ([sh, sm, eh, em].every((n) => Number.isFinite(n))) {
            let mins = eh * 60 + em - (sh * 60 + sm);
            if (mins <= 0) mins += 24 * 60;
            return mins;
        }
    }
    return Number(row?.minimumWorkingMinutes) || 480;
};

const lateMinutesOf = (row) => {
    const stored = Number(row?.lateMinutes) || 0;
    if (stored > 0) return stored;
    if (!row?.checkIn) return 0;
    if (row?.scheduledIn) {
        const diff = Math.floor(
            (new Date(row.checkIn) - new Date(row.scheduledIn)) / 60000
        );
        if (diff > 0) return diff;
    }
    const shift = row?.shiftId && typeof row.shiftId === "object" ? row.shiftId : null;
    const workDate = String(row?.workDate || "").slice(0, 10);
    if (shift?.startTime && /^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        const [sh, sm] = String(shift.startTime).split(":").map(Number);
        if (Number.isFinite(sh) && Number.isFinite(sm)) {
            const [y, mo, d] = workDate.split("-").map(Number);
            const planned = new Date(y, mo - 1, d, sh, sm || 0, 0, 0);
            const diff = Math.floor((new Date(row.checkIn) - planned) / 60000);
            if (diff > 0) return diff;
        }
    }
    return 0;
};

const classifyDay = (row) => {
    const status = String(row?.attendanceStatus || "");
    const off = ["Leave", "Absent", "Holiday", "Weekend"].includes(status);
    const checkIn = Boolean(row?.checkIn);
    const checkOut = Boolean(row?.checkOut);
    const worked = Number(row?.actualWorkedMinutes || row?.workingMinutes) || 0;
    const lateMinutes = lateMinutesOf(row);
    const early = Number(row?.earlyLeaveMinutes) || 0;
    const scheduledMin = scheduledMinutesOf(row);
    const showedUp = checkIn && !off;
    const late = showedUp && (row?.isLate === true || lateMinutes > 0);
    const incomplete =
        showedUp &&
        (!checkOut ||
            early > 0 ||
            row?.leftEarly === true ||
            String(row?.checkOutStatus || "") === "Early Leave" ||
            worked + 15 < scheduledMin);
    const halfDay =
        showedUp &&
        (status === "Half Day" ||
            (checkOut && worked < Math.floor(scheduledMin / 2)));
    const overtimeMinutes = Number(row?.overtimeMinutes) || 0;
    return {
        punched: checkIn || status === "Leave",
        present: showedUp,
        late,
        incomplete,
        complete: showedUp && !incomplete,
        halfDay,
        leave: status === "Leave",
        absent: status === "Absent",
        holiday: status === "Holiday",
        weeklyOff: status === "Weekend",
        worked,
        lateMinutes: showedUp ? lateMinutes : 0,
        earlyLeaveMinutes: early,
        overtimeMinutes,
        overtime: overtimeMinutes > 0
    };
};

const findTodayAttendance = async (employeeId, workDate, attendanceDate) => {
    let doc = await Attendance.findOne({
        employeeId,
        workDate,
        ...NOT_DELETED
    });
    if (!doc) {
        doc = await Attendance.findOne({
            employeeId,
            attendanceDate,
            ...NOT_DELETED
        });
    }
    return doc;
};

const populateAttendance = (q) =>
    q
        .populate(
            "shiftId",
            "shiftCode shiftName startTime endTime shiftType lateGraceMinutes minimumWorkingMinutes earlyLeaveGraceMinutes"
        )
        .populate("branchId", "branchCode name")
        .populate("policyId", "policyCode policyName gracePeriodMinutes");

/**
 * Lightweight employee link probe for self-service punch screens.
 */
const getMyEmployee = async (user) => {
    const employee = await resolveEmployeeFromUser(user, { requireActive: false });
    const { branchId, branch } = await resolveEmployeeBranch(employee);
    return {
        id: employee._id,
        employeeCode: employee.employeeCode,
        fullName:
            employee.fullName ||
            `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
        branchId,
        branchName: branchNameOf(branch),
        isActive: employee.isActive !== false,
        employmentStatus: employee.employmentStatus || "Active"
    };
};

/**
 * Today's attendance card for Flutter (employee self).
 */
const getMyToday = async (user, companyIdOverride = null) => {
    const ctx = await loadContext(user, companyIdOverride);
    const {
        employee,
        companyId,
        shift,
        policy,
        workDate,
        weekday,
        attendanceDate,
        timezone,
        now,
        branch,
        branchId
    } = ctx;

    const attendance = await findTodayAttendance(
        employee._id,
        workDate,
        attendanceDate
    );
    if (attendance) {
        recomputeDurations(attendance, { shift, policy, now });
    }

    const { scheduledIn, scheduledOut } = scheduledWindow(
        workDate,
        shift,
        timezone
    );
    const leave = await findApprovedLeave(employee._id, workDate, timezone);
    const weeklyOff = isWeeklyOff(shift, policy, weekday);
    const holiday = await holidayService.findHolidayForWorkDate(
        workDate,
        branchId,
        employee._id,
        companyId
    );

    return {
        timezone,
        workDate,
        weekday,
        serverTime: now.toISOString(),
        employee: {
            id: employee._id,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName || `${employee.firstName} ${employee.lastName}`,
            branchId,
            branchName: branchNameOf(branch)
        },
        branch: {
            id: branchId,
            name: branchNameOf(branch)
        },
        shift: {
            id: shift._id || null,
            name: shift.shiftName,
            startTime: shift.startTime,
            endTime: shift.endTime,
            lateGraceMinutes: shift.lateGraceMinutes,
            weeklyOff: shift.weeklyOff || []
        },
        policy: {
            id: policy._id,
            name: policy.policyName,
            gracePeriodMinutes: policy.gracePeriodMinutes,
            selfieRequired: policy.selfieRequired,
            overtimeEnabled: policy.overtimeEnabled,
            overtimeRequiresApproval: policy.overtimeRequiresApproval,
            allowCheckInOnLeave: policy.allowCheckInOnLeave,
            allowCheckInOnHoliday: policy.allowCheckInOnHoliday,
            allowCheckInOnWeeklyOff: policy.allowCheckInOnWeeklyOff
        },
        scheduledIn,
        scheduledOut,
        flags: {
            isWeeklyOff: weeklyOff,
            weeklyOffSource: weeklyOff ? (shift._id ? "shift" : "policy") : null,
            isOnLeave: Boolean(leave),
            leaveDuration: leave?.leaveDuration || null,
            isHoliday: Boolean(holiday),
            holidayName: holiday?.holidayName || null,
            holidayType: holiday?.holidayType || null
        },
        attendance: attendance || null,
        actions: {
            canCheckIn:
                !attendance?.checkIn &&
                (!leave ||
                    leave.leaveDuration !== "Full Day" ||
                    policy.allowCheckInOnLeave) &&
                (!weeklyOff || policy.allowCheckInOnWeeklyOff) &&
                (!holiday || policy.allowCheckInOnHoliday),
            canCheckOut: Boolean(attendance?.checkIn && !attendance?.checkOut),
            canStartBreak: Boolean(
                attendance?.checkIn &&
                    !attendance?.checkOut &&
                    !getActiveBreak(attendance?.breaks)
            ),
            canEndBreak: Boolean(
                attendance?.checkIn &&
                    !attendance?.checkOut &&
                    getActiveBreak(attendance?.breaks)
            ),
            canRequestOvertime: Boolean(
                attendance?.checkOut &&
                    policy.overtimeEnabled !== false &&
                    policy.overtimeRequiresApproval !== false &&
                    (Number(attendance.overtimeMinutes) || 0) > 0 &&
                    (Number(attendance.approvedOvertimeMinutes) || 0) <
                        (Number(attendance.overtimeMinutes) || 0)
            )
        }
    };
};

const checkIn = async (user, payload = {}, meta = {}) => {
    const ctx = await loadContext(user);
    const {
        employee,
        companyId,
        shift,
        policy,
        workDate,
        weekday,
        attendanceDate,
        timezone,
        now,
        branch,
        branchId
    } = ctx;

    const existing = await findTodayAttendance(
        employee._id,
        workDate,
        attendanceDate
    );
    if (existing?.checkIn) {
        throw new AppError("Already checked in for this workday.", 400);
    }

    const leave = await findApprovedLeave(employee._id, workDate, timezone);
    if (leave && leave.leaveDuration === "Full Day" && !policy.allowCheckInOnLeave) {
        throw new AppError(
            "Cannot check in on an approved full-day leave.",
            400
        );
    }

    const weeklyOff = isWeeklyOff(shift, policy, weekday);
    if (weeklyOff && !policy.allowCheckInOnWeeklyOff) {
        throw new AppError(
            `Cannot check in on weekly off (${weekday}).`,
            400
        );
    }

    const holiday = await holidayService.findHolidayForWorkDate(
        workDate,
        branchId,
        employee._id,
        companyId
    );
    if (holiday && !policy.allowCheckInOnHoliday) {
        throw new AppError(
            `Cannot check in on holiday: ${holiday.holidayName}.`,
            400
        );
    }

    if (policy.selfieRequired && !payload.selfie && !payload.checkInSelfie) {
        throw new AppError("Check-in selfie is required by policy.", 400);
    }

    const { scheduledIn, scheduledOut } = scheduledWindow(
        workDate,
        shift,
        timezone
    );
    const lateMinutes = computeLateMinutes({
        checkInAt: now,
        scheduledIn,
        shift,
        policy
    });

    const attendanceCode = await generateAttendanceCode();
    const doc = existing || new Attendance({});
    doc.companyId = companyId;

    doc.branchId = branchId;
    doc.departmentId = employee.departmentId?._id || employee.departmentId || null;
    doc.designationId =
        employee.designationId?._id || employee.designationId || null;
    doc.shiftId = shift._id || null;
    doc.policyId = policy._id;
    doc.employeeId = employee._id;
    doc.userId = user._id;
    doc.employeeCode = employee.employeeCode;
    doc.employeeName =
        employee.fullName || `${employee.firstName} ${employee.lastName}`;
    doc.branchName = branchNameOf(branch || employee.branchId);
    doc.departmentName =
        employee.departmentId?.departmentName || doc.departmentName || "";
    doc.designationName =
        employee.designationId?.designationName || doc.designationName || "";
    doc.shiftName = shift.shiftName || "";
    doc.attendanceDate = attendanceDate;
    doc.workDate = workDate;
    doc.dayName = weekday;
    doc.month = Number(workDate.slice(5, 7));
    doc.year = Number(workDate.slice(0, 4));
    doc.attendanceCode = attendanceCode;
    doc.checkIn = now;
    doc.checkOut = null;
    doc.scheduledIn = scheduledIn;
    doc.scheduledOut = scheduledOut;
    doc.lateMinutes = lateMinutes;
    doc.isLate = lateMinutes > 0;
    doc.checkInStatus = lateMinutes > 0 ? "Late" : "On Time";
    doc.attendanceStatus = lateMinutes > 0 ? "Late" : "Incomplete";
    doc.attendanceSource = payload.source || "Mobile App";
    doc.deviceId = payload.deviceId || meta.deviceId || "";
    doc.deviceName = payload.deviceName || "";
    doc.ipAddress = meta.ipAddress || payload.ipAddress || "";
    doc.checkInSelfie = payload.selfie || payload.checkInSelfie || "";
    doc.checkInPlatform = payload.platform || meta.platform || "";
    doc.checkInAppVersion = payload.appVersion || "";
    doc.isWeekend = weeklyOff;
    doc.isLeave = Boolean(leave);
    doc.isHoliday = Boolean(holiday);
    if (holiday && !doc.checkIn) {
        // Should not happen when policy blocks — if allowed, mark Remote/Present path
    }
    doc.breaks = doc.breaks || [];
    doc.createdBy = user._id;
    doc.updatedBy = user._id;
    doc.isDeleted = false;

    recomputeDurations(doc, { shift, policy, now });
    await saveAttendanceDoc(doc);

    // Touch employee lastAttendance if field exists
    try {
        employee.lastAttendance = now;
        await employee.save();
    } catch (_) {
        /* ignore */
    }

    await writeActivityLog({
        user,
        branchId: doc.branchId,
        activityType: "Create",
        module: "Attendance",
        subModule: "CheckIn",
        description: `Employee ${doc.employeeCode} checked in (${doc.workDate})`,
        referenceType: "Attendance",
        referenceId: doc._id,
        newData: {
            checkIn: doc.checkIn,
            lateMinutes: doc.lateMinutes,
            status: doc.attendanceStatus,
            deviceId: doc.deviceId
        },
        ipAddress: meta.ipAddress || "",
        userAgent: meta.userAgent || "",
        securityLevel: "Sensitive"
    });

    return populateAttendance(Attendance.findById(doc._id));
};

const checkOut = async (user, payload = {}, meta = {}) => {
    const ctx = await loadContext(user);
    const { employee, shift, policy, workDate, attendanceDate, now } = ctx;

    const doc = await findTodayAttendance(
        employee._id,
        workDate,
        attendanceDate
    );
    if (!doc || !doc.checkIn) {
        throw new AppError("No active check-in found for today.", 400);
    }
    if (String(doc.employeeId) !== String(employee._id)) {
        throw new AppError("You can only check out your own attendance.", 403);
    }
    if (doc.checkOut) {
        throw new AppError("Already checked out for this workday.", 400);
    }

    const activeBreak = getActiveBreak(doc.breaks);
    if (activeBreak) {
        throw new AppError(
            "End your active break before checking out.",
            400
        );
    }

    if (policy.selfieRequired && !payload.selfie && !payload.checkOutSelfie) {
        throw new AppError("Check-out selfie is required by policy.", 400);
    }

    if (now < new Date(doc.checkIn)) {
        throw new AppError("Check-out time cannot be before check-in.", 400);
    }

    doc.checkOut = now;
    doc.checkOutDeviceId = payload.deviceId || meta.deviceId || "";
    doc.checkOutSelfie = payload.selfie || payload.checkOutSelfie || "";
    doc.checkOutPlatform = payload.platform || meta.platform || "";
    doc.checkOutAppVersion = payload.appVersion || "";
    doc.updatedBy = user._id;

    // Close any open break durations already validated none active
    for (const b of doc.breaks || []) {
        if (b.endTime && !b.durationMinutes) {
            b.durationMinutes = minutesBetween(b.startTime, b.endTime);
        }
    }

    recomputeDurations(doc, { shift, policy, now });
    const { applyAutoApprovedOvertime } = require("./overtimeService");
    applyAutoApprovedOvertime(doc, policy);
    doc.markModified("breaks");
    await saveAttendanceDoc(doc);

    await writeActivityLog({
        user,
        branchId: doc.branchId,
        activityType: "Update",
        module: "Attendance",
        subModule: "CheckOut",
        description: `Employee ${doc.employeeCode} checked out (${doc.workDate})`,
        referenceType: "Attendance",
        referenceId: doc._id,
        newData: {
            checkOut: doc.checkOut,
            actualWorkedMinutes: doc.actualWorkedMinutes,
            earlyLeaveMinutes: doc.earlyLeaveMinutes,
            overtimeMinutes: doc.overtimeMinutes,
            approvedOvertimeMinutes: doc.approvedOvertimeMinutes,
            status: doc.attendanceStatus
        },
        ipAddress: meta.ipAddress || "",
        userAgent: meta.userAgent || "",
        securityLevel: "Sensitive"
    });

    return populateAttendance(Attendance.findById(doc._id));
};

const startBreak = async (user, payload = {}, meta = {}) => {
    const ctx = await loadContext(user);
    const { employee, shift, policy, workDate, attendanceDate, now } = ctx;

    const doc = await findTodayAttendance(
        employee._id,
        workDate,
        attendanceDate
    );
    if (!doc?.checkIn) {
        throw new AppError("Check in before starting a break.", 400);
    }
    if (doc.checkOut) {
        throw new AppError("Cannot start a break after check-out.", 400);
    }
    if (getActiveBreak(doc.breaks)) {
        throw new AppError("A break is already in progress.", 400);
    }

    const type = ["lunch", "prayer", "personal", "other"].includes(payload.type)
        ? payload.type
        : "other";

    doc.breaks = doc.breaks || [];
    doc.breaks.push({
        startTime: now,
        endTime: null,
        durationMinutes: 0,
        type
    });
    doc.updatedBy = user._id;
    recomputeDurations(doc, { shift, policy, now });
    doc.markModified("breaks");
    await saveAttendanceDoc(doc);

    await writeActivityLog({
        user,
        branchId: doc.branchId,
        activityType: "Update",
        module: "Attendance",
        subModule: "BreakStart",
        description: `Break started (${type}) for ${doc.employeeCode}`,
        referenceType: "Attendance",
        referenceId: doc._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "Normal"
    });

    return populateAttendance(Attendance.findById(doc._id));
};

const endBreak = async (user, meta = {}) => {
    const ctx = await loadContext(user);
    const { employee, shift, policy, workDate, attendanceDate, now } = ctx;

    const doc = await findTodayAttendance(
        employee._id,
        workDate,
        attendanceDate
    );
    if (!doc?.checkIn) {
        throw new AppError("No active attendance found.", 400);
    }
    const active = getActiveBreak(doc.breaks);
    if (!active) {
        throw new AppError("No active break to end.", 400);
    }
    if (now < new Date(active.startTime)) {
        throw new AppError("Invalid break end time.", 400);
    }

    active.endTime = now;
    active.durationMinutes = minutesBetween(active.startTime, now);
    doc.updatedBy = user._id;
    recomputeDurations(doc, { shift, policy, now });
    doc.markModified("breaks");
    await saveAttendanceDoc(doc);

    await writeActivityLog({
        user,
        branchId: doc.branchId,
        activityType: "Update",
        module: "Attendance",
        subModule: "BreakEnd",
        description: `Break ended (${active.durationMinutes}m) for ${doc.employeeCode}`,
        referenceType: "Attendance",
        referenceId: doc._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "Normal"
    });

    return populateAttendance(Attendance.findById(doc._id));
};

const getMyHistory = async (user, query = {}) => {
    const employee = await resolveEmployeeFromUser(user, {
        requireActive: false
    });
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { employeeId: employee._id, ...NOT_DELETED };
    if (query.workDate || query.date) {
        filter.workDate = String(query.workDate || query.date);
    } else if (query.year && query.month) {
        const year = Number(query.year);
        const month = Number(query.month);
        const mm = String(month).padStart(2, "0");
        const start = `${year}-${mm}-01`;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
        filter.$or = [
            { year, month },
            { workDate: { $gte: start, $lt: end } }
        ];
    } else if (query.year) {
        const year = Number(query.year);
        filter.$or = [
            { year },
            { workDate: { $regex: `^${year}-` } }
        ];
    } else if (query.month) {
        filter.month = Number(query.month);
    }
    if (query.status) filter.attendanceStatus = query.status;

    const [items, total] = await Promise.all([
        populateAttendance(
            Attendance.find(filter)
                .sort({ attendanceDate: -1 })
                .skip(skip)
                .limit(limit)
        ),
        Attendance.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

const getMyMonthlySummary = async (user, query = {}) => {
    const employee = await resolveEmployeeFromUser(user, {
        requireActive: false
    });
    const companyId = await ensureUserCompany(user);
    const timezone = await settingsService.getTimezone(companyId);
    const now = new Date();
    const workDate = formatWorkDate(now, timezone);
    const year = Number(query.year) || Number(workDate.slice(0, 4));
    const month = Number(query.month) || Number(workDate.slice(5, 7));

    const mm = String(month).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

    const rows = await Attendance.find({
        employeeId: employee._id,
        ...companyFilter(companyId),
        ...NOT_DELETED,
        $or: [
            { year, month },
            { workDate: { $gte: start, $lt: end } }
        ]
    })
        .populate(
            "shiftId",
            "shiftCode shiftName startTime endTime lateGraceMinutes minimumWorkingMinutes"
        )
        .lean();

    const summary = {
        year,
        month,
        present: 0,
        late: 0,
        absent: 0,
        halfDay: 0,
        leave: 0,
        holiday: 0,
        weeklyOff: 0,
        incomplete: 0,
        complete: 0,
        overtimeDays: 0,
        totalWorkingMinutes: 0,
        totalLateMinutes: 0,
        totalEarlyLeaveMinutes: 0,
        totalOvertimeMinutes: 0,
        approvedOvertimeMinutes: 0,
        punched: 0,
        records: rows.length
    };

    for (const r of rows) {
        const day = classifyDay(r);
        if (day.punched) summary.punched += 1;
        if (day.present) summary.present += 1;
        if (day.late) summary.late += 1;
        if (day.absent) summary.absent += 1;
        if (day.halfDay) summary.halfDay += 1;
        if (day.leave) summary.leave += 1;
        if (day.holiday) summary.holiday += 1;
        if (day.weeklyOff) summary.weeklyOff += 1;
        if (day.incomplete) summary.incomplete += 1;
        if (day.complete) summary.complete += 1;
        if (day.overtime) summary.overtimeDays += 1;
        summary.totalWorkingMinutes += day.worked;
        summary.totalLateMinutes += day.lateMinutes;
        summary.totalEarlyLeaveMinutes += day.earlyLeaveMinutes;
        summary.totalOvertimeMinutes += day.overtimeMinutes;
        summary.approvedOvertimeMinutes +=
            Number(r.approvedOvertimeMinutes) || 0;
    }

    summary.totalWorkingHours = Number(
        (summary.totalWorkingMinutes / 60).toFixed(2)
    );
    summary.approvedOvertimeHours = Number(
        (summary.approvedOvertimeMinutes / 60).toFixed(2)
    );

    return summary;
};

/** Owner/admin list with filters */
const listAttendance = async (query = {}, managedBranchIds = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { ...NOT_DELETED, ...tenant };

    const { applyBranchScopeFilter } = require("../middleware/hrAccess");
    applyBranchScopeFilter(
        filter,
        managedBranchIds,
        query.branchId && toObjectId(query.branchId)
            ? toObjectId(query.branchId)
            : null
    );

    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }
    if (query.shiftId && toObjectId(query.shiftId)) {
        filter.shiftId = toObjectId(query.shiftId);
    }
    if (query.status) filter.attendanceStatus = query.status;
    if (query.workDate) filter.workDate = String(query.workDate);
    if (query.date) {
        filter.workDate = String(query.date);
    }
    if (query.month) filter.month = Number(query.month);
    if (query.year) filter.year = Number(query.year);

    const [items, total] = await Promise.all([
        populateAttendance(
            Attendance.find(filter)
                .sort({ attendanceDate: -1, checkIn: -1 })
                .skip(skip)
                .limit(limit)
        ),
        Attendance.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

/** Owner/admin: get one attendance by id (scoped) */
const getAttendanceById = async (id, managedBranchIds = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const doc = await populateAttendance(
        Attendance.findOne({ _id: id, ...tenant, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Attendance not found.", 404);
    if (managedBranchIds !== null) {
        const { assertBranchInScope } = require("../middleware/hrAccess");
        assertBranchInScope(managedBranchIds, doc.branchId);
    }
    return doc;
};

module.exports = {
    getMyEmployee,
    getMyToday,
    checkIn,
    checkOut,
    startBreak,
    endBreak,
    getMyHistory,
    getMyMonthlySummary,
    getAttendanceById,
    listAttendance,
    recomputeDurations,
    findTodayAttendance
};
