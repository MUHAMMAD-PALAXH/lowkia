const mongoose = require("mongoose");
const Leave = require("../model/leave");
const Employee = require("../model/employee");
const Attendance = require("../model/attendance");
const { generateLeaveCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const {
    createTrashOps,
    isTrashQuery,
    resolveEntitySort
} = require("../utils/softDeleteTrash");
const settingsService = require("./settingsService");
const { resolveEmployeeFromUser } = require("../middleware/hrAccess");
const { eachWorkDate } = require("../utils/workDates");
const { startOfWorkDay, formatWeekday } = require("../utils/timezone");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Leave, {
    label: "Leave",
    nameField: "employeeName",
    restoreStatus: false
});

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateLeave = (q) =>
    q
        .populate("employeeId", "employeeCode fullName firstName lastName")
        .populate("branchId", "branchCode name")
        .populate("finalApprovedBy", "firstName lastName email");

/**
 * Create Leave attendance markers for each day in an approved leave.
 * Does not overwrite days that already have a check-in.
 */
const syncLeaveToAttendance = async (leave, actorId = null) => {
    if (!leave || leave.approvalStatus !== "Approved") return leave;

    const companyId = leave.companyId;
    const timezone = await settingsService.getTimezone(companyId);
    const workDates = eachWorkDate(leave.startDate, leave.endDate, timezone);
    const employee = await Employee.findOne({
        _id: leave.employeeId,
        ...companyFilter(companyId)
    });
    if (!employee) return leave;

    const recordIds = [...(leave.attendanceRecordIds || []).map(String)];

    for (const workDate of workDates) {
        const attendanceDate = startOfWorkDay(workDate, timezone);
        const weekday = formatWeekday(attendanceDate, timezone);

        let att = await Attendance.findOne({
            employeeId: leave.employeeId,
            workDate,
            ...companyFilter(companyId),
            ...NOT_DELETED
        });

        if (!att) {
            att = await Attendance.findOne({
                employeeId: leave.employeeId,
                attendanceDate,
                ...companyFilter(companyId),
                ...NOT_DELETED
            });
        }

        if (att?.checkIn) {
            // Already worked that day — keep record, just flag leave overlap
            att.isLeave = true;
            att.updatedBy = actorId || null;
            await att.save();
            if (!recordIds.includes(String(att._id))) {
                recordIds.push(String(att._id));
            }
            continue;
        }

        if (!att) {
            att = new Attendance(
                stampCompany(
                    {
                branchId: leave.branchId || employee.branchId,
                departmentId: leave.departmentId || employee.departmentId,
                designationId: employee.designationId,
                shiftId: employee.shiftId,
                employeeId: employee._id,
                userId: employee.userId,
                employeeCode: employee.employeeCode,
                employeeName:
                    employee.fullName ||
                    `${employee.firstName} ${employee.lastName}`,
                branchName: "",
                attendanceDate,
                workDate,
                dayName: weekday,
                month: Number(workDate.slice(5, 7)),
                year: Number(workDate.slice(0, 4)),
                attendanceStatus: "Leave",
                isLeave: true,
                checkInStatus: "Manual",
                checkOutStatus: "Manual",
                attendanceSource: "Manual",
                createdBy: actorId || null,
                updatedBy: actorId || null
                    },
                    companyId
                )
            );
        } else {
            att.attendanceStatus = "Leave";
            att.isLeave = true;
            att.workDate = workDate;
            att.updatedBy = actorId || null;
        }

        // Half-day leave: still mark Leave but allow later check-in if policy allows
        if (leave.leaveDuration === "Half Day") {
            att.managerRemarks = `Half day leave (${leave.halfDayType || ""})`.trim();
        }

        await att.save();
        if (!recordIds.includes(String(att._id))) {
            recordIds.push(String(att._id));
        }
    }

    leave.attendanceUpdated = true;
    leave.attendanceRecordIds = recordIds.map((id) => toObjectId(id)).filter(Boolean);
    await leave.save();
    return leave;
};

/**
 * Soft-clear Leave-only attendance markers when leave is cancelled/rejected.
 */
const unsyncLeaveAttendance = async (leave, actorId = null) => {
    const ids = leave.attendanceRecordIds || [];
    if (!ids.length) return leave;

    for (const id of ids) {
        const att = await Attendance.findOne({ _id: id, ...NOT_DELETED });
        if (!att) continue;
        if (att.checkIn) {
            att.isLeave = false;
            att.updatedBy = actorId || null;
            await att.save();
            continue;
        }
        if (att.attendanceStatus === "Leave") {
            att.isDeleted = true;
            att.deletedAt = new Date();
            att.deletedBy = actorId || null;
            att.updatedBy = actorId || null;
            await att.save();
        }
    }

    leave.attendanceUpdated = false;
    leave.attendanceRecordIds = [];
    await leave.save();
    return leave;
};

const createLeaveRequest = async (
    user,
    payload = {},
    { asAdmin = false } = {},
    companyIdArg = null
) => {
    const companyId = companyIdArg || (await ensureUserCompany(user));
    const tenant = companyFilter(companyId);
    let employee;
    if (asAdmin && payload.employeeId) {
        employee = await Employee.findOne({
            _id: payload.employeeId,
            ...tenant,
            ...NOT_DELETED
        });
        if (!employee) throw new AppError("Employee not found.", 404);
    } else {
        employee = await resolveEmployeeFromUser(user);
        assertDocumentCompany(employee, companyId, "Employee");
    }

    const leaveType = payload.leaveType;
    if (!leaveType) throw new AppError("Leave type is required.", 400);
    if (!payload.startDate || !payload.endDate) {
        throw new AppError("Start date and end date are required.", 400);
    }
    if (!payload.reason || !String(payload.reason).trim()) {
        throw new AppError("Reason is required.", 400);
    }

    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (endDate < startDate) {
        throw new AppError("End date cannot be before start date.", 400);
    }

    // Overlap with another pending/approved leave
    const overlap = await Leave.findOne({
        ...tenant,
        employeeId: employee._id,
        approvalStatus: { $in: ["Pending", "Approved"] },
        isDeleted: { $ne: true },
        startDate: { $lte: endDate },
        endDate: { $gte: startDate }
    });
    if (overlap) {
        throw new AppError(
            "Overlapping leave request already exists for these dates.",
            409
        );
    }

    const leaveCategory =
        leaveType === "Unpaid Leave" ? "Unpaid" : payload.leaveCategory || "Paid";

    const doc = await Leave.create(
        stampCompany(
            {
        branchId: employee.branchId,
        departmentId: employee.departmentId || null,
        employeeId: employee._id,
        employeeCode: employee.employeeCode,
        employeeName:
            employee.fullName || `${employee.firstName} ${employee.lastName}`,
        leaveType,
        leaveCategory,
        startDate,
        endDate,
        leaveDuration: payload.leaveDuration || "Full Day",
        halfDayType: payload.halfDayType || undefined,
        reason: String(payload.reason).trim(),
        employeeNote: payload.employeeNote || "",
        approvalStatus: "Pending",
        createdBy: user._id,
        // Optional code stored in notes prefix if schema has no leaveCode
        notes: payload.notes || `REF:${await generateLeaveCode()}`
            },
            companyId
        )
    );

    return populateLeave(Leave.findById(doc._id));
};

const getLeaves = async (
    query = {},
    user = null,
    { selfOnly = false, managedBranchIds = null } = {},
    companyIdArg = null
) => {
    const companyId = companyIdArg || (user ? await ensureUserCompany(user) : null);
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };

    if (selfOnly && user) {
        const employee = await resolveEmployeeFromUser(user, {
            requireActive: false
        });
        filter.employeeId = employee._id;
    } else if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }

    const { applyBranchScopeFilter } = require("../middleware/hrAccess");
    if (!selfOnly) {
        applyBranchScopeFilter(
            filter,
            managedBranchIds,
            query.branchId && toObjectId(query.branchId)
                ? toObjectId(query.branchId)
                : null
        );
    } else if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.leaveType) filter.leaveType = query.leaveType;
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { employeeName: { $regex: s, $options: "i" } },
            { employeeCode: { $regex: s, $options: "i" } },
            { reason: { $regex: s, $options: "i" } }
        ];
    }

    const sort = resolveEntitySort(query, {
        nameField: "employeeName",
        dateField: "createdAt"
    });

    const [items, total] = await Promise.all([
        populateLeave(
            Leave.find(filter).sort(sort).skip(skip).limit(limit)
        ),
        Leave.countDocuments(filter)
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

const getLeaveById = async (id, companyId = null) => {
    const tenant = companyFilter(companyId);
    const doc = await populateLeave(
        Leave.findOne({ _id: id, ...tenant, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Leave request not found.", 404);
    return doc;
};

const approveLeave = async (id, user, comment = "", companyIdArg = null) => {
    const companyId = companyIdArg || (await ensureUserCompany(user));
    const leave = await Leave.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!leave) throw new AppError("Leave request not found.", 404);
    if (leave.approvalStatus !== "Pending") {
        throw new AppError(
            `Cannot approve leave in "${leave.approvalStatus}" status.`,
            400
        );
    }

    leave.approvalStatus = "Approved";
    leave.finalApprovedBy = user._id;
    leave.finalApprovedAt = new Date();
    leave.hrApproval = {
        status: "Approved",
        approvedBy: user._id,
        approvedAt: new Date(),
        comment: comment || ""
    };
    leave.updatedBy = user._id;
    await leave.save();

    await syncLeaveToAttendance(leave, user._id);

    const { writeActivityLog } = require("./activityLogService");
    await writeActivityLog({
        user,
        branchId: leave.branchId,
        activityType: "Approve",
        module: "Leave",
        subModule: "Approve",
        description: `Leave approved for ${leave.employeeCode} (${leave.leaveType})`,
        referenceType: "Leave",
        referenceId: leave._id,
        securityLevel: "Sensitive"
    });

    return getLeaveById(id, companyId);
};

const rejectLeave = async (id, user, reason = "", companyIdArg = null) => {
    const companyId = companyIdArg || (await ensureUserCompany(user));
    const leave = await Leave.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!leave) throw new AppError("Leave request not found.", 404);
    if (leave.approvalStatus !== "Pending") {
        throw new AppError(
            `Cannot reject leave in "${leave.approvalStatus}" status.`,
            400
        );
    }
    if (!String(reason || "").trim()) {
        throw new AppError("Rejection reason is required.", 400);
    }

    leave.approvalStatus = "Rejected";
    leave.finalApprovedBy = user._id;
    leave.hrApproval = {
        status: "Rejected",
        approvedBy: user._id,
        approvedAt: new Date(),
        comment: String(reason).trim()
    };
    leave.notes = String(reason).trim();
    leave.updatedBy = user._id;
    await leave.save();
    return getLeaveById(id, companyId);
};

const cancelLeave = async (
    id,
    user,
    reason = "",
    { asAdmin = false } = {},
    companyIdArg = null
) => {
    const companyId = companyIdArg || (await ensureUserCompany(user));
    const leave = await Leave.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!leave) throw new AppError("Leave request not found.", 404);

    if (!asAdmin) {
        const employee = await resolveEmployeeFromUser(user, {
            requireActive: false
        });
        if (String(leave.employeeId) !== String(employee._id)) {
            throw new AppError("You can only cancel your own leave.", 403);
        }
    }

    if (!["Pending", "Approved"].includes(leave.approvalStatus)) {
        throw new AppError(
            `Cannot cancel leave in "${leave.approvalStatus}" status.`,
            400
        );
    }

    const wasApproved = leave.approvalStatus === "Approved";
    leave.approvalStatus = "Cancelled";
    leave.isCancelled = true;
    leave.cancelledBy = user._id;
    leave.cancelledAt = new Date();
    leave.cancellationReason = reason || "";
    leave.updatedBy = user._id;
    await leave.save();

    if (wasApproved) {
        await unsyncLeaveAttendance(leave, user._id);
    }

    return getLeaveById(id, companyId);
};

const deleteLeave = async (id, actorId = null, companyId = null) => {
    await getLeaveById(id, companyId);
    return trash.softDelete(id, actorId);
};
const restoreLeave = async (id, actorId = null, companyId = null) => {
    companyFilter(companyId);
    const doc = await trash.restore(id, actorId);
    assertDocumentCompany(doc, companyId, "Leave");
    return doc;
};
const permanentDeleteLeave = async (id, companyId = null) => {
    companyFilter(companyId);
    const doc = await Leave.findOne({ _id: id, isDeleted: true });
    assertDocumentCompany(doc, companyId, "Leave");
    return trash.permanentDelete(id);
};
const bulkSoftDeleteLeaves = async (payload, actorId = null, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkSoftDelete(payload, actorId);
};
const bulkRestoreLeaves = async (payload, actorId = null, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkRestore(payload, actorId);
};
const bulkPermanentDeleteLeaves = async (payload, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkPermanentDelete(payload);
};
const trashCount = async (companyId = null) =>
    Leave.countDocuments({
        isDeleted: true,
        ...companyFilter(companyId)
    });

module.exports = {
    createLeaveRequest,
    getLeaves,
    getLeaveById,
    approveLeave,
    rejectLeave,
    cancelLeave,
    syncLeaveToAttendance,
    unsyncLeaveAttendance,
    softDelete: deleteLeave,
    deleteLeave,
    restoreLeave,
    permanentDeleteLeave,
    bulkSoftDelete: bulkSoftDeleteLeaves,
    bulkSoftDeleteLeaves,
    bulkRestore: bulkRestoreLeaves,
    bulkRestoreLeaves,
    bulkPermanentDelete: bulkPermanentDeleteLeaves,
    bulkPermanentDeleteLeaves,
    trashCount
};
