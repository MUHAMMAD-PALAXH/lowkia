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
    const isCurrentPeriod =
        !day &&
        year === now.getFullYear() &&
        month === now.getMonth() + 1;
    const periodTotal =
        periodPayroll.total > 0
            ? periodPayroll.total
            : isCurrentPeriod
              ? contractedMinor
              : 0;
    const periodPaid = periodPayroll.paid;
    const periodDue = Math.max(0, periodTotal - periodPaid);

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const periodLabel = day
        ? `${String(day).padStart(2, "0")} ${months[month - 1]} ${year}`
        : `${months[month - 1]} ${year}`;

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
