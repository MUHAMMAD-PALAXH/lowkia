const mongoose = require("mongoose");
const SalaryStructure = require("../model/salaryStructure");
const Employee = require("../model/employee");
const Payroll = require("../model/payroll");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    assertCurrency,
    toMinor,
    toMajor,
    formatMoney,
    assertNonNegativeMinor,
} = require("../utils/money");
const { generateSalaryStructureCode } = require("./codeGenerator");
const {
    ensureUserCompany,
    assertDocumentCompany,
} = require("./companyService");
const { writeActivityLog } = require("./activityLogService");
const {
    normalizeSalaryType,
    normalizeComponent,
    previewStructurePay,
    defaultComponentTemplates,
} = require("./salaryStructureCalculator");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const syncMajorMirrors = (doc, currency = DEFAULT_CURRENCY) => {
    doc.basicSalary = toMajor(doc.basicSalaryMinor || 0, currency);
    doc.dailyRate = toMajor(doc.dailyRateMinor || 0, currency);
    doc.hourlyRate = toMajor(doc.hourlyRateMinor || 0, currency);
    doc.overtimeRate = toMajor(doc.overtimeRateMinor || 0, currency);
    const preview = previewStructurePay(doc);
    doc.grossSalaryMinor = preview.grossMinor;
    doc.grossSalary = preview.amounts.gross;
    return doc;
};

const serialize = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    const preview = previewStructurePay(plain);
    return {
        ...plain,
        preview,
    };
};

const resolveRatesFromPayload = (payload = {}, currency) => {
    const type = normalizeSalaryType(payload.salaryType);

    const pickMinor = (minorKey, majorKey) => {
        if (payload[minorKey] != null) {
            return assertNonNegativeMinor(payload[minorKey], minorKey);
        }
        if (payload[majorKey] != null) {
            return toMinor(payload[majorKey], currency);
        }
        return 0;
    };

    const basicSalaryMinor = pickMinor("basicSalaryMinor", "basicSalary");
    const dailyRateMinor = pickMinor("dailyRateMinor", "dailyRate");
    const hourlyRateMinor = pickMinor("hourlyRateMinor", "hourlyRate");
    let overtimeRateMinor = pickMinor("overtimeRateMinor", "overtimeRate");

    // Derive missing rates from basic for convenience
    const workingDays = Math.max(
        1,
        Math.min(31, parseInt(payload.workingDaysPerMonth, 10) || 22)
    );
    const workingHours = Math.max(
        1,
        Math.min(24, Number(payload.workingHoursPerDay) || 8)
    );

    let basic = basicSalaryMinor;
    let daily = dailyRateMinor;
    let hourly = hourlyRateMinor;

    if (type === "Monthly" && basic > 0) {
        if (!daily) daily = Math.round(basic / workingDays);
        if (!hourly) hourly = Math.round(basic / (workingDays * workingHours));
    } else if (type === "Daily" && daily > 0) {
        if (!basic) basic = daily * workingDays;
        if (!hourly) hourly = Math.round(daily / workingHours);
    } else if (type === "Hourly" && hourly > 0) {
        if (!daily) daily = hourly * workingHours;
        if (!basic) basic = hourly * workingDays * workingHours;
    }

    if (!overtimeRateMinor && hourly > 0) {
        const mult = Number(payload.overtimeMultiplier) || 1.5;
        overtimeRateMinor = Math.round(hourly * mult);
    }

    return {
        salaryType: type,
        basicSalaryMinor: basic,
        dailyRateMinor: daily,
        hourlyRateMinor: hourly,
        overtimeRateMinor,
        workingDaysPerMonth: workingDays,
        workingHoursPerDay: workingHours,
        overtimeMultiplier: Number(payload.overtimeMultiplier) || 1.5,
    };
};

const populateStructure = (q) =>
    q
        .populate("employeeId", "employeeCode fullName salaryType")
        .populate("assignedEmployees", "employeeCode fullName")
        .populate("branchId", "branchCode name")
        .populate("createdBy", "firstName lastName email");

const createStructure = async (payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const currency = assertCurrency(payload.currency || DEFAULT_CURRENCY);

    const name = String(payload.structureName || "").trim();
    if (!name) throw new AppError("structureName is required.", 400);

    const rates = resolveRatesFromPayload(payload, currency);
    if (
        rates.salaryType === "Monthly" &&
        rates.basicSalaryMinor <= 0 &&
        !payload.allowZero
    ) {
        throw new AppError("basicSalary is required for Monthly structures.", 400);
    }
    if (rates.salaryType === "Daily" && rates.dailyRateMinor <= 0) {
        throw new AppError("dailyRate is required for Daily structures.", 400);
    }
    if (rates.salaryType === "Hourly" && rates.hourlyRateMinor <= 0) {
        throw new AppError("hourlyRate is required for Hourly structures.", 400);
    }

    let components = Array.isArray(payload.components)
        ? payload.components.map((c) => normalizeComponent(c, currency))
        : [];
    if (payload.includeDefaults === true && components.length === 0) {
        components = defaultComponentTemplates().map((c) =>
            normalizeComponent(c, currency)
        );
    }

    const structureCode =
        String(payload.structureCode || "").trim().toUpperCase() ||
        (await generateSalaryStructureCode());

    const doc = new SalaryStructure({
        companyId,
        branchId: toObjectId(payload.branchId),
        structureName: name,
        structureCode,
        description: String(payload.description || "").trim(),
        currency,
        ...rates,
        components,
        departmentId: toObjectId(payload.departmentId),
        designationId: toObjectId(payload.designationId),
        employeeId: toObjectId(payload.employeeId),
        assignedEmployees: Array.isArray(payload.assignedEmployees)
            ? payload.assignedEmployees.map(toObjectId).filter(Boolean)
            : [],
        overtimeEnabled: payload.overtimeEnabled !== false,
        effectiveFrom: payload.effectiveFrom
            ? new Date(payload.effectiveFrom)
            : new Date(),
        effectiveTo: payload.effectiveTo ? new Date(payload.effectiveTo) : null,
        isCurrent: payload.isCurrent !== false,
        status: payload.status === "draft" ? "draft" : "active",
        createdBy: user._id,
    });

    syncMajorMirrors(doc, currency);
    await doc.save();

    if (doc.employeeId) {
        await Employee.updateOne(
            { _id: doc.employeeId, ...NOT_DELETED },
            {
                $set: {
                    salaryStructureId: doc._id,
                    salaryType: doc.salaryType,
                    basicSalary: doc.basicSalary,
                    hourlyRate: doc.hourlyRate,
                    overtimeRate: doc.overtimeRate,
                    updatedBy: user._id,
                },
            }
        );
    }

    await writeActivityLog({
        user,
        companyId,
        branchId: doc.branchId,
        activityType: "Create",
        module: "Payroll",
        subModule: "SalaryStructure",
        description: `Salary structure ${doc.structureCode} created`,
        referenceType: "Payroll",
        referenceId: doc._id,
        newData: {
            structureCode: doc.structureCode,
            salaryType: doc.salaryType,
            basicSalaryMinor: doc.basicSalaryMinor,
        },
        ipAddress: meta.ipAddress || "",
        securityLevel: "High",
    });

    return serialize(await populateStructure(SalaryStructure.findById(doc._id)));
};

const updateStructure = async (id, payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const doc = await SalaryStructure.findOne({ _id: id, ...NOT_DELETED });
    assertDocumentCompany(doc, companyId, "Salary structure");

    if (doc.status === "archived") {
        throw new AppError("Archived structures cannot be edited. Create a revision.", 400);
    }

    const currency = assertCurrency(payload.currency || doc.currency || DEFAULT_CURRENCY);
    if (payload.structureName != null) {
        doc.structureName = String(payload.structureName).trim() || doc.structureName;
    }
    if (payload.description != null) {
        doc.description = String(payload.description).trim();
    }
    if (payload.branchId !== undefined) {
        doc.branchId = toObjectId(payload.branchId);
    }
    if (payload.salaryType || payload.basicSalary != null || payload.basicSalaryMinor != null ||
        payload.dailyRate != null || payload.hourlyRate != null) {
        const rates = resolveRatesFromPayload(
            { ...doc.toObject(), ...payload },
            currency
        );
        Object.assign(doc, rates);
    }
    if (Array.isArray(payload.components)) {
        doc.components = payload.components.map((c) =>
            normalizeComponent(c, currency)
        );
    }
    if (payload.overtimeEnabled != null) {
        doc.overtimeEnabled = payload.overtimeEnabled === true;
    }
    if (payload.overtimeMultiplier != null) {
        doc.overtimeMultiplier = Number(payload.overtimeMultiplier) || 1.5;
    }
    if (payload.status && ["draft", "active", "archived"].includes(payload.status)) {
        doc.status = payload.status;
        if (payload.status === "archived") doc.isCurrent = false;
        if (payload.status === "active") doc.isCurrent = true;
    }
    if (payload.effectiveFrom) doc.effectiveFrom = new Date(payload.effectiveFrom);
    if (payload.effectiveTo !== undefined) {
        doc.effectiveTo = payload.effectiveTo
            ? new Date(payload.effectiveTo)
            : null;
    }

    doc.currency = currency;
    doc.updatedBy = user._id;
    syncMajorMirrors(doc, currency);
    await doc.save();

    if (doc.employeeId) {
        await Employee.updateOne(
            { _id: doc.employeeId, ...NOT_DELETED },
            {
                $set: {
                    salaryType: doc.salaryType,
                    basicSalary: doc.basicSalary,
                    hourlyRate: doc.hourlyRate,
                    overtimeRate: doc.overtimeRate,
                    updatedBy: user._id,
                },
            }
        );
    }

    await writeActivityLog({
        user,
        companyId,
        branchId: doc.branchId,
        activityType: "Update",
        module: "Payroll",
        subModule: "SalaryStructure",
        description: `Salary structure ${doc.structureCode} updated`,
        referenceType: "Payroll",
        referenceId: doc._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "High",
    });

    return serialize(await populateStructure(SalaryStructure.findById(doc._id)));
};

const listStructures = async (companyId, query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { companyId, ...NOT_DELETED };
    if (query.status) filter.status = String(query.status);
    if (query.salaryType) {
        filter.salaryType = normalizeSalaryType(query.salaryType);
    }
    if (query.employeeId) filter.employeeId = toObjectId(query.employeeId);
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.currentOnly === "true" || query.currentOnly === true) {
        filter.isCurrent = true;
        filter.status = "active";
    }
    if (query.search) {
        const s = String(query.search).trim();
        filter.$or = [
            { structureName: { $regex: s, $options: "i" } },
            { structureCode: { $regex: s, $options: "i" } },
        ];
    }

    const [items, total] = await Promise.all([
        populateStructure(
            SalaryStructure.find(filter)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
        ),
        SalaryStructure.countDocuments(filter),
    ]);

    const structureIds = items.map((d) => d._id);
    const empCountRows = structureIds.length
        ? await Employee.aggregate([
              {
                  $match: {
                      salaryStructureId: { $in: structureIds },
                      isDeleted: { $ne: true },
                  },
              },
              { $group: { _id: "$salaryStructureId", n: { $sum: 1 } } },
          ])
        : [];
    const empCountMap = Object.fromEntries(
        empCountRows.map((r) => [String(r._id), r.n])
    );

    return {
        items: items.map((doc) => {
            const s = serialize(doc);
            const assigned = new Set(
                (s.assignedEmployees || []).map((e) =>
                    String(e?._id || e?.id || e)
                )
            );
            if (s.employeeId) {
                assigned.add(String(s.employeeId._id || s.employeeId.id || s.employeeId));
            }
            const linked = empCountMap[String(doc._id)] || 0;
            s.employeeCount = Math.max(assigned.size, linked);
            return s;
        }),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
};

const getStructureById = async (id, companyId) => {
    const doc = await populateStructure(
        SalaryStructure.findOne({ _id: id, ...NOT_DELETED })
    );
    assertDocumentCompany(doc, companyId, "Salary structure");
    return serialize(doc);
};

const assignToEmployee = async (structureId, employeeId, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);

    const structure = await SalaryStructure.findOne({
        _id: structureId,
        ...NOT_DELETED,
    });
    assertDocumentCompany(structure, companyId, "Salary structure");
    if (structure.status === "archived") {
        throw new AppError("Cannot assign an archived structure.", 400);
    }

    const employee = await Employee.findOne({
        _id: employeeId,
        ...NOT_DELETED,
    });
    if (!employee) throw new AppError("Employee not found.", 404);

    // Mark prior current structures for this employee as not current
    await SalaryStructure.updateMany(
        {
            companyId,
            employeeId: employee._id,
            isCurrent: true,
            _id: { $ne: structure._id },
            ...NOT_DELETED,
        },
        { $set: { isCurrent: false, updatedBy: user._id } }
    );

    structure.employeeId = employee._id;
    if (!structure.assignedEmployees.some((id) => String(id) === String(employee._id))) {
        structure.assignedEmployees.push(employee._id);
    }
    structure.isCurrent = true;
    structure.status = "active";
    structure.updatedBy = user._id;
    await structure.save();

    employee.salaryStructureId = structure._id;
    employee.salaryType = structure.salaryType;
    employee.basicSalary = structure.basicSalary;
    employee.hourlyRate = structure.hourlyRate;
    employee.overtimeRate = structure.overtimeRate;
    employee.updatedBy = user._id;
    await employee.save();

    await writeActivityLog({
        user,
        companyId,
        branchId: structure.branchId || employee.branchId,
        activityType: "Update",
        module: "Payroll",
        subModule: "SalaryStructure",
        description: `Assigned ${structure.structureCode} to ${employee.fullName || employee.employeeCode}`,
        referenceType: "Payroll",
        referenceId: structure._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "High",
    });

    return {
        structure: serialize(
            await populateStructure(SalaryStructure.findById(structure._id))
        ),
        employee: {
            id: employee._id,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            salaryType: employee.salaryType,
            salaryStructureId: employee.salaryStructureId,
        },
    };
};

const preview = async (id, companyId, attendance = {}) => {
    const doc = await SalaryStructure.findOne({ _id: id, ...NOT_DELETED });
    assertDocumentCompany(doc, companyId, "Salary structure");
    return {
        structure: {
            id: doc._id,
            structureCode: doc.structureCode,
            structureName: doc.structureName,
            salaryType: doc.salaryType,
        },
        preview: previewStructurePay(doc, attendance),
    };
};

const archiveStructure = async (id, user, meta = {}) => {
    return updateStructure(
        id,
        { status: "archived", isCurrent: false },
        user,
        meta
    );
};

const restoreStructure = async (id, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const doc = await SalaryStructure.findOne({ _id: id, ...NOT_DELETED });
    assertDocumentCompany(doc, companyId, "Salary structure");

    doc.status = "active";
    doc.isCurrent = true;
    doc.updatedBy = user._id;
    await doc.save();

    await writeActivityLog({
        user,
        companyId,
        branchId: doc.branchId,
        activityType: "Update",
        module: "Payroll",
        subModule: "SalaryStructure",
        description: `Salary structure ${doc.structureCode} restored from archive`,
        referenceType: "Payroll",
        referenceId: doc._id,
        ipAddress: meta.ipAddress || "",
        securityLevel: "High",
    });

    return serialize(await populateStructure(SalaryStructure.findById(doc._id)));
};

const getEmployeeStructure = async (employeeId, companyId) => {
    const employee = await Employee.findOne({
        _id: employeeId,
        ...NOT_DELETED,
    }).select(
        "employeeCode fullName salaryType basicSalary hourlyRate overtimeRate salaryStructureId branchId"
    );
    if (!employee) throw new AppError("Employee not found.", 404);

    let structure = null;
    if (employee.salaryStructureId) {
        structure = await SalaryStructure.findOne({
            _id: employee.salaryStructureId,
            companyId,
            ...NOT_DELETED,
        });
    }
    if (!structure) {
        structure = await SalaryStructure.findOne({
            companyId,
            employeeId: employee._id,
            isCurrent: true,
            ...NOT_DELETED,
        }).sort({ updatedAt: -1 });
    }

    return {
        employee,
        structure: structure ? serialize(structure) : null,
    };
};

const moneyPack = (minor, currency = DEFAULT_CURRENCY) => ({
    amountMinor: minor,
    amount: toMajor(minor, currency),
    formatted: formatMoney(minor, currency),
});

const asCalendarDay = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const formatCalendarDay = (value) => {
    const d = value instanceof Date ? value : asCalendarDay(value);
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const daysInclusive = (from, to) =>
    Math.round((to.getTime() - from.getTime()) / 86400000) + 1;

const resolveJoinDate = (emp) =>
    asCalendarDay(emp.joiningDate) || asCalendarDay(emp.createdAt);

const scalePreview = (preview, factor) => {
    const currency = preview.currency || DEFAULT_CURRENCY;
    const scale = (n) => Math.round((Number(n) || 0) * factor);
    const basicMinor = scale(preview.basicMinor);
    const earningMinor = scale(preview.earningMinor);
    const deductionMinor = scale(preview.deductionMinor);
    const grossMinor = scale(preview.grossMinor);
    const netMinor = scale(preview.netMinor);
    return {
        ...preview,
        basicMinor,
        earningMinor,
        deductionMinor,
        grossMinor,
        netMinor,
        amounts: {
            basic: toMajor(basicMinor, currency),
            earnings: toMajor(earningMinor, currency),
            deductions: toMajor(deductionMinor, currency),
            gross: toMajor(grossMinor, currency),
            net: toMajor(netMinor, currency),
        },
    };
};

const buildPeriodCalculation = async ({
    empMatch,
    year,
    month,
    day,
    periodLabel,
    periodPaidMinor,
}) => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const payableDays = day ? 1 : daysInMonth;

    const periodStart = new Date(year, month - 1, day || 1);
    const periodEnd = new Date(year, month - 1, day || daysInMonth);

    let employees = await Employee.find(empMatch)
        .select(
            "fullName employeeCode salaryType basicSalary salaryStructureId joiningDate createdAt"
        )
        .lean();
    if (!employees.length) {
        employees = await Employee.find({
            ...NOT_DELETED,
            isActive: { $ne: false },
        })
            .select(
                "fullName employeeCode salaryType basicSalary salaryStructureId joiningDate createdAt"
            )
            .lean();
    }

    const structureIds = employees
        .map((e) => e.salaryStructureId)
        .filter(Boolean);
    const structures = await SalaryStructure.find({
        _id: { $in: structureIds },
        ...NOT_DELETED,
    }).lean();
    const byId = new Map(structures.map((s) => [String(s._id), s]));

    const typeBuckets = { Monthly: [], Daily: [], Hourly: [] };
    const employeeRows = [];
    let unassigned = 0;
    let notYetJoined = 0;
    let basicMinor = 0;
    let earningMinor = 0;
    let deductionMinor = 0;
    let grossMinor = 0;
    let netMinor = 0;

    for (const emp of employees) {
        const joinDate = resolveJoinDate(emp);
        const joinLabel = joinDate ? formatCalendarDay(joinDate) : "";
        const baseRow = {
            name: emp.fullName || "Employee",
            code: emp.employeeCode || "",
            joiningDate: joinLabel || null,
        };

        if (joinDate && joinDate > periodEnd) {
            notYetJoined += 1;
            employeeRows.push({
                ...baseRow,
                skipped: true,
                skipReason: `Joins ${joinLabel} — after this period`,
            });
            continue;
        }

        const structure = emp.salaryStructureId
            ? byId.get(String(emp.salaryStructureId))
            : null;
        const archived =
            structure && String(structure.status || "").toLowerCase() === "archived";
        if (!structure || archived) {
            unassigned += 1;
            employeeRows.push({
                ...baseRow,
                skipped: true,
                skipReason: archived
                    ? "Assigned structure is archived"
                    : "No salary structure assigned",
            });
            continue;
        }

        const payStart =
            joinDate && joinDate > periodStart ? joinDate : periodStart;
        const payableCalendarDays = Math.max(
            1,
            daysInclusive(payStart, periodEnd)
        );
        const fromJoin = Boolean(joinDate && joinDate > periodStart);
        const type = normalizeSalaryType(structure.salaryType);
        const hoursPerDay = Number(structure.workingHoursPerDay) || 8;
        const workingDays = Number(structure.workingDaysPerMonth) || 22;
        const daysForCalc = day
            ? 1
            : fromJoin
              ? Math.max(
                    1,
                    Math.round((workingDays * payableCalendarDays) / daysInMonth)
                )
              : workingDays;
        let attendance = {};
        let factor = 1;
        let formula = "";
        const fromNote = fromJoin ? ` from ${joinLabel}` : "";

        if (type === "Hourly") {
            const hours = daysForCalc * hoursPerDay;
            attendance = { workedHours: hours };
            formula = `${formatMoney(structure.hourlyRateMinor || 0)} × ${hours} hrs${fromNote}`;
        } else if (type === "Daily") {
            attendance = { presentDays: daysForCalc };
            formula = `${formatMoney(structure.dailyRateMinor || 0)} × ${daysForCalc} days${fromNote}`;
        } else {
            factor = payableCalendarDays / daysInMonth;
            formula =
                factor >= 0.999
                    ? `monthly basic ${formatMoney(structure.basicSalaryMinor || 0)}`
                    : `${formatMoney(structure.basicSalaryMinor || 0)} × ${payableCalendarDays}/${daysInMonth} days${fromNote}`;
        }

        let preview;
        try {
            preview = previewStructurePay(structure, attendance);
            if (factor !== 1) preview = scalePreview(preview, factor);
        } catch (_) {
            unassigned += 1;
            employeeRows.push({
                ...baseRow,
                skipped: true,
                skipReason: "Could not calculate this structure",
            });
            continue;
        }

        typeBuckets[type].push({ emp, structure, preview, formula });
        basicMinor += preview.basicMinor || 0;
        earningMinor += preview.earningMinor || 0;
        deductionMinor += preview.deductionMinor || 0;
        grossMinor += preview.grossMinor || 0;
        netMinor += preview.netMinor || 0;

        employeeRows.push({
            ...baseRow,
            salaryType: type,
            structureName: structure.structureName || "Structure",
            formula,
            payableDays: payableCalendarDays,
            basic: moneyPack(preview.basicMinor || 0),
            earnings: moneyPack(preview.earningMinor || 0),
            deductions: moneyPack(preview.deductionMinor || 0),
            net: moneyPack(preview.netMinor || 0),
        });
    }

    const assigned = employees.length - unassigned - notYetJoined;
    const paid = Number(periodPaidMinor) || 0;
    const due = Math.max(0, netMinor - paid);
    const steps = [];
    let n = 1;

    steps.push({
        n: n++,
        key: "period",
        title: "Select period",
        detail: day
            ? `${periodLabel} · 1 of ${daysInMonth} calendar days`
            : `${periodLabel} · ${daysInMonth} calendar days`,
        formula:
            "Pay starts on each employee's joining date (or added date) — earlier days are not counted",
    });

    steps.push({
        n: n++,
        key: "employees",
        title: "Employees in scope",
        detail: [
            `${employees.length} active`,
            `${assigned} assigned`,
            `${unassigned} unassigned`,
            notYetJoined ? `${notYetJoined} not yet joined` : null,
        ]
            .filter(Boolean)
            .join(" · "),
        count: employees.length,
        assigned,
        unassigned,
        notYetJoined,
    });

    for (const type of ["Monthly", "Daily", "Hourly"]) {
        const rows = typeBuckets[type];
        if (!rows.length) continue;
        const sum = rows.reduce((s, r) => s + (r.preview.basicMinor || 0), 0);
        const sample = rows
            .slice(0, 3)
            .map((r) => r.formula)
            .join("  +  ");
        steps.push({
            n: n++,
            key: `base_${type.toLowerCase()}`,
            title: `${type} base pay`,
            detail: `${rows.length} employee${rows.length === 1 ? "" : "s"} on ${type.toLowerCase()} templates`,
            formula: sample + (rows.length > 3 ? "  +  …" : ""),
            amount: moneyPack(sum),
            kind: "add",
        });
    }

    if (earningMinor > 0) {
        steps.push({
            n: n++,
            key: "earnings",
            title: "Allowances / earnings",
            detail: "Fixed and percentage components added to base",
            amount: moneyPack(earningMinor),
            kind: "add",
        });
    }

    steps.push({
        n: n++,
        key: "gross",
        title: "Gross salary",
        detail: "Base pay + allowances",
        formula: "basic + earnings",
        amount: moneyPack(grossMinor),
        kind: "subtotal",
    });

    if (deductionMinor > 0) {
        steps.push({
            n: n++,
            key: "deductions",
            title: "Deductions",
            detail: "Tax and other deduction components",
            amount: moneyPack(deductionMinor),
            kind: "subtract",
        });
    }

    steps.push({
        n: n++,
        key: "net",
        title: "Period total salary",
        detail: "Expected payroll for this filter",
        formula: "gross − deductions",
        amount: moneyPack(netMinor),
        kind: "total",
    });

    steps.push({
        n: n++,
        key: "paid",
        title: "Already paid",
        detail: "Payroll lines marked paid in this period",
        amount: moneyPack(paid),
        kind: "subtract",
    });

    steps.push({
        n: n++,
        key: "due",
        title: "Amount due",
        detail: "Remaining salary for the selected period",
        formula: "period total − paid",
        amount: moneyPack(due),
        kind: "due",
    });

    return {
        scope: day ? "day" : "month",
        periodLabel,
        year,
        month,
        day,
        calendarDays: daysInMonth,
        payableDays,
        employeeCount: employees.length,
        assignedCount: assigned,
        unassignedCount: unassigned,
        notYetJoinedCount: notYetJoined,
        steps,
        employees: employeeRows,
        totals: {
            basic: moneyPack(basicMinor),
            earnings: moneyPack(earningMinor),
            deductions: moneyPack(deductionMinor),
            gross: moneyPack(grossMinor),
            net: moneyPack(netMinor),
            paid: moneyPack(paid),
            due: moneyPack(due),
        },
    };
};

const sumPayrollNets = async (match) => {
    const rows = await Payroll.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                total: { $sum: "$netSalaryMinor" },
                paid: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ["$status", "paid"] },
                                    { $eq: ["$payrollStatus", "Paid"] },
                                    { $eq: ["$paymentStatus", "Completed"] },
                                ],
                            },
                            "$netSalaryMinor",
                            0,
                        ],
                    },
                },
            },
        },
    ]);
    const total = Number(rows[0]?.total) || 0;
    const paid = Number(rows[0]?.paid) || 0;
    return { total, paid, due: Math.max(0, total - paid) };
};

const getSalarySummary = async (companyId, query = {}) => {
    const now = new Date();
    const year = Math.max(
        2000,
        parseInt(query.year, 10) || now.getFullYear()
    );
    const month = Math.min(
        12,
        Math.max(1, parseInt(query.month, 10) || now.getMonth() + 1)
    );
    const dayRaw = parseInt(query.day, 10);
    const day =
        Number.isFinite(dayRaw) && dayRaw >= 1 && dayRaw <= 31 ? dayRaw : null;

    const empMatch = { ...NOT_DELETED, isActive: { $ne: false } };
    if (companyId) empMatch.companyId = companyId;

    const lineMatch = {
        ...NOT_DELETED,
        status: { $nin: ["cancelled", "skipped"] },
    };
    if (companyId) lineMatch.companyId = companyId;

    let [employeeCount, contracted, allTime] = await Promise.all([
        Employee.countDocuments(empMatch),
        Employee.aggregate([
            { $match: empMatch },
            {
                $group: {
                    _id: null,
                    basic: { $sum: { $ifNull: ["$basicSalary", 0] } },
                },
            },
        ]),
        sumPayrollNets(lineMatch),
    ]);

    if (employeeCount === 0) {
        const openEmp = { ...NOT_DELETED, isActive: { $ne: false } };
        [employeeCount, contracted] = await Promise.all([
            Employee.countDocuments(openEmp),
            Employee.aggregate([
                { $match: openEmp },
                {
                    $group: {
                        _id: null,
                        basic: { $sum: { $ifNull: ["$basicSalary", 0] } },
                    },
                },
            ]),
        ]);
    }

    const contractedMajor = Number(contracted[0]?.basic) || 0;
    const contractedMinor = Math.round(contractedMajor * 100);
    const totalsTotal = allTime.total > 0 ? allTime.total : contractedMinor;
    const totalsPaid = allTime.paid;
    const totalsDue = Math.max(0, totalsTotal - totalsPaid);

    const periodMatch = {
        ...lineMatch,
        payrollYear: year,
        payrollMonth: month,
    };
    if (day) {
        const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        periodMatch.$or = [
            { paidAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } },
        ];
    }
    const periodPayroll = await sumPayrollNets(periodMatch);
    const periodPaid = periodPayroll.paid;

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const periodLabel = day
        ? `${String(day).padStart(2, "0")} ${months[month - 1]} ${year}`
        : `${months[month - 1]} ${year}`;

    const calculation = await buildPeriodCalculation({
        empMatch,
        year,
        month,
        day,
        periodLabel,
        periodPaidMinor: periodPaid,
    });

    const periodTotal = calculation.totals.net.amountMinor;
    const periodDue = calculation.totals.due.amountMinor;

    return {
        employeeCount,
        currency: DEFAULT_CURRENCY,
        year,
        month,
        day,
        periodLabel,
        totals: {
            salary: moneyPack(totalsTotal),
            paid: moneyPack(totalsPaid),
            due: moneyPack(totalsDue),
        },
        period: {
            salary: moneyPack(periodTotal),
            paid: moneyPack(periodPaid),
            due: moneyPack(periodDue),
        },
        calculation,
    };
};

module.exports = {
    createStructure,
    updateStructure,
    listStructures,
    getStructureById,
    assignToEmployee,
    preview,
    archiveStructure,
    restoreStructure,
    getEmployeeStructure,
    getSalarySummary,
    serialize,
    syncMajorMirrors,
};
