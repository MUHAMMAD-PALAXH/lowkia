const Department = require("../model/department");
const { generateDepartmentCode } = require("./codeGenerator");
const AppError = require("../utils/appError");

// =====================================================
// Create Department
// =====================================================

const createDepartment = async (data, user) => {
    const departmentName = data.departmentName?.trim();

    if (!departmentName) {
        throw new AppError("Department name is required.", 400);
    }

    const exists = await Department.findOne({
        departmentName,
        isDeleted: false
    });

    if (exists) {
        throw new AppError("Department already exists.", 409);
    }

    const departmentCode = await generateDepartmentCode();

    const department = await Department.create({
        departmentCode,
        departmentName,
        description: data.description || "",
        parentDepartment: data.parentDepartment || null,
        managerId: data.managerId || null,
        createdBy: user?._id || null
    });

    return department;
};

// =====================================================
// Update Department
// =====================================================

const updateDepartment = async (id, data, user) => {
    const department = await Department.findOne({
        _id: id,
        isDeleted: false
    });

    if (!department) {
        throw new AppError("Department not found.", 404);
    }

    if (data.departmentName) {
        const departmentName = data.departmentName.trim();

        const exists = await Department.findOne({
            departmentName,
            _id: { $ne: id },
            isDeleted: false
        });

        if (exists) {
            throw new AppError("Department name already exists.", 409);
        }

        department.departmentName = departmentName;
    }

    if (data.description !== undefined) {
        department.description = data.description;
    }

    if (data.parentDepartment !== undefined) {
        department.parentDepartment = data.parentDepartment;
    }

    if (data.managerId !== undefined) {
        department.managerId = data.managerId;
    }

    if (data.status) {
        department.status = data.status;
    }

    department.updatedBy = user?._id || null;
    await department.save();

    return department;
};

// =====================================================
// Get All
// =====================================================

const getDepartments = async (user, page = 1, limit = 10, search = "") => {
    const filter = {
        isDeleted: false
    };

    if (search) {
        filter.departmentName = {
            $regex: search,
            $options: "i"
        };
    }

    const total = await Department.countDocuments(filter);

    const departments = await Department.find(filter)
        .populate("managerId", "firstName lastName")
        .populate("parentDepartment", "departmentName departmentCode")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    return {
        total,
        page,
        totalPages: Math.ceil(total / limit) || 0,
        departments
    };
};

// =====================================================
// Get Single
// =====================================================

const getDepartmentById = async (id) => {
    const department = await Department.findOne({
        _id: id,
        isDeleted: false
    })
        .populate("managerId", "firstName lastName email")
        .populate("parentDepartment");

    if (!department) {
        throw new AppError("Department not found.", 404);
    }

    return department;
};

// =====================================================
// Soft Delete
// =====================================================

const deleteDepartment = async (id, user) => {
    const department = await Department.findOne({
        _id: id,
        isDeleted: false
    });

    if (!department) {
        throw new AppError("Department not found.", 404);
    }

    department.isDeleted = true;
    department.deletedBy = user?._id || null;
    department.deletedAt = new Date();
    await department.save();

    return department;
};

// =====================================================
// Restore
// =====================================================

const restoreDepartment = async (id) => {
    const department = await Department.findOne({
        _id: id,
        isDeleted: true
    });

    if (!department) {
        throw new AppError("Department not found.", 404);
    }

    department.isDeleted = false;
    department.deletedBy = null;
    department.deletedAt = null;
    await department.save();

    return department;
};

// =====================================================
// Change Status
// =====================================================

const changeDepartmentStatus = async (id, status, user) => {
    const department = await Department.findOne({
        _id: id,
        isDeleted: false
    });

    if (!department) {
        throw new AppError("Department not found.", 404);
    }

    department.status = status;
    department.updatedBy = user?._id || null;
    await department.save();

    return department;
};

module.exports = {
    createDepartment,
    updateDepartment,
    getDepartments,
    getDepartmentById,
    deleteDepartment,
    restoreDepartment,
    changeDepartmentStatus
};
