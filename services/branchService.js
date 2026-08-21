const mongoose = require("mongoose");
const Branch = require("../model/branch");
const Warehouse = require("../model/warehouse");
const { generateBranchCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

// Matches false / null / missing — safe for legacy IMEI-created branches
const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Branch, {
    label: "Branch",
    nameField: "name",
    softDeleteExtra: (doc) => {
        doc.status = "Closed";
    },
    restoreStatus: "Active",
    beforeSoftDelete: async (doc) => {
        if (doc.warehouseIds && doc.warehouseIds.length > 0) {
            throw new AppError(
                "Cannot delete branch while warehouses are assigned. Reassign or remove warehouses first.",
                400
            );
        }

        const linkedCount = await Warehouse.countDocuments({
            isDeleted: { $ne: true },
            $or: [{ branchIds: doc._id }, { branchId: doc._id }]
        });

        if (linkedCount > 0) {
            throw new AppError(
                "Cannot delete branch while warehouses are still linked. Reassign warehouses first.",
                400
            );
        }

        if (doc.isHeadOffice) {
            throw new AppError(
                "Cannot delete Head Office branch. Assign another Head Office first.",
                400
            );
        }
    },
    scopeStatusMap: {
        active: "Active",
        inactive: "Inactive",
        closed: "Closed",
        maintenance: "Maintenance"
    }
});

const PROTECTED_FIELDS = [
    "branchCode",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };

    // Legacy Flutter aliases
    if (!data.address && data.location) {
        data.address = data.location;
    }
    if (!data.city && data.location) {
        data.city = data.location;
    }
    if (data.isActive !== undefined && data.status === undefined) {
        data.status = data.isActive ? "Active" : "Inactive";
    }

    delete data.location;
    delete data.isActive;

    PROTECTED_FIELDS.forEach((field) => {
        delete data[field];
    });

    return data;
};

const normalizeWarehouseIds = (ids = []) => {
    if (!Array.isArray(ids)) return [];
    const unique = [...new Set(ids.map((id) => String(id)))];
    return unique.filter((id) => mongoose.Types.ObjectId.isValid(id));
};

const validateWarehousesExist = async (warehouseIds) => {
    if (!warehouseIds.length) return;

    const count = await Warehouse.countDocuments({
        _id: { $in: warehouseIds },
        isDeleted: { $ne: true }
    });

    if (count !== warehouseIds.length) {
        throw new AppError(
            "One or more selected warehouses are invalid or deleted.",
            400
        );
    }
};

// Sync many-to-many: Branch.warehouseIds ↔ Warehouse.branchIds
const syncWarehouseBranchLinks = async (branchId, nextWarehouseIds = []) => {
    const branchObjectId = new mongoose.Types.ObjectId(branchId);
    const nextIds = nextWarehouseIds.map(
        (id) => new mongoose.Types.ObjectId(id)
    );

    const previous = await Warehouse.find({
        branchIds: branchObjectId
    }).select("_id");

    const previousIds = previous.map((w) => String(w._id));
    const nextIdStrings = nextIds.map((id) => String(id));

    const toRemove = previousIds.filter((id) => !nextIdStrings.includes(id));
    const toAdd = nextIdStrings.filter((id) => !previousIds.includes(id));

    if (toRemove.length) {
        await Warehouse.updateMany(
            { _id: { $in: toRemove } },
            {
                $pull: { branchIds: branchObjectId },
                $unset: {
                    // clear legacy primary only if it pointed to this branch
                }
            }
        );

        await Warehouse.updateMany(
            {
                _id: { $in: toRemove },
                branchId: branchObjectId
            },
            {
                $set: { branchId: null }
            }
        );
    }

    if (toAdd.length) {
        await Warehouse.updateMany(
            { _id: { $in: toAdd } },
            {
                $addToSet: { branchIds: branchObjectId }
            }
        );

        // Set legacy branchId if empty (backward compatible)
        await Warehouse.updateMany(
            {
                _id: { $in: toAdd },
                $or: [{ branchId: null }, { branchId: { $exists: false } }]
            },
            {
                $set: { branchId: branchObjectId }
            }
        );
    }
};

const ensureSingleHeadOffice = async (branchId = null, companyId = null) => {
    const filter = {
        isHeadOffice: true,
        ...NOT_DELETED,
        ...companyFilter(companyId),
    };

    if (branchId) {
        filter._id = { $ne: branchId };
    }

    await Branch.updateMany(filter, {
        $set: { isHeadOffice: false }
    });
};

const findActiveBranchOrFail = trash.findActiveOrFail;

const populateBranch = (query) =>
    query
        .populate("managerId", "firstName lastName email phone")
        .populate(
            "warehouseIds",
            "warehouseCode warehouseName warehouseType status city fullAddress"
        )
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email");

// ==========================================================
// Create
// ==========================================================

const createBranch = async (payload, actorId = null, companyId = null) => {
    const data = pickUpdatableFields(payload);
    const name = data.name?.trim();
    const tenant = companyFilter(companyId);

    if (!name) {
        throw new AppError("Branch name is required.", 400);
    }

    if (!data.city?.trim()) {
        const fallback =
            data.location?.trim() ||
            data.address?.trim() ||
            "";
        if (!fallback) {
            throw new AppError("City is required.", 400);
        }
        data.city = fallback;
    }

    if (!data.address?.trim() && data.location?.trim()) {
        data.address = data.location.trim();
    }

    const duplicate = await Branch.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        ...tenant,
        ...NOT_DELETED
    });

    if (duplicate) {
        throw new AppError("Branch with this name already exists.", 409);
    }

    const warehouseIds = normalizeWarehouseIds(
        data.warehouseIds || payload.warehouseIds || []
    );
    await validateWarehousesExist(warehouseIds);

    if (data.isHeadOffice === true) {
        await ensureSingleHeadOffice(null, companyId);
    }

    const branchCode = await generateBranchCode();

    const branch = await Branch.create(
        stampCompany(
            {
                ...data,
                name,
                city: data.city.trim(),
                warehouseIds,
                branchCode,
                createdBy: actorId || null,
            },
            companyId
        )
    );

    await syncWarehouseBranchLinks(branch._id, warehouseIds);

    return populateBranch(Branch.findById(branch._id));
};

// ==========================================================
// List
// ==========================================================

const getBranches = async (query = {}, companyId = null) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = {
        ...companyFilter(companyId),
        ...(trashMode ? { isDeleted: true } : { ...NOT_DELETED }),
    };

    if (query.status) filter.status = query.status;
    if (query.isHeadOffice !== undefined) {
        filter.isHeadOffice =
            query.isHeadOffice === true || query.isHeadOffice === "true";
    }
    if (query.warehouseId && mongoose.Types.ObjectId.isValid(query.warehouseId)) {
        filter.warehouseIds = query.warehouseId;
    }

    if (query.search) {
        const search = escapeRegex(query.search.trim());
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { branchCode: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { address: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populateBranch(
            Branch.find(filter).sort(sort).skip(skip).limit(limit)
        ),
        Branch.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        },
        trash: trashMode
    };
};

const getBranchById = async (id, companyId = null) => {
    const branch = await populateBranch(
        Branch.findOne({ _id: id, ...NOT_DELETED })
    );

    if (!branch) {
        throw new AppError("Branch not found.", 404);
    }

    assertDocumentCompany(branch, companyId, "Branch");
    return branch;
};

const getActiveBranches = async (companyId = null) => {
    return populateBranch(
        Branch.find({
            status: "Active",
            ...NOT_DELETED,
            ...companyFilter(companyId),
        }).sort({ name: 1 })
    );
};

// ==========================================================
// Update
// ==========================================================

const updateBranch = async (id, payload, actorId = null, companyId = null) => {
    const branch = await findActiveBranchOrFail(id);
    assertDocumentCompany(branch, companyId, "Branch");
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const name = data.name.trim();
        const duplicate = await Branch.findOne({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            ...companyFilter(companyId),
            ...NOT_DELETED
        });

        if (duplicate) {
            throw new AppError("Branch with this name already exists.", 409);
        }

        data.name = name;
    }

    let warehouseIds = branch.warehouseIds.map((w) => String(w));
    if (payload.warehouseIds !== undefined || data.warehouseIds !== undefined) {
        warehouseIds = normalizeWarehouseIds(
            payload.warehouseIds ?? data.warehouseIds
        );
        await validateWarehousesExist(warehouseIds);
        data.warehouseIds = warehouseIds;
    }

    if (data.isHeadOffice === true) {
        await ensureSingleHeadOffice(id, companyId);
    }

    Object.assign(branch, data);
    branch.updatedBy = actorId || branch.updatedBy;
    await branch.save();

    if (payload.warehouseIds !== undefined || data.warehouseIds !== undefined) {
        await syncWarehouseBranchLinks(branch._id, warehouseIds);
    }

    return populateBranch(Branch.findById(branch._id));
};

// Assign / replace warehouses (dedicated endpoint)
const assignWarehouses = async (id, warehouseIdsInput, actorId = null) => {
    const branch = await findActiveBranchOrFail(id);
    const warehouseIds = normalizeWarehouseIds(warehouseIdsInput);

    await validateWarehousesExist(warehouseIds);

    branch.warehouseIds = warehouseIds;
    branch.updatedBy = actorId || null;
    await branch.save();

    await syncWarehouseBranchLinks(branch._id, warehouseIds);

    return populateBranch(Branch.findById(branch._id));
};

// ==========================================================
// Soft delete — blocked if warehouses still assigned
// ==========================================================

const deleteBranch = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreBranch = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteBranch = (id) => trash.permanentDelete(id);
const bulkDeleteBranches = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreBranches = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteBranches = (payload) =>
    trash.bulkPermanentDelete(payload);

const getBranchStats = async (companyId = null) => {
    const tenant = companyFilter(companyId);
    const [[rows], trashCount] = await Promise.all([
        Branch.aggregate([
            { $match: { ...NOT_DELETED, ...tenant } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                        $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] }
                    },
                    inactive: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0]
                        }
                    },
                    closed: {
                        $sum: { $cond: [{ $eq: ["$status", "Closed"] }, 1, 0] }
                    },
                    maintenance: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Maintenance"] }, 1, 0]
                        }
                    },
                    headOfficeCount: {
                        $sum: { $cond: ["$isHeadOffice", 1, 0] }
                    }
                }
            }
        ]),
        Branch.countDocuments({ isDeleted: true, ...tenant })
    ]);

    return {
        ...(rows || {
            total: 0,
            active: 0,
            inactive: 0,
            closed: 0,
            maintenance: 0,
            headOfficeCount: 0
        }),
        trashCount
    };
};

// ==========================================================
// Status / Head Office
// ==========================================================

const setStatus = async (id, status, actorId = null) => {
    const allowed = ["Active", "Inactive", "Closed", "Maintenance"];
    if (!allowed.includes(status)) {
        throw new AppError("Invalid branch status.", 400);
    }

    const branch = await findActiveBranchOrFail(id);
    branch.status = status;
    branch.updatedBy = actorId || null;
    await branch.save();
    return populateBranch(Branch.findById(branch._id));
};

const setHeadOffice = async (id, actorId = null) => {
    const branch = await findActiveBranchOrFail(id);
    await ensureSingleHeadOffice(id);
    branch.isHeadOffice = true;
    branch.updatedBy = actorId || null;
    await branch.save();
    return populateBranch(Branch.findById(branch._id));
};

module.exports = {
    createBranch,
    getBranches,
    getBranchById,
    getActiveBranches,
    updateBranch,
    assignWarehouses,
    deleteBranch,
    restoreBranch,
    permanentDeleteBranch,
    bulkDeleteBranches,
    bulkRestoreBranches,
    bulkPermanentDeleteBranches,
    getBranchStats,
    setStatus,
    setHeadOffice
};
