const mongoose = require("mongoose");
const Holiday = require("../model/holiday");
const { generateHolidayCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const settingsService = require("./settingsService");
const { eachWorkDate } = require("../utils/workDates");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Holiday, {
    label: "Holiday",
    nameField: "holidayName",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
    },
    restoreStatus: "Active"
});

const PROTECTED = [
    "holidayCode",
    "workDates",
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

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const pickFields = (payload = {}) => {
    const data = { ...payload };
    PROTECTED.forEach((f) => delete data[f]);
    return data;
};

const buildWorkDates = async (startDate, endDate, companyId = null) => {
    const timezone = await settingsService.getTimezone(companyId);
    return eachWorkDate(startDate, endDate, timezone);
};

const createHoliday = async (payload = {}, actorId = null, companyId = null) => {
    companyFilter(companyId);
    const data = pickFields(payload);
    const holidayName = String(data.holidayName || "").trim();
    if (!holidayName) throw new AppError("Holiday name is required.", 400);
    if (!data.startDate || !data.endDate) {
        throw new AppError("Start date and end date are required.", 400);
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new AppError("Invalid holiday dates.", 400);
    }
    if (endDate < startDate) {
        throw new AppError("End date cannot be before start date.", 400);
    }

    const workDates = await buildWorkDates(startDate, endDate, companyId);
    const holidayCode = await generateHolidayCode();
    const applicableBranchIds = Array.isArray(data.applicableBranchIds)
        ? data.applicableBranchIds.map(toObjectId).filter(Boolean)
        : [];
    const applicableEmployeeIds = Array.isArray(data.applicableEmployeeIds)
        ? data.applicableEmployeeIds.map(toObjectId).filter(Boolean)
        : [];

    const doc = await Holiday.create(
        stampCompany(
            {
                ...data,
                holidayName,
                holidayCode,
                startDate,
                endDate,
                workDates,
                applicableBranchIds,
                applicableEmployeeIds,
                createdBy: actorId || null
            },
            companyId
        )
    );

    try {
        const { writeActivityLog } = require("./activityLogService");
        const AdminUser = require("../model/adminUser");
        const user = actorId
            ? await AdminUser.findById(actorId).select(
                  "firstName lastName email username role"
              )
            : null;
        if (user) {
            await writeActivityLog({
                user,
                activityType: "Create",
                module: "Holiday",
                description: `Holiday created: ${holidayName}`,
                referenceType: "Holiday",
                referenceId: doc._id,
                securityLevel: "Sensitive"
            });
        }
    } catch (_) {
        /* ignore */
    }

    return doc;
};

const getHolidays = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };

    if (query.status) filter.status = query.status;
    if (query.year) {
        const y = Number(query.year);
        filter.startDate = {
            $gte: new Date(`${y}-01-01T00:00:00.000Z`),
            $lte: new Date(`${y}-12-31T23:59:59.999Z`)
        };
    }
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { holidayName: { $regex: s, $options: "i" } },
            { holidayCode: { $regex: s, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        Holiday.find(filter)
            .populate("applicableEmployeeIds", "employeeCode fullName")
            .sort({ startDate: 1 })
            .skip(skip)
            .limit(limit),
        Holiday.countDocuments(filter)
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

const getHolidayById = async (id, companyId = null) => {
    const doc = await Holiday.findOne({
        _id: id,
        ...companyFilter(companyId),
        ...NOT_DELETED
    });
    if (!doc) throw new AppError("Holiday not found.", 404);
    return doc;
};

const findHolidayForWorkDate = async (
    workDate,
    branchId = null,
    employeeId = null,
    companyId = null
) => {
    if (!workDate) return null;
    const filter = {
        ...companyFilter(companyId),
        ...NOT_DELETED,
        status: "Active",
        workDates: workDate
    };
    const holidays = await Holiday.find(filter).lean();
    if (!holidays.length) return null;

    const bid = branchId ? String(branchId) : null;
    const eid = employeeId ? String(employeeId) : null;
    for (const h of holidays) {
        const branches = (h.applicableBranchIds || []).map(String);
        const employees = (h.applicableEmployeeIds || []).map(String);
        const branchOk = !branches.length || (bid && branches.includes(bid));
        const employeeOk =
            !employees.length || (eid && employees.includes(eid));
        if (branchOk && employeeOk) return h;
    }
    return null;
};

const updateHoliday = async (id, payload = {}, actorId = null, companyId = null) => {
    const doc = await getHolidayById(id, companyId);
    const data = pickFields(payload);

    if (data.holidayName) data.holidayName = String(data.holidayName).trim();

    if (data.startDate || data.endDate) {
        const startDate = new Date(data.startDate || doc.startDate);
        const endDate = new Date(data.endDate || doc.endDate);
        if (endDate < startDate) {
            throw new AppError("End date cannot be before start date.", 400);
        }
        data.startDate = startDate;
        data.endDate = endDate;
        data.workDates = await buildWorkDates(startDate, endDate, companyId);
    }

    if (data.applicableBranchIds) {
        data.applicableBranchIds = data.applicableBranchIds
            .map(toObjectId)
            .filter(Boolean);
    }
    if (data.applicableEmployeeIds) {
        data.applicableEmployeeIds = data.applicableEmployeeIds
            .map(toObjectId)
            .filter(Boolean);
    }

    Object.assign(doc, data);
    doc.updatedBy = actorId || null;
    await doc.save();
    return doc;
};

const deleteHoliday = async (id, actorId, companyId = null) => {
    await getHolidayById(id, companyId);
    return trash.softDelete(id, actorId);
};
const restoreHoliday = async (id, actorId, companyId = null) => {
    companyFilter(companyId);
    const doc = await trash.restore(id, actorId);
    assertDocumentCompany(doc, companyId, "Holiday");
    return doc;
};
const permanentDeleteHoliday = async (id, companyId = null) => {
    companyFilter(companyId);
    const doc = await Holiday.findOne({ _id: id, isDeleted: true });
    assertDocumentCompany(doc, companyId, "Holiday");
    return trash.permanentDelete(id);
};

module.exports = {
    createHoliday,
    getHolidays,
    getHolidayById,
    findHolidayForWorkDate,
    updateHoliday,
    deleteHoliday,
    restoreHoliday,
    permanentDeleteHoliday
};
