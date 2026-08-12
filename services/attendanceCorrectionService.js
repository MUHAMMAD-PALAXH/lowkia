const mongoose = require("mongoose");
const AttendanceCorrection = require("../model/attendanceCorrection");
const Attendance = require("../model/attendance");
const Shift = require("../model/shift");
const { generateAttendanceCorrectionCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const {
    createTrashOps,
    isTrashQuery,
    resolveEntitySort
} = require("../utils/softDeleteTrash");
const { resolveEmployeeFromUser } = require("../middleware/hrAccess");
const attendancePolicyService = require("./attendancePolicyService");
const { recomputeDurations } = require("./attendanceService");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(AttendanceCorrection, {
    label: "Attendance correction",
    nameField: "correctionCode",
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

const snapshotAttendance = (att) => ({
    checkIn: att.checkIn || null,
    checkOut: att.checkOut || null,
    attendanceStatus: att.attendanceStatus,
    lateMinutes: att.lateMinutes || 0,
    earlyLeaveMinutes: att.earlyLeaveMinutes || 0,
    overtimeMinutes: att.overtimeMinutes || 0,
    breakMinutes: att.breakMinutes || 0,
    grossWorkedMinutes: att.grossWorkedMinutes || 0,
    actualWorkedMinutes: att.actualWorkedMinutes || 0,
    breaks: (att.breaks || []).map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
        durationMinutes: b.durationMinutes,
        type: b.type
    }))
});

const populateCorrection = (q) =>
    q
        .populate("employeeId", "employeeCode fullName firstName lastName")
        .populate("attendanceId")
        .populate("branchId", "branchCode name")
        .populate("reviewedBy", "firstName lastName email")
        .populate("userId", "firstName lastName email");

const loadShiftAndPolicy = async (attendance) => {
    const policy = await attendancePolicyService.getActiveOrDefault();
    let shift = null;
    if (attendance.shiftId) {
        shift = await Shift.findOne({
            _id: attendance.shiftId,
            ...NOT_DELETED
        });
    }
    if (!shift) {
        shift = {
            startTime: policy.officeStartTime || "09:00",
            endTime: policy.officeEndTime || "18:00",
            lateGraceMinutes: policy.gracePeriodMinutes || 10,
            earlyLeaveGraceMinutes: policy.earlyLeaveThresholdMinutes || 0,
            overtimeAfterMinutes: policy.overtimeAfterMinutes || 30,
            minimumWorkingMinutes: policy.minimumWorkingMinutes || 480,
            weeklyOff: policy.weeklyOff || []
        };
    }
    return { shift, policy };
};

const createCorrection = async (user, payload = {}, meta = {}) => {
    const employee = await resolveEmployeeFromUser(user);
    const attendanceId = toObjectId(payload.attendanceId);
    if (!attendanceId) {
        throw new AppError("attendanceId is required.", 400);
    }

    const requestType = payload.requestType;
    const allowed = [
        "checkInCorrection",
        "checkOutCorrection",
        "breakCorrection",
        "statusCorrection"
    ];
    if (!allowed.includes(requestType)) {
        throw new AppError("Invalid requestType.", 400);
    }

    const reason = String(payload.reason || "").trim();
    if (reason.length < 5) {
        throw new AppError("Reason must be at least 5 characters.", 400);
    }

    const attendance = await Attendance.findOne({
        _id: attendanceId,
        ...NOT_DELETED
    });
    if (!attendance) throw new AppError("Attendance not found.", 404);
    if (String(attendance.employeeId) !== String(employee._id)) {
        throw new AppError(
            "You can only request corrections for your own attendance.",
            403
        );
    }

    const pending = await AttendanceCorrection.findOne({
        attendanceId,
        employeeId: employee._id,
        status: "pending",
        ...NOT_DELETED
    });
    if (pending) {
        throw new AppError(
            "A pending correction already exists for this attendance.",
            409
        );
    }

    if (requestType === "checkInCorrection" && !payload.requestedCheckIn) {
        throw new AppError("requestedCheckIn is required.", 400);
    }
    if (requestType === "checkOutCorrection" && !payload.requestedCheckOut) {
        throw new AppError("requestedCheckOut is required.", 400);
    }
    if (requestType === "statusCorrection" && !payload.requestedStatus) {
        throw new AppError("requestedStatus is required.", 400);
    }
    if (
        requestType === "breakCorrection" &&
        !Array.isArray(payload.requestedBreaks)
    ) {
        throw new AppError("requestedBreaks array is required.", 400);
    }

    const correctionCode = await generateAttendanceCorrectionCode();
    const doc = await AttendanceCorrection.create({
        correctionCode,
        branchId: attendance.branchId,
        employeeId: employee._id,
        userId: user._id,
        attendanceId: attendance._id,
        workDate: attendance.workDate || "",
        requestType,
        requestedCheckIn: payload.requestedCheckIn
            ? new Date(payload.requestedCheckIn)
            : null,
        requestedCheckOut: payload.requestedCheckOut
            ? new Date(payload.requestedCheckOut)
            : null,
        requestedStatus: payload.requestedStatus || "",
        requestedBreaks: Array.isArray(payload.requestedBreaks)
            ? payload.requestedBreaks.map((b) => ({
                  startTime: b.startTime ? new Date(b.startTime) : null,
                  endTime: b.endTime ? new Date(b.endTime) : null,
                  durationMinutes: Number(b.durationMinutes) || 0,
                  type: b.type || "other"
              }))
            : [],
        reason,
        status: "pending",
        oldValue: snapshotAttendance(attendance),
        createdBy: user._id
    });

    await writeActivityLog({
        user,
        branchId: attendance.branchId,
        activityType: "Create",
        module: "Attendance",
        subModule: "Correction",
        description: `Correction requested (${requestType}) for ${attendance.workDate || attendance.employeeCode}`,
        referenceType: "AttendanceCorrection",
        referenceId: doc._id,
        oldData: doc.oldValue,
        newData: {
            requestType,
            requestedCheckIn: doc.requestedCheckIn,
            requestedCheckOut: doc.requestedCheckOut,
            requestedStatus: doc.requestedStatus
        },
        ipAddress: meta.ipAddress || ""
    });

    return populateCorrection(AttendanceCorrection.findById(doc._id));
};

const applyCorrectionToAttendance = async (
    correction,
    attendance,
    actorId,
    session = null
) => {
    const { shift, policy } = await loadShiftAndPolicy(attendance);

    switch (correction.requestType) {
        case "checkInCorrection": {
            if (!correction.requestedCheckIn) {
                throw new AppError("requestedCheckIn missing.", 400);
            }
            attendance.checkIn = new Date(correction.requestedCheckIn);
            if (
                attendance.checkOut &&
                attendance.checkIn > attendance.checkOut
            ) {
                throw new AppError(
                    "Corrected check-in cannot be after check-out.",
                    400
                );
            }
            if (attendance.scheduledIn) {
                const grace =
                    Number(shift.lateGraceMinutes) >= 0
                        ? Number(shift.lateGraceMinutes)
                        : Number(policy.gracePeriodMinutes) || 0;
                const threshold = Number(policy.lateThresholdMinutes) || 0;
                const allowedMs = (grace + threshold) * 60 * 1000;
                const diff =
                    attendance.checkIn -
                    new Date(attendance.scheduledIn) -
                    allowedMs;
                attendance.lateMinutes =
                    diff > 0 ? Math.floor(diff / (1000 * 60)) : 0;
                attendance.isLate = attendance.lateMinutes > 0;
                attendance.checkInStatus = attendance.isLate
                    ? "Late"
                    : "On Time";
            } else {
                attendance.checkInStatus = "Manual";
            }
            break;
        }
        case "checkOutCorrection": {
            if (!correction.requestedCheckOut) {
                throw new AppError("requestedCheckOut missing.", 400);
            }
            if (!attendance.checkIn) {
                throw new AppError(
                    "Cannot set check-out without check-in.",
                    400
                );
            }
            attendance.checkOut = new Date(correction.requestedCheckOut);
            if (attendance.checkOut < attendance.checkIn) {
                throw new AppError(
                    "Corrected check-out cannot be before check-in.",
                    400
                );
            }
            break;
        }
        case "breakCorrection": {
            attendance.breaks = (correction.requestedBreaks || []).map((b) => {
                const start = b.startTime ? new Date(b.startTime) : null;
                const end = b.endTime ? new Date(b.endTime) : null;
                let duration = Number(b.durationMinutes) || 0;
                if (start && end && !duration) {
                    duration = Math.max(
                        0,
                        Math.floor((end - start) / (1000 * 60))
                    );
                }
                return {
                    startTime: start,
                    endTime: end,
                    durationMinutes: duration,
                    type: b.type || "other"
                };
            });
            attendance.markModified("breaks");
            break;
        }
        case "statusCorrection": {
            if (!correction.requestedStatus) {
                throw new AppError("requestedStatus missing.", 400);
            }
            attendance.attendanceStatus = correction.requestedStatus;
            break;
        }
        default:
            throw new AppError("Unsupported requestType.", 400);
    }

    if (correction.requestType !== "statusCorrection") {
        recomputeDurations(attendance, {
            shift,
            policy,
            now: attendance.checkOut || new Date()
        });
    }

    attendance.updatedBy = actorId || null;
    attendance.managerRemarks = [
        attendance.managerRemarks || "",
        `Correction ${correction.correctionCode} approved.`
    ]
        .filter(Boolean)
        .join("\n")
        .trim();

    await attendance.save(session ? { session } : undefined);
    return attendance;
};

const approveCorrection = async (id, user, reviewNote = "", meta = {}) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const correction = await AttendanceCorrection.findOne({
            _id: id,
            ...NOT_DELETED
        }).session(session);
        if (!correction) throw new AppError("Correction request not found.", 404);
        if (correction.status !== "pending") {
            throw new AppError(
                `Cannot approve correction in "${correction.status}" status.`,
                400
            );
        }

        const attendance = await Attendance.findOne({
            _id: correction.attendanceId,
            ...NOT_DELETED
        }).session(session);
        if (!attendance) throw new AppError("Attendance not found.", 404);

        correction.oldValue = snapshotAttendance(attendance);
        await applyCorrectionToAttendance(
            correction,
            attendance,
            user._id,
            session
        );

        correction.status = "approved";
        correction.reviewedBy = user._id;
        correction.reviewedAt = new Date();
        correction.reviewNote = reviewNote || "";
        correction.newValue = snapshotAttendance(attendance);
        correction.updatedBy = user._id;
        await correction.save({ session });

        await session.commitTransaction();

        await writeActivityLog({
            user,
            branchId: correction.branchId,
            activityType: "Approve",
            module: "Attendance",
            subModule: "Correction",
            description: `Correction ${correction.correctionCode} approved (${correction.requestType})`,
            referenceType: "AttendanceCorrection",
            referenceId: correction._id,
            oldData: correction.oldValue,
            newData: correction.newValue,
            changedFields: [correction.requestType],
            ipAddress: meta.ipAddress || "",
            securityLevel: "Sensitive"
        });

        return populateCorrection(AttendanceCorrection.findById(correction._id));
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const rejectCorrection = async (id, user, reviewNote = "", meta = {}) => {
    const correction = await AttendanceCorrection.findOne({
        _id: id,
        ...NOT_DELETED
    });
    if (!correction) throw new AppError("Correction request not found.", 404);
    if (correction.status !== "pending") {
        throw new AppError(
            `Cannot reject correction in "${correction.status}" status.`,
            400
        );
    }
    if (!String(reviewNote || "").trim()) {
        throw new AppError("Review note / rejection reason is required.", 400);
    }

    correction.status = "rejected";
    correction.reviewedBy = user._id;
    correction.reviewedAt = new Date();
    correction.reviewNote = String(reviewNote).trim();
    correction.updatedBy = user._id;
    await correction.save();

    await writeActivityLog({
        user,
        branchId: correction.branchId,
        activityType: "Reject",
        module: "Attendance",
        subModule: "Correction",
        description: `Correction ${correction.correctionCode} rejected`,
        referenceType: "AttendanceCorrection",
        referenceId: correction._id,
        oldData: correction.oldValue,
        newData: { status: "rejected", reviewNote: correction.reviewNote },
        ipAddress: meta.ipAddress || ""
    });

    return populateCorrection(AttendanceCorrection.findById(correction._id));
};

const cancelCorrection = async (id, user, { asAdmin = false } = {}, meta = {}) => {
    const correction = await AttendanceCorrection.findOne({
        _id: id,
        ...NOT_DELETED
    });
    if (!correction) throw new AppError("Correction request not found.", 404);
    if (correction.status !== "pending") {
        throw new AppError(
            `Cannot cancel correction in "${correction.status}" status.`,
            400
        );
    }

    if (!asAdmin) {
        const employee = await resolveEmployeeFromUser(user, {
            requireActive: false
        });
        if (String(correction.employeeId) !== String(employee._id)) {
            throw new AppError("You can only cancel your own correction.", 403);
        }
    }

    correction.status = "cancelled";
    correction.updatedBy = user._id;
    correction.reviewedAt = new Date();
    correction.reviewedBy = user._id;
    correction.reviewNote = asAdmin ? "Cancelled by admin" : "Cancelled by employee";
    await correction.save();

    await writeActivityLog({
        user,
        branchId: correction.branchId,
        activityType: "Cancel",
        module: "Attendance",
        subModule: "Correction",
        description: `Correction ${correction.correctionCode} cancelled`,
        referenceType: "AttendanceCorrection",
        referenceId: correction._id,
        ipAddress: meta.ipAddress || ""
    });

    return populateCorrection(AttendanceCorrection.findById(correction._id));
};

const getCorrections = async (
    query = {},
    user = null,
    { selfOnly = false, managedBranchIds = null } = {}
) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (selfOnly && user) {
        const employee = await resolveEmployeeFromUser(user, {
            requireActive: false
        });
        filter.employeeId = employee._id;
    } else if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }

    if (!selfOnly) {
        const { applyBranchScopeFilter } = require("../middleware/hrAccess");
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
    if (query.attendanceId && toObjectId(query.attendanceId)) {
        filter.attendanceId = toObjectId(query.attendanceId);
    }
    if (query.status) filter.status = query.status;
    if (query.requestType) filter.requestType = query.requestType;
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { correctionCode: { $regex: s, $options: "i" } },
            { reason: { $regex: s, $options: "i" } },
            { workDate: { $regex: s, $options: "i" } }
        ];
    }

    const sort = resolveEntitySort(query, {
        nameField: "correctionCode",
        dateField: "createdAt"
    });

    const [items, total] = await Promise.all([
        populateCorrection(
            AttendanceCorrection.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
        ),
        AttendanceCorrection.countDocuments(filter)
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

const getCorrectionById = async (id) => {
    const doc = await populateCorrection(
        AttendanceCorrection.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Correction request not found.", 404);
    return doc;
};

/**
 * Admin authorized manual adjustment (no pending request).
 * Still audited — employees cannot call this.
 */
const adminAdjustAttendance = async (attendanceId, payload = {}, user, meta = {}) => {
    const attendance = await Attendance.findOne({
        _id: attendanceId,
        ...NOT_DELETED
    });
    if (!attendance) throw new AppError("Attendance not found.", 404);

    const oldValue = snapshotAttendance(attendance);
    const fakeCorrection = {
        correctionCode: "ADMIN",
        requestType: payload.requestType || "statusCorrection",
        requestedCheckIn: payload.checkIn || null,
        requestedCheckOut: payload.checkOut || null,
        requestedStatus: payload.attendanceStatus || "",
        requestedBreaks: payload.breaks || []
    };

    // Map admin payload into apply helper shape
    if (payload.checkIn) {
        fakeCorrection.requestType = "checkInCorrection";
        fakeCorrection.requestedCheckIn = payload.checkIn;
        await applyCorrectionToAttendance(fakeCorrection, attendance, user._id);
    } else if (payload.checkOut) {
        fakeCorrection.requestType = "checkOutCorrection";
        fakeCorrection.requestedCheckOut = payload.checkOut;
        await applyCorrectionToAttendance(fakeCorrection, attendance, user._id);
    } else if (payload.breaks) {
        fakeCorrection.requestType = "breakCorrection";
        fakeCorrection.requestedBreaks = payload.breaks;
        await applyCorrectionToAttendance(fakeCorrection, attendance, user._id);
    } else if (payload.attendanceStatus) {
        fakeCorrection.requestType = "statusCorrection";
        fakeCorrection.requestedStatus = payload.attendanceStatus;
        await applyCorrectionToAttendance(fakeCorrection, attendance, user._id);
    } else {
        throw new AppError(
            "Provide checkIn, checkOut, breaks, or attendanceStatus to adjust.",
            400
        );
    }

    await writeActivityLog({
        user,
        branchId: attendance.branchId,
        activityType: "Adjustment",
        module: "Attendance",
        subModule: "ManualAdjust",
        description: `Manual attendance adjustment by admin (${payload.reason || "no reason"})`,
        referenceType: "Attendance",
        referenceId: attendance._id,
        oldData: oldValue,
        newData: snapshotAttendance(attendance),
        ipAddress: meta.ipAddress || "",
        securityLevel: "Critical"
    });

    return attendance;
};

const deleteCorrection = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreCorrection = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteCorrection = (id) => trash.permanentDelete(id);
const bulkSoftDeleteCorrections = (payload, actorId = null) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreCorrections = (payload, actorId = null) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteCorrections = (payload) =>
    trash.bulkPermanentDelete(payload);
const trashCount = () => trash.trashCount();

module.exports = {
    createCorrection,
    approveCorrection,
    rejectCorrection,
    cancelCorrection,
    getCorrections,
    getCorrectionById,
    adminAdjustAttendance,
    softDelete: deleteCorrection,
    deleteCorrection,
    restoreCorrection,
    permanentDeleteCorrection,
    bulkSoftDelete: bulkSoftDeleteCorrections,
    bulkSoftDeleteCorrections,
    bulkRestore: bulkRestoreCorrections,
    bulkRestoreCorrections,
    bulkPermanentDelete: bulkPermanentDeleteCorrections,
    bulkPermanentDeleteCorrections,
    trashCount
};
