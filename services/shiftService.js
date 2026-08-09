const Shift = require("../model/shift");
const Employee = require("../model/employee");
const { generateShiftCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

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
    "updatedAt"
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

const syncEmployeeCount = async (shiftId) => {
    if (!shiftId) return;
    const count = await Employee.countDocuments({
        shiftId,
        isDeleted: { $ne: true }
    });
    await Shift.updateOne({ _id: shiftId }, { $set: { employeeCount: count } });
};

const createShift = async (payload = {}, actorId = null) => {
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
        ...NOT_DELETED
    });
    if (exists) throw new AppError("Shift name already exists.", 409);

    // Infer night shift when end <= start
    let shiftType = data.shiftType || "Regular";
    const [sh, sm] = String(data.startTime).split(":").map(Number);
    const [eh, em] = String(data.endTime).split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
        shiftType = data.shiftType || "Night";
    }

    const shiftCode = await generateShiftCode();
    const doc = await Shift.create({
        ...data,
        shiftName,
        shiftCode,
        shiftType,
        weeklyOff: Array.isArray(data.weeklyOff) ? data.weeklyOff : [],
        createdBy: actorId || null,
        employeeCount: 0
    });
    return doc;
};

const getShifts = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

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

const getActiveShifts = async () =>
    Shift.find({ status: "Active", ...NOT_DELETED }).sort({ shiftName: 1 });

const getShiftById = async (id) => {
    const doc = await Shift.findOne({ _id: id, ...NOT_DELETED });
    if (!doc) throw new AppError("Shift not found.", 404);
    return doc;
};

const updateShift = async (id, payload = {}, actorId = null) => {
    const doc = await getShiftById(id);
    const data = pickFields(payload);

    if (data.shiftName) {
        const shiftName = String(data.shiftName).trim();
        const exists = await Shift.findOne({
            _id: { $ne: id },
            shiftName: {
                $regex: `^${escapeRegex(shiftName)}$`,
                $options: "i"
            },
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

const deleteShift = (id, actorId) => trash.softDelete(id, actorId);
const restoreShift = (id, actorId) => trash.restore(id, actorId);
const permanentDeleteShift = (id) => trash.permanentDelete(id);

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
