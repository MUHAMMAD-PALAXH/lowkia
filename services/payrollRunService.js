const mongoose = require("mongoose");
const PayrollRun = require("../model/payrollRun");
const Payroll = require("../model/payroll");
const Employee = require("../model/employee");
const SalaryStructure = require("../model/salaryStructure");
const AppError = require("../utils/appError");
const { DEFAULT_CURRENCY, toMajor } = require("../utils/money");
const {
    generatePayrollRunCode,
    generatePayrollCode,
} = require("./codeGenerator");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");
const { writeActivityLog } = require("./activityLogService");
const { getMonthlyReport } = require("./attendanceReportService");
const sm = require("./payrollRunStateMachine");
const {
    calculateEmployeePayroll,
    syncMajorFromMinor,
    applyLineStatus,
} = require("./payrollCalculator");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const { isCompanyOwner } = require("../utils/roleAccess");
const isOwner = (user) => isCompanyOwner(user?.role);

const auditRun = async ({
    user,
    companyId,
    run,
    activityType = "Update",
    description,
    meta = {},
    securityLevel = "Medium",
}) => {
    await writeActivityLog({
        user,
        companyId,
        branchId: run?.branchId || null,
        activityType,
        module: "Payroll",
        subModule: "PayrollRun",
        description,
        referenceType: "Payroll",
        referenceId: run?._id || null,
        ipAddress: meta.ipAddress || "",
        securityLevel,
    });
};

const periodLabel = (month, year) =>
    `${String(month).padStart(2, "0")}/${year}`;

const serializeRun = (doc, lines = null) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    return {
        ...plain,
        totals: {
            basic: plain.totalBasic,
            gross: plain.totalGross,
            deduction: plain.totalDeduction,
            net: plain.totalNet,
            overtime: plain.totalOvertime,
        },
        ...(lines ? { lines } : {}),
    };
};

const serializeLine = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    return plain;
};

const loadRun = async (id, companyId) => {
    const run = await PayrollRun.findOne({
        _id: id,
        companyId,
        ...NOT_DELETED,
    });
    if (!run) throw new AppError("Payroll run not found.", 404);
    assertDocumentCompany(run, companyId, "PayrollRun");
    return run;
};

const recomputeRunTotals = async (run) => {
    const lines = await Payroll.find({
        payrollRunId: run._id,
        ...NOT_DELETED,
        status: { $nin: ["cancelled"] },
    }).lean();

    let totalBasicMinor = 0;
    let totalGrossMinor = 0;
    let totalDeductionMinor = 0;
    let totalNetMinor = 0;
    let totalOvertimeMinor = 0;
    let calculatedCount = 0;
    let skippedCount = 0;

    for (const line of lines) {
        if (line.status === "skipped") {
            skippedCount += 1;
            continue;
        }
        if (["calculated", "approved", "paid"].includes(line.status)) {
            calculatedCount += 1;
        }
        totalBasicMinor += line.basicSalaryMinor || 0;
        totalGrossMinor += line.grossSalaryMinor || 0;
        totalDeductionMinor += line.deductionMinor || 0;
        totalNetMinor += line.netSalaryMinor || 0;
        totalOvertimeMinor += line.overtimeAmountMinor || 0;
    }

    const currency = run.currency || DEFAULT_CURRENCY;
    run.employeeCount = lines.length;
    run.calculatedCount = calculatedCount;
    run.skippedCount = skippedCount;
    run.totalBasicMinor = totalBasicMinor;
    run.totalGrossMinor = totalGrossMinor;
    run.totalDeductionMinor = totalDeductionMinor;
    run.totalNetMinor = totalNetMinor;
    run.totalOvertimeMinor = totalOvertimeMinor;
    run.totalBasic = toMajor(totalBasicMinor, currency);
    run.totalGross = toMajor(totalGrossMinor, currency);
    run.totalDeduction = toMajor(totalDeductionMinor, currency);
    run.totalNet = toMajor(totalNetMinor, currency);
    run.totalOvertime = toMajor(totalOvertimeMinor, currency);
    return run;
};

/**
 * Resolve salary structure for an employee within company.
 */
const resolveStructureForEmployee = async (employee, companyId) => {
    if (employee.salaryStructureId) {
        const byId = await SalaryStructure.findOne({
            _id: employee.salaryStructureId,
            companyId,
            status: { $ne: "archived" },
            ...NOT_DELETED,
        }).lean();
        if (byId) return byId;
    }
    return SalaryStructure.findOne({
        companyId,
        employeeId: employee._id,
        isCurrent: true,
        status: { $ne: "archived" },
        ...NOT_DELETED,
    })
        .sort({ updatedAt: -1 })
        .lean();
};

/**
 * Create draft payroll run + employee line stubs.
 */
const createRun = async (payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const month = parseInt(payload.payrollMonth ?? payload.month, 10);
    const year = parseInt(payload.payrollYear ?? payload.year, 10);
    if (!month || month < 1 || month > 12) {
        throw new AppError("payrollMonth must be 1–12.", 400);
    }
    if (!year || year < 2000) {
        throw new AppError("payrollYear is required.", 400);
    }

    const branchId = toObjectId(payload.branchId) || null;

    const existing = await PayrollRun.findOne({
        companyId,
        payrollMonth: month,
        payrollYear: year,
        branchId,
        ...NOT_DELETED,
        status: { $ne: "cancelled" },
    });
    if (existing) {
        throw new AppError(
            `A payroll run already exists for ${periodLabel(month, year)}${
                branchId ? " (this branch)" : ""
            }.`,
            409
        );
    }

    const empFilter = {
        ...NOT_DELETED,
        isActive: { $ne: false },
    };
    if (branchId) empFilter.branchId = branchId;

    const employees = await Employee.find(empFilter)
        .select(
            "employeeCode fullName firstName lastName designation branchId departmentId salaryStructureId"
        )
        .sort({ fullName: 1, firstName: 1 })
        .lean();

    if (!employees.length) {
        throw new AppError("No active employees found for this run.", 400);
    }

    // Block if employee already has a non-cancelled payroll for period
    const empIds = employees.map((e) => e._id);
    const clash = await Payroll.findOne({
        companyId,
        employeeId: { $in: empIds },
        payrollMonth: month,
        payrollYear: year,
        ...NOT_DELETED,
        status: { $nin: ["cancelled"] },
    }).select("employeeCode employeeName");
    if (clash) {
        throw new AppError(
            `Employee ${clash.employeeName || clash.employeeCode} already has payroll for ${periodLabel(month, year)}.`,
            409
        );
    }

    const runNumber = await generatePayrollRunCode();
    const run = await PayrollRun.create({
        companyId,
        runNumber,
        payrollMonth: month,
        payrollYear: year,
        branchId,
        currency: DEFAULT_CURRENCY,
        status: "draft",
        notes: String(payload.notes || "").trim(),
        createdBy: user._id,
        updatedBy: user._id,
        employeeCount: employees.length,
    });

    const lineDocs = [];
    for (const emp of employees) {
        const payrollNumber = await generatePayrollCode();
        const name =
            emp.fullName ||
            `${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
            "Employee";
        lineDocs.push({
            companyId,
            payrollRunId: run._id,
            payrollNumber,
            branchId: emp.branchId || branchId,
            departmentId: emp.departmentId || null,
            employeeId: emp._id,
            employeeCode: emp.employeeCode || "",
            employeeName: name,
            designation: emp.designation || "",
            payrollMonth: month,
            payrollYear: year,
            payrollPeriod: periodLabel(month, year),
            currency: DEFAULT_CURRENCY,
            salaryStructureId: emp.salaryStructureId || null,
            status: "draft",
            payrollStatus: "Draft",
            createdBy: user._id,
            updatedBy: user._id,
        });
    }

    if (lineDocs.length) {
        await Payroll.insertMany(lineDocs);
    }

    await auditRun({
        user,
        companyId,
        run,
        activityType: "Create",
        description: `Created payroll run ${run.runNumber} for ${periodLabel(month, year)}`,
        meta,
    });

    const lines = await Payroll.find({ payrollRunId: run._id, ...NOT_DELETED })
        .sort({ employeeName: 1 })
        .lean();

    return serializeRun(run, lines.map(serializeLine));
};

/**
 * Calculate / recalculate all lines from attendance + salary structures.
 */
const calculateRun = async (runId, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const run = await loadRun(runId, companyId);

    if (run.status === "calculated") {
        sm.assertTransition(run.status, "draft");
        run.status = "draft";
    }
    if (run.status !== "draft") {
        throw new AppError(
            `Cannot calculate payroll run in status ${run.status}.`,
            400
        );
    }

    sm.assertTransition("draft", "calculating");
    run.status = "calculating";
    run.calculationError = "";
    run.updatedBy = user._id;
    await run.save();

    try {
        const report = await getMonthlyReport(
            {
                year: run.payrollYear,
                month: run.payrollMonth,
                branchId: run.branchId ? String(run.branchId) : undefined,
            },
            null
        );

        const byEmp = new Map();
        for (const row of report.employees || []) {
            byEmp.set(String(row.employeeId), row);
        }

        const lines = await Payroll.find({
            payrollRunId: run._id,
            ...NOT_DELETED,
            status: { $ne: "cancelled" },
        });

        for (const line of lines) {
            const emp = await Employee.findOne({
                _id: line.employeeId,
                ...NOT_DELETED,
            }).select(
                "salaryStructureId employeeCode fullName firstName lastName designation branchId departmentId"
            );
            if (!emp) {
                applyLineStatus(line, "skipped");
                line.skipReason = "Employee not found";
                line.updatedBy = user._id;
                await line.save();
                continue;
            }

            const structure = await resolveStructureForEmployee(emp, companyId);
            const attendanceRow = byEmp.get(String(emp._id)) || {};
            const calc = calculateEmployeePayroll({
                structure,
                attendanceRow,
                adjustmentMinor: line.adjustmentMinor || 0,
            });

            if (calc.skipped) {
                applyLineStatus(line, "skipped");
                line.skipReason = calc.skipReason || "Skipped";
                line.salaryStructureId = null;
                line.basicSalaryMinor = 0;
                line.earningMinor = 0;
                line.deductionMinor = 0;
                line.overtimeAmountMinor = 0;
                line.grossSalaryMinor = 0;
                line.netSalaryMinor = 0;
                line.salaryComponents = [];
                syncMajorFromMinor(line, run.currency);
                line.updatedBy = user._id;
                await line.save();
                continue;
            }

            const att = calc.attendance;
            line.salaryStructureId = structure._id;
            line.salaryType = calc.salaryType;
            line.totalWorkingDays = att.totalWorkingDays;
            line.presentDays = att.rawPresentDays;
            line.absentDays = att.absentDays;
            line.leaveDays = att.leaveDays;
            line.halfDays = att.halfDays;
            line.lateMinutes = att.lateMinutes;
            line.earlyLeaveMinutes = att.earlyLeaveMinutes;
            line.totalWorkingMinutes = att.workedMinutes;
            line.totalWorkingHours = Number(att.workedHours.toFixed(2));
            line.approvedOvertimeMinutes = att.approvedOvertimeMinutes;
            line.overtimeHours = Number(att.overtimeHours.toFixed(2));

            line.basicSalaryMinor = calc.basicSalaryMinor;
            line.earningMinor = calc.earningMinor;
            line.deductionMinor = calc.deductionMinor;
            line.overtimeAmountMinor = calc.overtimeAmountMinor;
            line.grossSalaryMinor = calc.grossSalaryMinor;
            line.netSalaryMinor = calc.netSalaryMinor;
            line.adjustmentMinor = calc.adjustmentMinor;
            line.salaryComponents = calc.salaryComponents;
            line.skipReason = "";
            syncMajorFromMinor(line, calc.currency);
            applyLineStatus(line, "calculated");
            line.updatedBy = user._id;
            await line.save();
        }

        await recomputeRunTotals(run);
        sm.assertTransition("calculating", "calculated");
        run.status = "calculated";
        run.calculatedAt = new Date();
        run.updatedBy = user._id;
        await run.save();

        await auditRun({
            user,
            companyId,
            run,
            activityType: "Update",
            description: `Calculated payroll run ${run.runNumber}`,
            meta,
            securityLevel: "High",
        });
    } catch (err) {
        run.status = "draft";
        run.calculationError = err.message || String(err);
        run.updatedBy = user._id;
        await run.save();
        throw err;
    }

    const outLines = await Payroll.find({
        payrollRunId: run._id,
        ...NOT_DELETED,
    })
        .sort({ employeeName: 1 })
        .lean();

    return serializeRun(run, outLines.map(serializeLine));
};

/**
 * Manual net adjustment on a calculated line (before approval).
 */
const adjustLine = async (payrollId, payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const line = await Payroll.findOne({
        _id: payrollId,
        companyId,
        ...NOT_DELETED,
    });
    if (!line) throw new AppError("Payroll line not found.", 404);

    const run = await loadRun(line.payrollRunId, companyId);
    if (!["draft", "calculated"].includes(run.status)) {
        throw new AppError(
            `Cannot adjust lines when run is ${run.status}.`,
            400
        );
    }
    if (!["draft", "calculated", "skipped"].includes(line.status)) {
        throw new AppError(`Cannot adjust line in status ${line.status}.`, 400);
    }

    let adjustmentMinor = line.adjustmentMinor || 0;
    if (payload.adjustmentMinor != null) {
        adjustmentMinor = Math.round(Number(payload.adjustmentMinor));
    } else if (payload.adjustmentAmount != null) {
        adjustmentMinor = Math.round(Number(payload.adjustmentAmount) * 100);
    }

    if (payload.notes != null) {
        line.notes = String(payload.notes).trim();
    }
    line.adjustmentMinor = adjustmentMinor;
    line.updatedBy = user._id;

    // Recalc from structure if present
    if (line.salaryStructureId && line.status !== "skipped") {
        const structure = await SalaryStructure.findOne({
            _id: line.salaryStructureId,
            companyId,
            ...NOT_DELETED,
        }).lean();
        const attendanceRow = {
            payroll: {
                presentDays: line.presentDays,
                workingDays: line.totalWorkingDays,
                absentDays: line.absentDays,
                leaveDays: line.leaveDays,
                halfDays: line.halfDays,
                lateMinutes: line.lateMinutes,
                earlyLeaveMinutes: line.earlyLeaveMinutes,
                approvedOvertimeMinutes: line.approvedOvertimeMinutes,
            },
            totalWorkingMinutes: line.totalWorkingMinutes,
            present: line.presentDays,
            absent: line.absentDays,
            leave: line.leaveDays,
            halfDay: line.halfDays,
            approvedOvertimeMinutes: line.approvedOvertimeMinutes,
        };
        const calc = calculateEmployeePayroll({
            structure,
            attendanceRow,
            adjustmentMinor,
        });
        if (!calc.skipped) {
            line.basicSalaryMinor = calc.basicSalaryMinor;
            line.earningMinor = calc.earningMinor;
            line.deductionMinor = calc.deductionMinor;
            line.overtimeAmountMinor = calc.overtimeAmountMinor;
            line.grossSalaryMinor = calc.grossSalaryMinor;
            line.netSalaryMinor = calc.netSalaryMinor;
            line.salaryComponents = calc.salaryComponents;
            syncMajorFromMinor(line, calc.currency);
            applyLineStatus(line, "calculated");
        }
    } else {
        syncMajorFromMinor(line, run.currency);
    }

    await line.save();

    if (run.status === "draft") {
        // keep draft until full calculate
    } else {
        await recomputeRunTotals(run);
        run.updatedBy = user._id;
        await run.save();
    }

    await writeActivityLog({
        user,
        companyId,
        branchId: line.branchId || null,
        activityType: "Update",
        module: "Payroll",
        subModule: "Payroll",
        description: `Adjusted payroll ${line.payrollNumber}`,
        referenceType: "Payroll",
        referenceId: line._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "High",
    });

    return serializeLine(line);
};

const submitForApproval = async (runId, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const run = await loadRun(runId, companyId);
    sm.assertTransition(run.status, "pendingApproval");
    if (run.calculatedCount < 1) {
        throw new AppError("Calculate the run before submitting.", 400);
    }
    run.status = "pendingApproval";
    run.submittedAt = new Date();
    run.updatedBy = user._id;
    await run.save();

    await auditRun({
        user,
        companyId,
        run,
        activityType: "Update",
        description: `Submitted payroll run ${run.runNumber} for approval`,
        meta,
        securityLevel: "High",
    });

    return serializeRun(run);
};

const approveRun = async (runId, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can approve payroll runs.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const run = await loadRun(runId, companyId);
    sm.assertTransition(run.status, "approved");

    run.status = "approved";
    run.approvedAt = new Date();
    run.approvedBy = user._id;
    run.updatedBy = user._id;
    await run.save();

    await Payroll.updateMany(
        {
            payrollRunId: run._id,
            ...NOT_DELETED,
            status: "calculated",
        },
        {
            $set: {
                status: "approved",
                payrollStatus: "Approved",
                approvedBy: user._id,
                approvedAt: new Date(),
                updatedBy: user._id,
            },
        }
    );

    await auditRun({
        user,
        companyId,
        run,
        activityType: "Approve",
        description: `Approved payroll run ${run.runNumber}`,
        meta,
        securityLevel: "High",
    });

    return serializeRun(run);
};

const lockRun = async (runId, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only owners can lock payroll runs.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const run = await loadRun(runId, companyId);
    sm.assertTransition(run.status, "locked");

    run.status = "locked";
    run.lockedAt = new Date();
    run.lockedBy = user._id;
    run.updatedBy = user._id;
    await run.save();

    await auditRun({
        user,
        companyId,
        run,
        activityType: "Update",
        description: `Locked payroll run ${run.runNumber}`,
        meta,
        securityLevel: "High",
    });

    return serializeRun(run);
};

const cancelRun = async (runId, payload = {}, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const run = await loadRun(runId, companyId);

    if (["locked", "paid"].includes(run.status)) {
        throw new AppError(
            `Cannot cancel a ${run.status} payroll run.`,
            400
        );
    }
    if (!isOwner(user) && run.status === "approved") {
        throw new AppError("Only owners can cancel an approved run.", 403);
    }

    sm.assertTransition(run.status, "cancelled");
    run.status = "cancelled";
    run.cancelledAt = new Date();
    run.cancelledBy = user._id;
    run.cancelReason = String(payload.reason || payload.notes || "").trim();
    run.updatedBy = user._id;
    await run.save();

    await Payroll.updateMany(
        {
            payrollRunId: run._id,
            ...NOT_DELETED,
            status: { $nin: ["paid"] },
        },
        {
            $set: {
                status: "cancelled",
                payrollStatus: "Cancelled",
                updatedBy: user._id,
            },
        }
    );

    await auditRun({
        user,
        companyId,
        run,
        activityType: "Cancel",
        description: `Cancelled payroll run ${run.runNumber}`,
        meta,
        securityLevel: "High",
    });

    return serializeRun(run);
};

const listRuns = async (companyId, query = {}) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const filter = { companyId, ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.year) filter.payrollYear = parseInt(query.year, 10);
    if (query.month) filter.payrollMonth = parseInt(query.month, 10);
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }

    const [items, total] = await Promise.all([
        PayrollRun.find(filter)
            .sort({ payrollYear: -1, payrollMonth: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        PayrollRun.countDocuments(filter),
    ]);

    return {
        items: items.map((r) => serializeRun(r)),
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    };
};

const getRunById = async (runId, companyId, { includeLines = true } = {}) => {
    const run = await loadRun(runId, companyId);
    if (!includeLines) return serializeRun(run);
    const lines = await Payroll.find({
        payrollRunId: run._id,
        ...NOT_DELETED,
    })
        .sort({ employeeName: 1 })
        .lean();
    return serializeRun(run, lines.map(serializeLine));
};

const getLineById = async (payrollId, companyId) => {
    const line = await Payroll.findOne({
        _id: payrollId,
        companyId,
        ...NOT_DELETED,
    }).lean();
    if (!line) throw new AppError("Payroll line not found.", 404);
    return serializeLine(line);
};

const listLines = async (companyId, query = {}) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const filter = { companyId, ...NOT_DELETED };

    if (query.payrollRunId && toObjectId(query.payrollRunId)) {
        filter.payrollRunId = toObjectId(query.payrollRunId);
    }
    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }
    if (query.status) filter.status = query.status;
    if (query.year) filter.payrollYear = parseInt(query.year, 10);
    if (query.month) filter.payrollMonth = parseInt(query.month, 10);

    const [items, total] = await Promise.all([
        Payroll.find(filter)
            .sort({ payrollYear: -1, payrollMonth: -1, employeeName: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        Payroll.countDocuments(filter),
    ]);

    return {
        items: items.map(serializeLine),
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    };
};

/**
 * Mark a locked-run payroll line as paid (Phase 7 salary payment).
 */
const markLinePaid = async (
    payrollId,
    { companyId, paymentId = null, actorId = null, session = null } = {}
) => {
    let q = Payroll.findOne({
        _id: payrollId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) q = q.session(session);
    const line = await q;
    if (!line) throw new AppError("Payroll line not found.", 404);

    if (line.status === "paid") {
        return serializeLine(line);
    }
    if (!["approved", "calculated"].includes(line.status)) {
        throw new AppError(
            `Cannot pay payroll line in status ${line.status}.`,
            400
        );
    }

    const run = await loadRun(line.payrollRunId, companyId);
    if (!["locked", "paid"].includes(run.status)) {
        throw new AppError(
            `Payroll run must be locked before paying lines (status=${run.status}).`,
            400
        );
    }

    applyLineStatus(line, "paid");
    line.paymentStatus = "Completed";
    line.paymentId = toObjectId(paymentId);
    line.paidAt = new Date();
    if (actorId) line.updatedBy = actorId;
    await line.save({ session });
    return serializeLine(line);
};

/**
 * Undo line paid status after payment reverse.
 */
const unmarkLinePaid = async (
    payrollId,
    { companyId, actorId = null, session = null } = {}
) => {
    let q = Payroll.findOne({
        _id: payrollId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) q = q.session(session);
    const line = await q;
    if (!line) throw new AppError("Payroll line not found.", 404);
    if (line.status !== "paid") return serializeLine(line);

    applyLineStatus(line, "approved");
    line.paymentStatus = "Pending";
    line.paymentId = null;
    line.paidAt = null;
    if (actorId) line.updatedBy = actorId;
    await line.save({ session });
    return serializeLine(line);
};

/**
 * If every payable line is paid, transition run locked → paid.
 */
const tryMarkRunPaid = async (
    runId,
    { companyId, actorId = null, session = null } = {}
) => {
    let runQ = PayrollRun.findOne({
        _id: runId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) runQ = runQ.session(session);
    const run = await runQ;
    if (!run) throw new AppError("Payroll run not found.", 404);
    if (run.status === "paid") return serializeRun(run);
    if (run.status !== "locked") return serializeRun(run);

    let linesQ = Payroll.find({
        payrollRunId: run._id,
        ...NOT_DELETED,
        status: { $nin: ["cancelled", "skipped"] },
    });
    if (session) linesQ = linesQ.session(session);
    const lines = await linesQ.select("status").lean();
    if (!lines.length) return serializeRun(run);

    const allPaid = lines.every((l) => l.status === "paid");
    if (!allPaid) return serializeRun(run);

    sm.assertTransition(run.status, "paid");
    run.status = "paid";
    run.paidAt = new Date();
    if (actorId) run.updatedBy = actorId;
    await run.save({ session });
    return serializeRun(run);
};

/**
 * After reverse: if run was paid and a line is unpaid, unlock to locked.
 */
const tryUnlockRunAfterReverse = async (
    runId,
    { companyId, actorId = null, session = null } = {}
) => {
    let runQ = PayrollRun.findOne({
        _id: runId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) runQ = runQ.session(session);
    const run = await runQ;
    if (!run || run.status !== "paid") {
        return run ? serializeRun(run) : null;
    }

    sm.assertTransition(run.status, "locked");
    run.status = "locked";
    run.paidAt = null;
    if (actorId) run.updatedBy = actorId;
    await run.save({ session });
    return serializeRun(run);
};

module.exports = {
    createRun,
    calculateRun,
    adjustLine,
    submitForApproval,
    approveRun,
    lockRun,
    cancelRun,
    listRuns,
    getRunById,
    getLineById,
    listLines,
    markLinePaid,
    unmarkLinePaid,
    tryMarkRunPaid,
    tryUnlockRunAfterReverse,
    serializeRun,
    serializeLine,
};
