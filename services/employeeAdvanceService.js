const mongoose = require("mongoose");
const EmployeeAdvance = require("../model/employeeAdvance");
const Employee = require("../model/employee");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    toMinor,
    toMajor,
    assertPositiveMinor,
    assertNotOverpaying,
} = require("../utils/money");
const { generateEmployeeAdvanceCode } = require("./codeGenerator");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");
const { writeActivityLog } = require("./activityLogService");
const sm = require("./employeeAdvanceStateMachine");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const isOwner = (user) => (user?.role || "").toLowerCase() === "admin";

const syncMajors = (doc, currency = DEFAULT_CURRENCY) => {
    doc.requestedAmount = toMajor(doc.requestedAmountMinor || 0, currency);
    doc.approvedAmount = toMajor(doc.approvedAmountMinor || 0, currency);
    doc.disbursedAmount = toMajor(doc.disbursedAmountMinor || 0, currency);
    doc.recoveredAmount = toMajor(doc.recoveredAmountMinor || 0, currency);
    doc.outstanding = toMajor(doc.outstandingMinor || 0, currency);
    return doc;
};

const serialize = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    return {
        ...plain,
        amounts: {
            requested: plain.requestedAmount,
            approved: plain.approvedAmount,
            disbursed: plain.disbursedAmount,
            recovered: plain.recoveredAmount,
            outstanding: plain.outstanding,
        },
    };
};

const resolveRequestedMinor = (payload = {}) => {
    if (payload.requestedAmountMinor != null) {
        return assertPositiveMinor(
            payload.requestedAmountMinor,
            "Requested amount"
        );
    }
    if (payload.requestedAmount != null || payload.amount != null) {
        return assertPositiveMinor(
            toMinor(payload.requestedAmount ?? payload.amount),
            "Requested amount"
        );
    }
    throw new AppError("requestedAmount is required.", 400);
};

const loadAdvance = async (id, companyId) => {
    const doc = await EmployeeAdvance.findOne({
        _id: id,
        companyId,
        ...NOT_DELETED,
    });
    if (!doc) throw new AppError("Employee advance not found.", 404);
    assertDocumentCompany(doc, companyId, "EmployeeAdvance");
    return doc;
};

const findLinkedEmployee = async (user) => {
    if (!user?._id) return null;
    return Employee.findOne({
        userId: user._id,
        ...NOT_DELETED,
    })
        .select("_id employeeCode fullName firstName lastName branchId")
        .lean();
};

/**
 * BM can only see own advances (linked employee or createdBy).
 */
const assertCanView = async (doc, user) => {
    if (isOwner(user)) return;
    if (String(doc.createdBy) === String(user._id)) return;
    const mine = await findLinkedEmployee(user);
    if (mine && String(doc.employeeId) === String(mine._id)) return;
    throw new AppError("You can only view your own advances.", 403);
};

const assertCanMutateRequest = async (doc, user) => {
    if (isOwner(user)) return;
    if (String(doc.createdBy) === String(user._id)) return;
    const mine = await findLinkedEmployee(user);
    if (mine && String(doc.employeeId) === String(mine._id)) return;
    throw new AppError("You can only modify your own advances.", 403);
};

const audit = async ({
    user,
    companyId,
    doc,
    activityType = "Update",
    description,
    meta = {},
    securityLevel = "Medium",
}) => {
    await writeActivityLog({
        user,
        companyId,
        branchId: doc?.branchId || null,
        activityType,
        module: "Payroll",
        subModule: "EmployeeAdvance",
        description,
        referenceType: "Payroll",
        referenceId: doc?._id || null,
        ipAddress: meta.ipAddress || "",
        securityLevel,
    });
};

const loadEmployeeOrThrow = async (employeeId) => {
    const emp = await Employee.findOne({
        _id: employeeId,
        ...NOT_DELETED,
        isActive: { $ne: false },
    }).select(
        "employeeCode fullName firstName lastName branchId userId designation"
    );
    if (!emp) throw new AppError("Employee not found or inactive.", 404);
    return emp;
};

/**
 * Create advance request.
 * Owner may create for any employee; BM creates for self (or explicit employee if owner-linked).
 */
const createAdvance = async (payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    let employeeId = toObjectId(payload.employeeId);

    if (!isOwner(user)) {
        const mine = await findLinkedEmployee(user);
        if (!mine) {
            throw new AppError(
                "No employee profile linked to your account.",
                400
            );
        }
        if (employeeId && String(employeeId) !== String(mine._id)) {
            throw new AppError(
                "Branch managers can only request advances for themselves.",
                403
            );
        }
        employeeId = mine._id;
    }

    if (!employeeId) {
        throw new AppError("employeeId is required.", 400);
    }

    const emp = await loadEmployeeOrThrow(employeeId);
    const requestedAmountMinor = resolveRequestedMinor(payload);
    const submit =
        payload.submit === true ||
        String(payload.status || "").toLowerCase() === "pendingapproval";

    const advanceNumber = await generateEmployeeAdvanceCode();
    const doc = await EmployeeAdvance.create({
        companyId,
        advanceNumber,
        branchId: emp.branchId || toObjectId(payload.branchId) || null,
        employeeId: emp._id,
        employeeCode: emp.employeeCode || "",
        employeeName:
            emp.fullName ||
            `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
        currency: DEFAULT_CURRENCY,
        requestedAmountMinor,
        approvedAmountMinor: 0,
        outstandingMinor: 0,
        reason: String(payload.reason || "").trim(),
        notes: String(payload.notes || "").trim(),
        repaymentType: ["Single", "Installment", "Payroll"].includes(
            payload.repaymentType
        )
            ? payload.repaymentType
            : "Payroll",
        installmentCount: Math.max(
            1,
            Math.min(60, parseInt(payload.installmentCount, 10) || 1)
        ),
        status: submit ? "pendingApproval" : "draft",
        submittedAt: submit ? new Date() : null,
        createdBy: user._id,
        updatedBy: user._id,
    });
    syncMajors(doc);
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Create",
        description: `Advance ${doc.advanceNumber} created (${toMajor(requestedAmountMinor)} USD)`,
        meta,
    });

    return serialize(doc);
};

const updateAdvance = async (id, payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    await assertCanMutateRequest(doc, user);

    if (!sm.isEditable(doc.status)) {
        throw new AppError(
            `Cannot edit advance in status ${doc.status}.`,
            400
        );
    }

    if (payload.requestedAmount != null || payload.requestedAmountMinor != null) {
        doc.requestedAmountMinor = resolveRequestedMinor(payload);
    }
    if (payload.reason != null) doc.reason = String(payload.reason).trim();
    if (payload.notes != null) doc.notes = String(payload.notes).trim();
    if (["Single", "Installment", "Payroll"].includes(payload.repaymentType)) {
        doc.repaymentType = payload.repaymentType;
    }
    if (payload.installmentCount != null) {
        doc.installmentCount = Math.max(
            1,
            Math.min(60, parseInt(payload.installmentCount, 10) || 1)
        );
    }

    // Owner may reassign employee while draft
    if (isOwner(user) && payload.employeeId) {
        const emp = await loadEmployeeOrThrow(payload.employeeId);
        doc.employeeId = emp._id;
        doc.employeeCode = emp.employeeCode || "";
        doc.employeeName =
            emp.fullName ||
            `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
        doc.branchId = emp.branchId || doc.branchId;
    }

    doc.updatedBy = user._id;
    syncMajors(doc);
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        description: `Advance ${doc.advanceNumber} updated`,
        meta,
    });

    return serialize(doc);
};

const submitAdvance = async (id, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    await assertCanMutateRequest(doc, user);
    sm.assertTransition(doc.status, "pendingApproval");
    doc.status = "pendingApproval";
    doc.submittedAt = new Date();
    doc.updatedBy = user._id;
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Update",
        description: `Advance ${doc.advanceNumber} submitted for approval`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

const approveAdvance = async (id, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can approve advances.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    sm.assertTransition(doc.status, "approved");

    let approvedMinor = doc.requestedAmountMinor;
    if (payload.approvedAmountMinor != null) {
        approvedMinor = assertPositiveMinor(
            payload.approvedAmountMinor,
            "Approved amount"
        );
    } else if (payload.approvedAmount != null) {
        approvedMinor = assertPositiveMinor(
            toMinor(payload.approvedAmount),
            "Approved amount"
        );
    }
    if (approvedMinor > doc.requestedAmountMinor) {
        throw new AppError(
            "Approved amount cannot exceed requested amount.",
            400
        );
    }

    doc.approvedAmountMinor = approvedMinor;
    doc.outstandingMinor = 0; // debt starts at disbursement
    doc.status = "approved";
    doc.approvedAt = new Date();
    doc.approvedBy = user._id;
    doc.approvalNote = String(payload.note || payload.notes || "").trim();
    doc.updatedBy = user._id;
    syncMajors(doc);
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Approve",
        description: `Advance ${doc.advanceNumber} approved`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

const rejectAdvance = async (id, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can reject advances.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    sm.assertTransition(doc.status, "rejected");
    doc.status = "rejected";
    doc.rejectedAt = new Date();
    doc.rejectedBy = user._id;
    doc.rejectionReason = String(
        payload.reason || payload.notes || ""
    ).trim();
    doc.updatedBy = user._id;
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Reject",
        description: `Advance ${doc.advanceNumber} rejected`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

const cancelAdvance = async (id, payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    await assertCanMutateRequest(doc, user);

    if (["disbursed", "recovering", "settled"].includes(doc.status)) {
        throw new AppError(
            `Cannot cancel a ${doc.status} advance — reverse instead.`,
            400
        );
    }
    if (doc.status === "approved" && !isOwner(user)) {
        throw new AppError("Only owners can cancel an approved advance.", 403);
    }

    sm.assertTransition(doc.status, "cancelled");
    doc.status = "cancelled";
    doc.cancelledAt = new Date();
    doc.cancelledBy = user._id;
    doc.cancelReason = String(payload.reason || payload.notes || "").trim();
    doc.updatedBy = user._id;
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Cancel",
        description: `Advance ${doc.advanceNumber} cancelled`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

/**
 * Mark cash disbursed (offline / Phase 6 stub).
 * Phase 7 EmployeePayment can call the same path with paymentId.
 */
const disburseAdvance = async (id, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can disburse advances.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);
    sm.assertTransition(doc.status, "disbursed");

    if (!doc.approvedAmountMinor || doc.approvedAmountMinor <= 0) {
        throw new AppError("Advance has no approved amount.", 400);
    }

    let disburseMinor = doc.approvedAmountMinor;
    if (payload.disbursedAmountMinor != null) {
        disburseMinor = assertPositiveMinor(
            payload.disbursedAmountMinor,
            "Disbursed amount"
        );
    } else if (payload.disbursedAmount != null) {
        disburseMinor = assertPositiveMinor(
            toMinor(payload.disbursedAmount),
            "Disbursed amount"
        );
    }
    if (disburseMinor > doc.approvedAmountMinor) {
        throw new AppError(
            "Disbursed amount cannot exceed approved amount.",
            400
        );
    }

    doc.disbursedAmountMinor = disburseMinor;
    doc.outstandingMinor = disburseMinor;
    doc.recoveredAmountMinor = 0;
    doc.status = "disbursed";
    doc.disbursedAt = new Date();
    doc.disbursedBy = user._id;
    if (payload.paymentId && toObjectId(payload.paymentId)) {
        doc.paymentId = toObjectId(payload.paymentId);
    }
    if (payload.notes != null) {
        doc.notes = String(payload.notes).trim();
    }
    doc.updatedBy = user._id;
    syncMajors(doc);
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Payment",
        description: `Advance ${doc.advanceNumber} disbursed`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

/**
 * Apply recovery (payroll deduction or manual). Hard-rejects overpay.
 * Exported for Phase 5/7 payroll hooks.
 */
const applyRecovery = async (
    advanceId,
    {
        amountMinor,
        source = "manual",
        payrollId = null,
        paymentId = null,
        note = "",
        user = null,
        companyId = null,
    } = {}
) => {
    const pay = assertPositiveMinor(amountMinor, "Recovery amount");
    const filter = { _id: advanceId, ...NOT_DELETED };
    if (companyId) filter.companyId = companyId;

    const doc = await EmployeeAdvance.findOne(filter);
    if (!doc) throw new AppError("Employee advance not found.", 404);

    if (!["disbursed", "recovering"].includes(doc.status)) {
        throw new AppError(
            `Cannot recover against advance in status ${doc.status}.`,
            400
        );
    }

    assertNotOverpaying(pay, doc.outstandingMinor, "Recovery");

    doc.recoveredAmountMinor = (doc.recoveredAmountMinor || 0) + pay;
    doc.outstandingMinor = Math.max(0, (doc.outstandingMinor || 0) - pay);
    doc.recoveries.push({
        amountMinor: pay,
        amount: toMajor(pay, doc.currency || DEFAULT_CURRENCY),
        source,
        payrollId: toObjectId(payrollId),
        paymentId: toObjectId(paymentId),
        note: String(note || "").trim(),
        recordedBy: user?._id || null,
        recoveredAt: new Date(),
    });

    if (doc.outstandingMinor === 0) {
        sm.assertTransition(doc.status, "settled");
        doc.status = "settled";
        doc.settledAt = new Date();
    } else if (doc.status === "disbursed") {
        sm.assertTransition(doc.status, "recovering");
        doc.status = "recovering";
    }

    if (user?._id) doc.updatedBy = user._id;
    syncMajors(doc);
    await doc.save();
    return serialize(doc);
};

const recoverAdvance = async (id, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can record recoveries.", 403);
    }
    const companyId = await ensureUserCompany(user);
    await loadAdvance(id, companyId); // tenant check

    let amountMinor;
    if (payload.amountMinor != null) {
        amountMinor = assertPositiveMinor(payload.amountMinor, "Recovery amount");
    } else if (payload.amount != null) {
        amountMinor = assertPositiveMinor(toMinor(payload.amount), "Recovery amount");
    } else {
        throw new AppError("Recovery amount is required.", 400);
    }

    const result = await applyRecovery(id, {
        amountMinor,
        source: payload.source || "manual",
        payrollId: payload.payrollId,
        paymentId: payload.paymentId,
        note: payload.note || payload.notes || "",
        user,
        companyId,
    });

    await audit({
        user,
        companyId,
        doc: { _id: id, branchId: result.branchId },
        activityType: "Payment",
        description: `Recovery applied to advance ${result.advanceNumber}`,
        meta,
        securityLevel: "High",
    });

    return result;
};

/**
 * Reverse a disbursed/recovering/approved advance (owner).
 * Clears outstanding; does not delete recovery history (marks reversed).
 */
const reverseAdvance = async (id, payload = {}, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can reverse advances.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const doc = await loadAdvance(id, companyId);

    if (!["approved", "disbursed", "recovering"].includes(doc.status)) {
        throw new AppError(
            `Cannot reverse advance in status ${doc.status}.`,
            400
        );
    }
    sm.assertTransition(doc.status, "reversed");

    doc.status = "reversed";
    doc.reversedAt = new Date();
    doc.reversedBy = user._id;
    doc.reverseReason = String(payload.reason || payload.notes || "").trim();
    doc.outstandingMinor = 0;
    doc.updatedBy = user._id;
    syncMajors(doc);
    await doc.save();

    await audit({
        user,
        companyId,
        doc,
        activityType: "Update",
        description: `Advance ${doc.advanceNumber} reversed`,
        meta,
        securityLevel: "High",
    });

    return serialize(doc);
};

const listAdvances = async (companyId, query = {}, user) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const filter = { companyId, ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }

    if (!isOwner(user)) {
        const mine = await findLinkedEmployee(user);
        const or = [{ createdBy: user._id }];
        if (mine) or.push({ employeeId: mine._id });
        filter.$or = or;
    }

    if (query.search) {
        const q = String(query.search).trim();
        filter.$and = [
            ...(filter.$and || []),
            {
                $or: [
                    { advanceNumber: new RegExp(q, "i") },
                    { employeeName: new RegExp(q, "i") },
                    { employeeCode: new RegExp(q, "i") },
                    { reason: new RegExp(q, "i") },
                ],
            },
        ];
    }

    const [items, total] = await Promise.all([
        EmployeeAdvance.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        EmployeeAdvance.countDocuments(filter),
    ]);

    return {
        items: items.map(serialize),
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    };
};

const getAdvanceById = async (id, companyId, user) => {
    const doc = await loadAdvance(id, companyId);
    await assertCanView(doc, user);
    return serialize(doc);
};

/**
 * Outstanding rollup for an employee (active debt).
 */
const getEmployeeOutstanding = async (employeeId, companyId) => {
    const empId = toObjectId(employeeId);
    if (!empId) throw new AppError("Invalid employee id.", 400);

    const rows = await EmployeeAdvance.find({
        companyId,
        employeeId: empId,
        ...NOT_DELETED,
        status: { $in: ["disbursed", "recovering"] },
    })
        .select(
            "advanceNumber status outstandingMinor disbursedAmountMinor recoveredAmountMinor currency"
        )
        .lean();

    const outstandingMinor = rows.reduce(
        (s, r) => s + (r.outstandingMinor || 0),
        0
    );

    return {
        employeeId: empId,
        currency: DEFAULT_CURRENCY,
        outstandingMinor,
        outstanding: toMajor(outstandingMinor),
        openAdvances: rows.map(serialize),
        count: rows.length,
    };
};

module.exports = {
    createAdvance,
    updateAdvance,
    submitAdvance,
    approveAdvance,
    rejectAdvance,
    cancelAdvance,
    disburseAdvance,
    recoverAdvance,
    applyRecovery,
    reverseAdvance,
    listAdvances,
    getAdvanceById,
    getEmployeeOutstanding,
    serialize,
    syncMajors,
};
