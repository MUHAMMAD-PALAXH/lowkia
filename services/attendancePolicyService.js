const AttendancePolicy = require("../model/attendancePolicy");
const { generateAttendancePolicyCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const settingsService = require("./settingsService");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(AttendancePolicy, {
    label: "Attendance policy",
    nameField: "policyName",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
        doc.isDefault = false;
    },
    restoreStatus: "Active"
});

const PROTECTED = [
    "policyCode",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdBy",
    "createdAt",
    "updatedAt",
    "companyId"
];

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickFields = (payload = {}) => {
    const data = { ...payload };
    PROTECTED.forEach((f) => delete data[f]);
    return data;
};

const clearOtherDefaults = async (exceptId = null, companyId = null) => {
    const filter = {
        isDefault: true,
        ...companyFilter(companyId),
        ...NOT_DELETED
    };
    if (exceptId) filter._id = { $ne: exceptId };
    await AttendancePolicy.updateMany(filter, { $set: { isDefault: false } });
};

const createPolicy = async (payload = {}, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const data = pickFields(payload);
    const policyName = String(data.policyName || "").trim();
    if (!policyName) {
        throw new AppError("Policy name is required.", 400);
    }

    const exists = await AttendancePolicy.findOne({
        policyName: { $regex: `^${escapeRegex(policyName)}$`, $options: "i" },
        ...tenant,
        ...NOT_DELETED
    });
    if (exists) {
        throw new AppError("Attendance policy name already exists.", 409);
    }

    const policyCode = await generateAttendancePolicyCode();
    const isDefault = data.isDefault === true;

    if (isDefault) await clearOtherDefaults(null, companyId);

    const count = await AttendancePolicy.countDocuments({
        ...tenant,
        ...NOT_DELETED
    });
    const makeDefault = isDefault || count === 0;

    const doc = await AttendancePolicy.create(
        stampCompany(
            {
                ...data,
                policyName,
                policyCode,
                isDefault: makeDefault,
                createdBy: actorId || null
            },
            companyId
        )
    );

    if (makeDefault) {
        const settings = await settingsService.getGlobalSettings(companyId);
        settings.defaultAttendancePolicyId = doc._id;
        await settings.save();
    }

    return doc;
};

const ensureDefaultPolicy = async (actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    let policy = await AttendancePolicy.findOne({
        isDefault: true,
        status: "Active",
        ...tenant,
        ...NOT_DELETED
    });
    if (policy) return policy;

    policy = await AttendancePolicy.findOne({
        status: "Active",
        ...tenant,
        ...NOT_DELETED
    }).sort({ createdAt: 1 });
    if (policy) {
        policy.isDefault = true;
        await policy.save();
        return policy;
    }

    return createPolicy(
        {
            policyName: "Default Attendance Policy",
            description: "Auto-created default policy",
            isDefault: true,
            weeklyOff: ["Friday"]
        },
        actorId,
        companyId
    );
};

const getPolicies = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };
    if (query.status) filter.status = query.status;
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { policyName: { $regex: s, $options: "i" } },
            { policyCode: { $regex: s, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        AttendancePolicy.find(filter)
            .sort({ isDefault: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit),
        AttendancePolicy.countDocuments(filter)
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

const getPolicyById = async (id, companyId = null) => {
    const doc = await AttendancePolicy.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!doc) throw new AppError("Attendance policy not found.", 404);
    return doc;
};

const getActiveOrDefault = async (companyId = null) =>
    ensureDefaultPolicy(null, companyId);

const updatePolicy = async (id, payload = {}, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const doc = await getPolicyById(id, companyId);
    const data = pickFields(payload);

    if (data.policyName) {
        const policyName = String(data.policyName).trim();
        const exists = await AttendancePolicy.findOne({
            _id: { $ne: id },
            policyName: {
                $regex: `^${escapeRegex(policyName)}$`,
                $options: "i"
            },
            ...tenant,
            ...NOT_DELETED
        });
        if (exists) {
            throw new AppError("Attendance policy name already exists.", 409);
        }
        data.policyName = policyName;
    }

    if (data.isDefault === true) {
        await clearOtherDefaults(id, companyId);
        const settings = await settingsService.getGlobalSettings(companyId);
        settings.defaultAttendancePolicyId = doc._id;
        await settings.save();
    }

    Object.assign(doc, data);
    doc.updatedBy = actorId || null;
    await doc.save();
    return doc;
};

const setDefault = async (id, actorId = null, companyId = null) => {
    const doc = await getPolicyById(id, companyId);
    await clearOtherDefaults(id, companyId);
    doc.isDefault = true;
    doc.status = "Active";
    doc.updatedBy = actorId || null;
    await doc.save();

    const settings = await settingsService.getGlobalSettings(companyId);
    settings.defaultAttendancePolicyId = doc._id;
    await settings.save();
    return doc;
};

const deletePolicy = async (id, actorId, companyId = null) => {
    await getPolicyById(id, companyId);
    return trash.softDelete(id, actorId);
};
const restorePolicy = async (id, actorId, companyId = null) => {
    companyFilter(companyId);
    const doc = await trash.restore(id, actorId);
    assertDocumentCompany(doc, companyId, "Attendance policy");
    return doc;
};
const permanentDeletePolicy = async (id, companyId = null) => {
    companyFilter(companyId);
    const doc = await AttendancePolicy.findOne({ _id: id, isDeleted: true });
    assertDocumentCompany(doc, companyId, "Attendance policy");
    return trash.permanentDelete(id);
};

module.exports = {
    createPolicy,
    getPolicies,
    getPolicyById,
    getActiveOrDefault,
    ensureDefaultPolicy,
    updatePolicy,
    setDefault,
    deletePolicy,
    restorePolicy,
    permanentDeletePolicy
};
