const mongoose = require("mongoose");
const SalaryStructure = require("../model/salaryStructure");
const Employee = require("../model/employee");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    assertCurrency,
    toMinor,
    toMajor,
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

    return {
        items: items.map(serialize),
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

module.exports = {
    createStructure,
    updateStructure,
    listStructures,
    getStructureById,
    assignToEmployee,
    preview,
    archiveStructure,
    getEmployeeStructure,
    serialize,
    syncMajorMirrors,
};
