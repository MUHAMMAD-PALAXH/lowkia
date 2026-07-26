const Department = require("../model/department");
const Company = require("../model/company");

const {
    generateDepartmentCode
} = require("./counter");



// =====================================================
// Create Department
// =====================================================

const createDepartment = async (data, user) => {

    const companyId = user.defaultCompany;

    if (!companyId) {
        throw new Error("No default company selected.");
    }

    const company = await Company.findById(companyId);

    if (!company) {
        throw new Error("Company not found.");
    }

    const exists = await Department.findOne({
        companyId,
        departmentName: data.departmentName.trim(),
        isDeleted: false
    });

    if (exists) {
        throw new Error("Department already exists.");
    }

    const departmentCode =
        await generateDepartmentCode(companyId);

    const department =
        await Department.create({

            companyId,

            departmentCode,

            departmentName: data.departmentName.trim(),

            description: data.description || "",

            parentDepartment:
                data.parentDepartment || null,

            managerId:
                data.managerId || null,

            createdBy: user._id

        });

    return department;

};



// =====================================================
// Update Department
// =====================================================

const updateDepartment = async (
    id,
    data,
    user
) => {

    const department =
        await Department.findOne({

            _id: id,

            companyId: user.defaultCompany,

            isDeleted: false

        });

    if (!department) {
        throw new Error("Department not found.");
    }

    if (data.departmentName) {

        const exists =
            await Department.findOne({

                companyId: user.defaultCompany,

                departmentName:
                    data.departmentName.trim(),

                _id: {
                    $ne: id
                },

                isDeleted: false

            });

        if (exists) {
            throw new Error("Department name already exists.");
        }

        department.departmentName =
            data.departmentName.trim();

    }

    if (data.description !== undefined) {

        department.description =
            data.description;

    }

    if (data.parentDepartment !== undefined) {

        department.parentDepartment =
            data.parentDepartment;

    }

    if (data.managerId !== undefined) {

        department.managerId =
            data.managerId;

    }

    if (data.status) {

        department.status =
            data.status;

    }

    department.updatedBy =
        user._id;

    await department.save();

    return department;

};



// =====================================================
// Get All
// =====================================================

const getDepartments = async (

    user,

    page = 1,

    limit = 10,

    search = ""

) => {

    const filter = {

        companyId: user.defaultCompany,

        isDeleted: false

    };

    if (search) {

        filter.$text = {

            $search: search

        };

    }

    const total =
        await Department.countDocuments(filter);

    const departments =
        await Department.find(filter)

            .populate(
                "managerId",
                "firstName lastName"
            )

            .populate(
                "parentDepartment",
                "departmentName departmentCode"
            )

            .sort({
                createdAt: -1
            })

            .skip((page - 1) * limit)

            .limit(limit);

    return {

        total,

        page,

        totalPages:
            Math.ceil(total / limit),

        departments

    };

};



// =====================================================
// Get Single
// =====================================================

const getDepartmentById = async (
    id,
    user
) => {

    const department =
        await Department.findOne({

            _id: id,

            companyId: user.defaultCompany,

            isDeleted: false

        })

            .populate(
                "managerId",
                "firstName lastName email"
            )

            .populate(
                "parentDepartment"
            );

    if (!department) {

        throw new Error(
            "Department not found."
        );

    }

    return department;

};



// =====================================================
// Soft Delete
// =====================================================

const deleteDepartment = async (
    id,
    user
) => {

    const department =
        await Department.findOne({

            _id: id,

            companyId: user.defaultCompany,

            isDeleted: false

        });

    if (!department) {

        throw new Error(
            "Department not found."
        );

    }

    department.isDeleted = true;

    department.deletedBy =
        user._id;

    department.deletedAt =
        new Date();

    await department.save();

    return department;

};



// =====================================================
// Restore
// =====================================================

const restoreDepartment = async (
    id,
    user
) => {

    const department =
        await Department.findOne({

            _id: id,

            companyId: user.defaultCompany,

            isDeleted: true

        });

    if (!department) {

        throw new Error(
            "Department not found."
        );

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

const changeDepartmentStatus = async (
    id,
    status,
    user
) => {

    const department =
        await Department.findOne({

            _id: id,

            companyId: user.defaultCompany,

            isDeleted: false

        });

    if (!department) {

        throw new Error(
            "Department not found."
        );

    }

    department.status = status;

    department.updatedBy = user._id;

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