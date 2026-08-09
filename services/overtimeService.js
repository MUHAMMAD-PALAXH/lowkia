const mongoose = require("mongoose");
const OvertimeRequest = require("../model/overtimeRequest");
const Attendance = require("../model/attendance");
const { generateOvertimeRequestCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { resolveEmployeeFromUser } = require("../middleware/hrAccess");
const attendancePolicyService = require("./attendancePolicyService");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateOt = (q) =>
    q
        .populate("employeeId", "employeeCode fullName firstName lastName")
        .populate("attendanceId", "workDate checkIn checkOut overtimeMinutes approvedOvertimeMinutes attendanceStatus")
        .populate("branchId", "branchCode name")
        .populate("reviewedBy", "firstName lastName email")
        .populate("userId", "firstName lastName email");

/**
 * After checkout recalculation: auto-approve OT when policy allows.
 * Never overwrites a higher already-approved amount from a prior request.
 */
const applyAutoApprovedOvertime = (attendance, policy) => {
    if (!attendance || policy?.overtimeEnabled === false) {
        if (attendance) attendance.approvedOvertimeMinutes = 0;
        return attendance;
    }
    const potential = Number(attendance.overtimeMinutes) || 0;
    if (potential <= 0) {
        // Keep existing approved if any admin-approved beyond recalc — only clear if none approved via request
        return attendance;
    }
    if (policy.overtimeRequiresApproval === false) {
        attendance.approvedOvertimeMinutes = Math.max(
            Number(attendance.approvedOvertimeMinutes) || 0,
            potential
        );
    }
    // If approval required, leave approvedOvertimeMinutes as-is (0 until OT request approved)
    return attendance;
};

const createOvertimeRequest = async (user, payload = {}, meta = {}) => {
    const employee = await resolveEmployeeFromUser(user);
    const policy = await attendancePolicyService.getActiveOrDefault();

    if (policy.overtimeEnabled === false) {
        throw new AppError("Overtime is disabled by attendance policy.", 400);
    }

    const attendanceId = toObjectId(payload.attendanceId);
    if (!attendanceId) throw new AppError("attendanceId is required.", 400);

    const attendance = await Attendance.findOne({
        _id: attendanceId,
        ...NOT_DELETED
    });
    if (!attendance) throw new AppError("Attendance not found.", 404);
    if (String(attendance.employeeId) !== String(employee._id)) {
        throw new AppError(
            "You can only request overtime for your own attendance.",
            403
        );
    }
    if (!attendance.checkOut) {
        throw new AppError(
            "Check out first before requesting overtime.",
            400
        );
    }

    const calculated = Number(attendance.overtimeMinutes) || 0;
    if (calculated <= 0) {
        throw new AppError(
            "No calculated overtime on this attendance record.",
            400
        );
    }

    // If policy auto-approves, no need for a request — ensure approved and return hint
    if (policy.overtimeRequiresApproval === false) {
        attendance.approvedOvertimeMinutes = Math.max(
            Number(attendance.approvedOvertimeMinutes) || 0,
            calculated
        );
        await attendance.save();
        throw new AppError(
            "Overtime is auto-approved by policy. No request needed. Approved minutes updated.",
            400
        );
    }

    const alreadyApproved = Number(attendance.approvedOvertimeMinutes) || 0;
    if (alreadyApproved >= calculated) {
        throw new AppError(
            "Calculated overtime is already fully approved.",
            400
        );
    }

    const pending = await OvertimeRequest.findOne({
        attendanceId,
        status: "pending",
        ...NOT_DELETED
    });
    if (pending) {
        throw new AppError(
            "A pending overtime request already exists for this attendance.",
            409
        );
    }

    let requestedMinutes =
        payload.requestedMinutes !== undefined
            ? Math.max(Number(payload.requestedMinutes) || 0, 0)
            : calculated;
    if (requestedMinutes <= 0) {
        throw new AppError("requestedMinutes must be greater than 0.", 400);
    }
    if (requestedMinutes > calculated) {
        throw new AppError(
            `Cannot request more than calculated overtime (${calculated} minutes).`,
            400
        );
    }

    const reason = String(payload.reason || "").trim();
    if (reason.length < 5) {
        throw new AppError("Reason must be at least 5 characters.", 400);
    }

    const overtimeCode = await generateOvertimeRequestCode();
    const doc = await OvertimeRequest.create({
        overtimeCode,
        branchId: attendance.branchId,
        employeeId: employee._id,
        userId: user._id,
        attendanceId: attendance._id,
        workDate: attendance.workDate || "",
        calculatedMinutes: calculated,
        requestedMinutes,
        approvedMinutes: 0,
        reason,
        status: "pending",
        createdBy: user._id
    });

    await writeActivityLog({
        user,
        branchId: attendance.branchId,
        activityType: "Create",
        module: "Attendance",
        subModule: "Overtime",
        description: `Overtime requested ${requestedMinutes}m for ${attendance.workDate || overtimeCode}`,
        referenceType: "OvertimeRequest",
        referenceId: doc._id,
        newData: {
            calculatedMinutes: calculated,
            requestedMinutes
        },
        ipAddress: meta.ipAddress || ""
    });

    return populateOt(OvertimeRequest.findById(doc._id));
};

const approveOvertime = async (id, user, payload = {}, meta = {}) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const reqDoc = await OvertimeRequest.findOne({
            _id: id,
            ...NOT_DELETED
        }).session(session);
        if (!reqDoc) throw new AppError("Overtime request not found.", 404);
        if (reqDoc.status !== "pending") {
            throw new AppError(
                `Cannot approve overtime in "${reqDoc.status}" status.`,
                400
            );
        }

        const attendance = await Attendance.findOne({
            _id: reqDoc.attendanceId,
            ...NOT_DELETED
        }).session(session);
        if (!attendance) throw new AppError("Attendance not found.", 404);

        const policy = await attendancePolicyService.getActiveOrDefault();
        if (policy.overtimeEnabled === false) {
            throw new AppError("Overtime is disabled by policy.", 400);
        }

        const calculated = Number(attendance.overtimeMinutes) || 0;
        let approvedMinutes =
            payload.approvedMinutes !== undefined
                ? Math.max(Number(payload.approvedMinutes) || 0, 0)
                : Number(reqDoc.requestedMinutes) || 0;

        if (approvedMinutes <= 0) {
            throw new AppError("approvedMinutes must be greater than 0.", 400);
        }
        const maxAllowed = Math.max(calculated, Number(reqDoc.requestedMinutes) || 0);
        if (approvedMinutes > maxAllowed) {
            throw new AppError(
                `Cannot approve more than ${maxAllowed} minutes.`,
                400
            );
        }

        // Payroll-facing field
        attendance.approvedOvertimeMinutes = approvedMinutes;
        attendance.isOvertime = approvedMinutes > 0 || calculated > 0;
        attendance.updatedBy = user._id;
        await attendance.save({ session });

        reqDoc.status = "approved";
        reqDoc.approvedMinutes = approvedMinutes;
        reqDoc.reviewedBy = user._id;
        reqDoc.reviewedAt = new Date();
        reqDoc.reviewNote = payload.reviewNote || payload.comment || "";
        reqDoc.updatedBy = user._id;
        await reqDoc.save({ session });

        await session.commitTransaction();

        await writeActivityLog({
            user,
            branchId: reqDoc.branchId,
            activityType: "Approve",
            module: "Attendance",
            subModule: "Overtime",
            description: `Overtime ${reqDoc.overtimeCode} approved (${approvedMinutes}m)`,
            referenceType: "OvertimeRequest",
            referenceId: reqDoc._id,
            oldData: { approvedOvertimeMinutes: 0 },
            newData: { approvedOvertimeMinutes: approvedMinutes },
            ipAddress: meta.ipAddress || "",
            securityLevel: "Sensitive"
        });

        return populateOt(OvertimeRequest.findById(reqDoc._id));
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const rejectOvertime = async (id, user, reviewNote = "", meta = {}) => {
    const reqDoc = await OvertimeRequest.findOne({
        _id: id,
        ...NOT_DELETED
    });
    if (!reqDoc) throw new AppError("Overtime request not found.", 404);
    if (reqDoc.status !== "pending") {
        throw new AppError(
            `Cannot reject overtime in "${reqDoc.status}" status.`,
            400
        );
    }
    if (!String(reviewNote || "").trim()) {
        throw new AppError("Rejection reason is required.", 400);
    }

    reqDoc.status = "rejected";
    reqDoc.reviewedBy = user._id;
    reqDoc.reviewedAt = new Date();
    reqDoc.reviewNote = String(reviewNote).trim();
    reqDoc.approvedMinutes = 0;
    reqDoc.updatedBy = user._id;
    await reqDoc.save();

    await writeActivityLog({
        user,
        branchId: reqDoc.branchId,
        activityType: "Reject",
        module: "Attendance",
        subModule: "Overtime",
        description: `Overtime ${reqDoc.overtimeCode} rejected`,
        referenceType: "OvertimeRequest",
        referenceId: reqDoc._id,
        ipAddress: meta.ipAddress || ""
    });

    return populateOt(OvertimeRequest.findById(reqDoc._id));
};

const cancelOvertime = async (id, user, { asAdmin = false } = {}, meta = {}) => {
    const reqDoc = await OvertimeRequest.findOne({
        _id: id,
        ...NOT_DELETED
    });
    if (!reqDoc) throw new AppError("Overtime request not found.", 404);
    if (reqDoc.status !== "pending") {
        throw new AppError(
            `Cannot cancel overtime in "${reqDoc.status}" status.`,
            400
        );
    }

    if (!asAdmin) {
        const employee = await resolveEmployeeFromUser(user, {
            requireActive: false
        });
        if (String(reqDoc.employeeId) !== String(employee._id)) {
            throw new AppError("You can only cancel your own overtime request.", 403);
        }
    }

    reqDoc.status = "cancelled";
    reqDoc.reviewedBy = user._id;
    reqDoc.reviewedAt = new Date();
    reqDoc.reviewNote = asAdmin ? "Cancelled by admin" : "Cancelled by employee";
    reqDoc.updatedBy = user._id;
    await reqDoc.save();

    await writeActivityLog({
        user,
        branchId: reqDoc.branchId,
        activityType: "Cancel",
        module: "Attendance",
        subModule: "Overtime",
        description: `Overtime ${reqDoc.overtimeCode} cancelled`,
        referenceType: "OvertimeRequest",
        referenceId: reqDoc._id,
        ipAddress: meta.ipAddress || ""
    });

    return populateOt(OvertimeRequest.findById(reqDoc._id));
};

const getOvertimeRequests = async (
    query = {},
    user = null,
    { selfOnly = false, managedBranchIds = null } = {}
) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { ...NOT_DELETED };

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
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { overtimeCode: { $regex: s, $options: "i" } },
            { reason: { $regex: s, $options: "i" } },
            { workDate: { $regex: s, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        populateOt(
            OvertimeRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ),
        OvertimeRequest.countDocuments(filter)
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

const getOvertimeById = async (id) => {
    const doc = await populateOt(
        OvertimeRequest.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Overtime request not found.", 404);
    return doc;
};

module.exports = {
    createOvertimeRequest,
    approveOvertime,
    rejectOvertime,
    cancelOvertime,
    getOvertimeRequests,
    getOvertimeById,
    applyAutoApprovedOvertime
};
