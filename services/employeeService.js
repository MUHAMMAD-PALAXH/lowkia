const mongoose = require("mongoose");
const Employee = require("../model/employee");
const Branch = require("../model/branch");
const Shift = require("../model/shift");
const AdminUser = require("../model/adminUser");
const Department = require("../model/department");
const Designation = require("../model/designation");
const { generateEmployeeCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const shiftService = require("./shiftService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Employee, {
    label: "Employee",
    nameField: "fullName",
    softDeleteExtra: (doc) => {
        doc.isActive = false;
        doc.employmentStatus = "Terminated";
    },
    restoreStatus: false,
    restoreExtra: (doc) => {
        doc.isActive = true;
        doc.employmentStatus = "Active";
    }
});

const PROTECTED = [
    "employeeCode",
    "fullName",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdBy",
    "createdAt",
    "updatedAt",
    "lastAttendance"
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

const populateEmployee = (q) =>
    q
        .populate("branchId", "branchCode name")
        .populate("departmentId", "departmentCode departmentName")
        .populate("designationId", "designationCode designationName")
        .populate("shiftId", "shiftCode shiftName startTime endTime shiftType weeklyOff status")
        .populate("userId", "firstName lastName email username role status")
        .populate("reportingManager", "employeeCode fullName")
        .populate(
            "salaryStructureId",
            "structureCode structureName salaryType basicSalaryMinor hourlyRateMinor dailyRateMinor currency status"
        );

const assertRefs = async (data) => {
    if (data.branchId) {
        const branch = await Branch.findOne({
            _id: data.branchId,
            ...NOT_DELETED
        });
        if (!branch) throw new AppError("Branch not found.", 404);
    }
    if (data.shiftId) {
        const shift = await Shift.findOne({
            _id: data.shiftId,
            status: "Active",
            ...NOT_DELETED
        });
        if (!shift) throw new AppError("Active shift not found.", 404);
    }
    if (data.userId) {
        const user = await AdminUser.findOne({
            _id: data.userId,
            isDeleted: { $ne: true }
        });
        if (!user) throw new AppError("Admin user not found.", 404);
        if (user.role === "vendor" || user.role === "supplier") {
            throw new AppError(
                "Cannot link a vendor or supplier account as an employee without converting role first.",
                400
            );
        }
    }
    if (data.departmentId) {
        const dep = await Department.findOne({
            _id: data.departmentId,
            isDeleted: { $ne: true }
        });
        if (!dep) throw new AppError("Department not found.", 404);
    }
    if (data.designationId) {
        const des = await Designation.findOne({
            _id: data.designationId,
            isDeleted: { $ne: true }
        });
        if (!des) throw new AppError("Designation not found.", 404);
    }
};

const createEmployee = async (payload = {}, actorId = null) => {
    const data = pickFields(payload);
    const userId = toObjectId(data.userId);
    const branchId = toObjectId(data.branchId);

    if (!userId) throw new AppError("Linked admin user (userId) is required.", 400);
    if (!branchId) throw new AppError("Branch is required.", 400);

    const adminUser = await AdminUser.findOne({
        _id: userId,
        isDeleted: { $ne: true },
    });
    if (!adminUser) throw new AppError("Admin user not found.", 404);
    if (adminUser.role === "vendor" || adminUser.role === "supplier") {
        throw new AppError(
            "Cannot link a vendor or supplier account as an employee without converting role first.",
            400
        );
    }
    if (!adminUser.isVerified || !adminUser.isPhoneVerified) {
        throw new AppError(
            "Only email- and phone-verified accounts can be added to attendance.",
            400
        );
    }

    const firstName = String(
        data.firstName || adminUser.firstName || ""
    ).trim();
    const lastName = String(data.lastName || adminUser.lastName || "").trim();
    const phone = String(data.phone || adminUser.phone || "").trim();
    const email = String(data.email || adminUser.email || "")
        .trim()
        .toLowerCase();
    const joiningDate = data.joiningDate || new Date();

    if (!firstName || !lastName) {
        throw new AppError("First name and last name are required.", 400);
    }
    if (!phone) throw new AppError("Phone is required on the selected account.", 400);

    const userTaken = await Employee.findOne({
        userId,
        ...NOT_DELETED,
    });
    if (userTaken) {
        throw new AppError(
            "This admin user is already linked to another employee.",
            409
        );
    }

    await assertRefs({
        branchId,
        userId,
        shiftId: toObjectId(data.shiftId),
        departmentId: toObjectId(data.departmentId),
        designationId: toObjectId(data.designationId),
    });

    const employeeCode = await generateEmployeeCode();
    const doc = await Employee.create({
        ...data,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        phone,
        email: email || undefined,
        joiningDate,
        branchId,
        userId,
        shiftId: toObjectId(data.shiftId),
        departmentId: toObjectId(data.departmentId),
        designationId: toObjectId(data.designationId),
        employeeCode,
        createdBy: actorId || null,
        isActive: data.isActive !== false,
    });

    if (doc.shiftId) await shiftService.syncEmployeeCount(doc.shiftId);

    return populateEmployee(Employee.findById(doc._id));
};

const getAvailableUsers = async () => {
    const linked = await Employee.find({ ...NOT_DELETED })
        .select("userId")
        .lean();
    const linkedIds = linked
        .map((e) => e.userId)
        .filter(Boolean)
        .map((id) => String(id));

    const filter = {
        isDeleted: { $ne: true },
        isVerified: true,
        isPhoneVerified: true,
        role: { $in: ["admin", "branch_manager"] },
        ...(linkedIds.length ? { _id: { $nin: linkedIds } } : {}),
    };

    return AdminUser.find(filter)
        .select(
            "firstName lastName email phone role isVerified isPhoneVerified isApproved status createdAt"
        )
        .sort({ firstName: 1, lastName: 1 })
        .lean();
};

const getEmployees = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }
    if (query.departmentId && toObjectId(query.departmentId)) {
        filter.departmentId = toObjectId(query.departmentId);
    }
    if (query.shiftId && toObjectId(query.shiftId)) {
        filter.shiftId = toObjectId(query.shiftId);
    }
    if (query.employmentStatus) {
        filter.employmentStatus = query.employmentStatus;
    }
    if (query.isActive === "true" || query.isActive === true) {
        filter.isActive = true;
    }
    if (query.isActive === "false" || query.isActive === false) {
        filter.isActive = false;
    }
    if (query.search) {
        const s = escapeRegex(String(query.search).trim());
        filter.$or = [
            { fullName: { $regex: s, $options: "i" } },
            { firstName: { $regex: s, $options: "i" } },
            { lastName: { $regex: s, $options: "i" } },
            { employeeCode: { $regex: s, $options: "i" } },
            { email: { $regex: s, $options: "i" } },
            { phone: { $regex: s, $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        populateEmployee(
            Employee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        ),
        Employee.countDocuments(filter)
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

const getEmployeeById = async (id) => {
    const doc = await populateEmployee(
        Employee.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!doc) throw new AppError("Employee not found.", 404);
    return doc;
};

const updateEmployee = async (id, payload = {}, actorId = null) => {
    const doc = await Employee.findOne({ _id: id, ...NOT_DELETED });
    if (!doc) throw new AppError("Employee not found.", 404);

    const data = pickFields(payload);
    const prevShiftId = doc.shiftId ? String(doc.shiftId) : null;

    if (data.userId) {
        const userId = toObjectId(data.userId);
        const taken = await Employee.findOne({
            userId,
            _id: { $ne: id },
            ...NOT_DELETED
        });
        if (taken) {
            throw new AppError(
                "This admin user is already linked to another employee.",
                409
            );
        }
        data.userId = userId;
    }

    if (data.branchId) data.branchId = toObjectId(data.branchId);
    if (data.shiftId !== undefined) {
        data.shiftId = data.shiftId ? toObjectId(data.shiftId) : null;
    }
    if (data.departmentId !== undefined) {
        data.departmentId = data.departmentId
            ? toObjectId(data.departmentId)
            : null;
    }
    if (data.designationId !== undefined) {
        data.designationId = data.designationId
            ? toObjectId(data.designationId)
            : null;
    }

    await assertRefs({
        branchId: data.branchId,
        userId: data.userId,
        shiftId: data.shiftId,
        departmentId: data.departmentId,
        designationId: data.designationId
    });

    if (data.firstName || data.lastName) {
        const firstName = String(data.firstName || doc.firstName).trim();
        const lastName = String(data.lastName || doc.lastName).trim();
        data.firstName = firstName;
        data.lastName = lastName;
        data.fullName = `${firstName} ${lastName}`.trim();
    }

    Object.assign(doc, data);
    doc.updatedBy = actorId || null;
    await doc.save();

    const nextShiftId = doc.shiftId ? String(doc.shiftId) : null;
    if (prevShiftId && prevShiftId !== nextShiftId) {
        await shiftService.syncEmployeeCount(prevShiftId);
    }
    if (nextShiftId) await shiftService.syncEmployeeCount(nextShiftId);

    return getEmployeeById(id);
};

const assignShift = async (id, shiftId, actorId = null) => {
    if (!toObjectId(shiftId)) {
        throw new AppError("Valid shiftId is required.", 400);
    }
    return updateEmployee(id, { shiftId }, actorId);
};

const deleteEmployee = (id, actorId) => trash.softDelete(id, actorId);
const restoreEmployee = (id, actorId) => trash.restore(id, actorId);
const permanentDeleteEmployee = (id) => trash.permanentDelete(id);

module.exports = {
    createEmployee,
    getAvailableUsers,
    getEmployees,
    getEmployeeById,
    updateEmployee,
    assignShift,
    deleteEmployee,
    restoreEmployee,
    permanentDeleteEmployee
};
