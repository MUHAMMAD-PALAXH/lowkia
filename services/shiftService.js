const Shift = require("../model/shift");
const Employee = require("../model/employee");
const { generateShiftCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Shift, {
    label: "Shift",
    nameField: "shiftName",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
    },
    restoreStatus: "Active",
    beforeSoftDelete: async (doc) => {
        const linked = await Employee.countDocuments({
            shiftId: doc._id,
            companyId: doc.companyId,
            isDeleted: { $ne: true }
        });
        if (linked > 0) {
            throw new AppError(
                `Cannot delete shift while ${linked} employee(s) are assigned. Reassign them first.`,
                400
            );
        }
    }
});

const PROTECTED = [
    "shiftCode",
    "employeeCount",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdBy",
    "createdAt",
    "updatedAt",
    "companyId"
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickFields = (payload = {}) => {
    const data = { ...payload };
    PROTECTED.forEach((f) => delete data[f]);
    return data;
};

const assertTime = (value, field) => {
    if (value === undefined || value === null || value === "") return;
    if (!TIME_RE.test(String(value))) {
        throw new AppError(`${field} must be HH:mm (24h).`, 400);
    }
};

const syncEmployeeCount = async (shiftId, companyId = null) => {
    if (!shiftId) return;
    const filter = { shiftId, isDeleted: { $ne: true } };
    if (companyId) Object.assign(filter, companyFilter(companyId));
    const count = await Employee.countDocuments(filter);
    const updateFilter = { _id: shiftId };
    if (companyId) Object.assign(updateFilter, companyFilter(companyId));
    await Shift.updateOne(updateFilter, { $set: { employeeCount: count } });
};

const createShift = async (payload = {}, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const data = pickFields(payload);
    const shiftName = String(data.shiftName || "").trim();
    if (!shiftName) throw new AppError("Shift name is required.", 400);
    if (!data.startTime || !data.endTime) {
        throw new AppError("Start time and end time are required.", 400);
    }
    assertTime(data.startTime, "startTime");
    assertTime(data.endTime, "endTime");
    assertTime(data.breakStartTime, "breakStartTime");
    assertTime(data.breakEndTime, "breakEndTime");

    const exists = await Shift.findOne({
        shiftName: { $regex: `^${escapeRegex(shiftName)}$`, $options: "i" },
        ...tenant,
        ...NOT_DELETED
    });
    if (exists) throw new AppError("Shift name already exists.", 409);

    let shiftType = data.shiftType || "Regular";
    const [sh, sm] = String(data.startTime).split(":").map(Number);
    const [eh, em] = String(data.endTime).split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
        shiftType = data.shiftType || "Night";
    }

    const shiftCode = await generateShiftCode();
    return Shift.create(
        stampCompany(
            {
                ...data,
                shiftName,
                shiftCode,
                shiftType,
                weeklyOff: Array.isArray(data.weeklyOff) ? data.weeklyOff : [],
                createdBy: actorId || null,
                employeeCount: 0
            },
            companyId
        )
    );
};

const getShifts = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };

    if (query.status) filter.status = query.status;
    if (query.shiftType) filter.shiftType = query.shiftType;
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { shiftName: { $regex: s, $options: "i" } },
            { shiftCode: { $regex: s, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        Shift.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Shift.countDocuments(filter)
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

const getActiveShifts = async (companyId = null) =>
    Shift.find({
        status: "Active",
        ...companyFilter(companyId),
        ...NOT_DELETED
    }).sort({ shiftName: 1 });

const getShiftById = async (id, companyId = null) => {
    const doc = await Shift.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!doc) throw new AppError("Shift not found.", 404);
    return doc;
};

const updateShift = async (id, payload = {}, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const doc = await getShiftById(id, companyId);
    const data = pickFields(payload);

    if (data.shiftName) {
        const shiftName = String(data.shiftName).trim();
        const exists = await Shift.findOne({
            _id: { $ne: id },
            shiftName: {
                $regex: `^${escapeRegex(shiftName)}$`,
                $options: "i"
            },
            ...tenant,
            ...NOT_DELETED
        });
        if (exists) throw new AppError("Shift name already exists.", 409);
        data.shiftName = shiftName;
    }

    if (data.startTime) assertTime(data.startTime, "startTime");
    if (data.endTime) assertTime(data.endTime, "endTime");
    if (data.breakStartTime) assertTime(data.breakStartTime, "breakStartTime");
    if (data.breakEndTime) assertTime(data.breakEndTime, "breakEndTime");

    Object.assign(doc, data);
    doc.updatedBy = actorId || null;
    await doc.save();
    return doc;
};

const deleteShift = async (id, actorId, companyId = null) => {
    await getShiftById(id, companyId);
    return trash.softDelete(id, actorId);
};
const restoreShift = async (id, actorId, companyId = null) => {
    companyFilter(companyId);
    const doc = await trash.restore(id, actorId);
    assertDocumentCompany(doc, companyId, "Shift");
    return doc;
};
const permanentDeleteShift = async (id, companyId = null) => {
    companyFilter(companyId);
    const doc = await Shift.findOne({ _id: id, isDeleted: true });
    assertDocumentCompany(doc, companyId, "Shift");
    return trash.permanentDelete(id);
};

module.exports = {
    createShift,
    getShifts,
    getActiveShifts,
    getShiftById,
    updateShift,
    deleteShift,
    restoreShift,
    permanentDeleteShift,
    syncEmployeeCount
};
