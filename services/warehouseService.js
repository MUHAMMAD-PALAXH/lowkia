const mongoose = require("mongoose");
const Warehouse = require("../model/warehouse");
const Branch = require("../model/branch");
const { generateWarehouseCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(Warehouse, {
    label: "Warehouse",
    nameField: "warehouseName",
    softDeleteExtra: (doc) => {
        doc.status = "Closed";
    },
    restoreStatus: "Active",
    beforeSoftDelete: async (doc) => {
        if (doc.branchIds && doc.branchIds.length > 0) {
            throw new AppError(
                "Cannot delete warehouse while branches are linked. Unassign branches first.",
                400
            );
        }

        const linkedBranches = await Branch.countDocuments({
            ...NOT_DELETED,
            warehouseIds: doc._id
        });

        if (linkedBranches > 0) {
            throw new AppError(
                "Cannot delete warehouse while branches still reference it. Unassign first.",
                400
            );
        }

        if (doc.isDefault) {
            throw new AppError(
                "Cannot delete the default warehouse. Set another default first.",
                400
            );
        }

        const childCount = await Warehouse.countDocuments({
            parentWarehouseId: doc._id,
            ...NOT_DELETED
        });

        if (childCount > 0) {
            throw new AppError(
                "Cannot delete warehouse while child warehouses exist. Reassign parent first.",
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
    "warehouseCode",
    "totalProducts",
    "totalStockQuantity",
    "totalStockValue",
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

    // Alias contact fields → manager text fields
    if (!data.managerPhone && data.contactPhone) {
        data.managerPhone = data.contactPhone;
    }
    if (!data.managerEmail && data.contactEmail) {
        data.managerEmail = data.contactEmail;
    }

    PROTECTED_FIELDS.forEach((field) => {
        delete data[field];
    });

    return data;
};

const normalizeIds = (ids = []) => {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.map((id) => String(id)))].filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
    );
};

const validateBranchesExist = async (branchIds) => {
    if (!branchIds.length) return;

    const count = await Branch.countDocuments({
        _id: { $in: branchIds },
        ...NOT_DELETED
    });

    if (count !== branchIds.length) {
        throw new AppError(
            "One or more selected branches are invalid or deleted.",
            400
        );
    }
};

const validateParentWarehouse = async (parentId, selfId = null) => {
    if (!parentId) return;

    if (!mongoose.Types.ObjectId.isValid(parentId)) {
        throw new AppError("Invalid parent warehouse id.", 400);
    }

    if (selfId && String(parentId) === String(selfId)) {
        throw new AppError("Warehouse cannot be its own parent.", 400);
    }

    const parent = await Warehouse.findOne({
        _id: parentId,
        ...NOT_DELETED
    });

    if (!parent) {
        throw new AppError("Parent warehouse not found.", 404);
    }
};

// Sync Warehouse.branchIds ↔ Branch.warehouseIds
const syncBranchWarehouseLinks = async (warehouseId, nextBranchIds = []) => {
    const warehouseObjectId = new mongoose.Types.ObjectId(warehouseId);
    const nextIds = nextBranchIds.map((id) => new mongoose.Types.ObjectId(id));
    const nextIdStrings = nextIds.map((id) => String(id));

    const previous = await Branch.find({
        warehouseIds: warehouseObjectId
    }).select("_id");

    const previousIds = previous.map((b) => String(b._id));
    const toRemove = previousIds.filter((id) => !nextIdStrings.includes(id));
    const toAdd = nextIdStrings.filter((id) => !previousIds.includes(id));

    if (toRemove.length) {
        await Branch.updateMany(
            { _id: { $in: toRemove } },
            { $pull: { warehouseIds: warehouseObjectId } }
        );
    }

    if (toAdd.length) {
        await Branch.updateMany(
            { _id: { $in: toAdd } },
            { $addToSet: { warehouseIds: warehouseObjectId } }
        );
    }
};

const ensureSingleDefault = async (warehouseId = null) => {
    const filter = {
        isDefault: true,
        ...NOT_DELETED
    };

    if (warehouseId) {
        filter._id = { $ne: warehouseId };
    }

    await Warehouse.updateMany(filter, { $set: { isDefault: false } });
};

const findActiveWarehouseOrFail = trash.findActiveOrFail;

const populateWarehouse = (query) =>
    query
        .populate("branchIds", "branchCode name city status")
        .populate("branchId", "branchCode name city status")
        .populate(
            "parentWarehouseId",
            "warehouseCode warehouseName warehouseType status"
        )
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email");

const recomputeAvailable = (warehouse) => {
    const capacity = Number(warehouse.capacity) || 0;
    const used = Number(warehouse.currentUtilization) || 0;
    warehouse.availableCapacity = Math.max(capacity - used, 0);
};

// ==========================================================
// Create
// ==========================================================

const createWarehouse = async (payload, actorId = null) => {
    const data = pickUpdatableFields(payload);
    const warehouseName = data.warehouseName?.trim();

    if (!warehouseName) {
        throw new AppError("Warehouse name is required.", 400);
    }

    if (!data.city?.trim()) {
        throw new AppError("City is required.", 400);
    }

    if (!data.fullAddress?.trim()) {
        throw new AppError("Full address is required.", 400);
    }

    const duplicate = await Warehouse.findOne({
        warehouseName: {
            $regex: `^${escapeRegex(warehouseName)}$`,
            $options: "i"
        },
        ...NOT_DELETED
    });

    if (duplicate) {
        throw new AppError("Warehouse with this name already exists.", 409);
    }

    const branchIds = normalizeIds(data.branchIds || payload.branchIds || []);
    await validateBranchesExist(branchIds);
    await validateParentWarehouse(data.parentWarehouseId || null);

    if (data.isDefault === true) {
        await ensureSingleDefault();
    }

    const warehouseCode = await generateWarehouseCode();

    const warehouse = new Warehouse({
        ...data,
        warehouseName,
        city: data.city.trim(),
        fullAddress: data.fullAddress.trim(),
        branchIds,
        branchId: branchIds[0] || data.branchId || null,
        warehouseCode,
        contactPhone: data.managerPhone || data.contactPhone || "",
        contactEmail: data.managerEmail || data.contactEmail || "",
        createdBy: actorId || null
    });

    recomputeAvailable(warehouse);
    await warehouse.save();

    await syncBranchWarehouseLinks(warehouse._id, branchIds);

    return populateWarehouse(Warehouse.findById(warehouse._id));
};

// ==========================================================
// List / Get
// ==========================================================

const getWarehouses = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.warehouseType) filter.warehouseType = query.warehouseType;
    if (query.isDefault !== undefined) {
        filter.isDefault =
            query.isDefault === true || query.isDefault === "true";
    }
    if (query.branchId && mongoose.Types.ObjectId.isValid(query.branchId)) {
        filter.branchIds = query.branchId;
    }

    if (query.search) {
        const search = escapeRegex(query.search.trim());
        filter.$or = [
            { warehouseName: { $regex: search, $options: "i" } },
            { warehouseCode: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } },
            { managerName: { $regex: search, $options: "i" } },
            { managerPhone: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populateWarehouse(
            Warehouse.find(filter).sort(sort).skip(skip).limit(limit)
        ),
        Warehouse.countDocuments(filter)
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

const getWarehouseById = async (id) => {
    const warehouse = await populateWarehouse(
        Warehouse.findOne({ _id: id, ...NOT_DELETED })
    );

    if (!warehouse) {
        throw new AppError("Warehouse not found.", 404);
    }

    return warehouse;
};

const getActiveWarehouses = async () => {
    return populateWarehouse(Warehouse.getActiveWarehouses());
};

// ==========================================================
// Update
// ==========================================================

const updateWarehouse = async (id, payload, actorId = null) => {
    const warehouse = await findActiveWarehouseOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.warehouseName) {
        const warehouseName = data.warehouseName.trim();
        const duplicate = await Warehouse.findOne({
            _id: { $ne: id },
            warehouseName: {
                $regex: `^${escapeRegex(warehouseName)}$`,
                $options: "i"
            },
            ...NOT_DELETED
        });

        if (duplicate) {
            throw new AppError("Warehouse with this name already exists.", 409);
        }

        data.warehouseName = warehouseName;
    }

    let branchIds = warehouse.branchIds.map((b) => String(b));
    if (payload.branchIds !== undefined || data.branchIds !== undefined) {
        branchIds = normalizeIds(payload.branchIds ?? data.branchIds);
        await validateBranchesExist(branchIds);
        data.branchIds = branchIds;
        data.branchId = branchIds[0] || null;
    }

    if (data.parentWarehouseId !== undefined) {
        await validateParentWarehouse(data.parentWarehouseId || null, id);
    }

    if (data.isDefault === true) {
        await ensureSingleDefault(id);
    }

    Object.assign(warehouse, data);

    if (data.managerPhone !== undefined) {
        warehouse.contactPhone = data.managerPhone;
    }
    if (data.managerEmail !== undefined) {
        warehouse.contactEmail = data.managerEmail;
    }

    recomputeAvailable(warehouse);
    warehouse.updatedBy = actorId || warehouse.updatedBy;
    await warehouse.save();

    if (payload.branchIds !== undefined || data.branchIds !== undefined) {
        await syncBranchWarehouseLinks(warehouse._id, branchIds);
    }

    return populateWarehouse(Warehouse.findById(warehouse._id));
};

const assignBranches = async (id, branchIdsInput, actorId = null) => {
    const warehouse = await findActiveWarehouseOrFail(id);
    const branchIds = normalizeIds(branchIdsInput);
    await validateBranchesExist(branchIds);

    warehouse.branchIds = branchIds;
    warehouse.branchId = branchIds[0] || null;
    warehouse.updatedBy = actorId || null;
    await warehouse.save();

    await syncBranchWarehouseLinks(warehouse._id, branchIds);

    return populateWarehouse(Warehouse.findById(warehouse._id));
};

// ==========================================================
// Soft delete
// ==========================================================

const deleteWarehouse = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreWarehouse = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteWarehouse = (id) => trash.permanentDelete(id);
const bulkDeleteWarehouses = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreWarehouses = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteWarehouses = (payload) =>
    trash.bulkPermanentDelete(payload);

const getWarehouseStats = async () => {
    const [[rows], trashCount] = await Promise.all([
        Warehouse.aggregate([
            { $match: NOT_DELETED },
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
                    defaultCount: {
                        $sum: { $cond: ["$isDefault", 1, 0] }
                    }
                }
            }
        ]),
        trash.trashCount()
    ]);

    return {
        ...(rows || {
            total: 0,
            active: 0,
            inactive: 0,
            closed: 0,
            maintenance: 0,
            defaultCount: 0
        }),
        trashCount
    };
};

const setStatus = async (id, status, actorId = null) => {
    const allowed = ["Active", "Inactive", "Closed", "Maintenance"];
    if (!allowed.includes(status)) {
        throw new AppError("Invalid warehouse status.", 400);
    }

    const warehouse = await findActiveWarehouseOrFail(id);
    warehouse.status = status;
    warehouse.updatedBy = actorId || null;
    await warehouse.save();
    return populateWarehouse(Warehouse.findById(warehouse._id));
};

const setDefault = async (id, actorId = null) => {
    const warehouse = await findActiveWarehouseOrFail(id);
    await ensureSingleDefault(id);
    warehouse.isDefault = true;
    warehouse.updatedBy = actorId || null;
    await warehouse.save();
    return populateWarehouse(Warehouse.findById(warehouse._id));
};

module.exports = {
    createWarehouse,
    getWarehouses,
    getWarehouseById,
    getActiveWarehouses,
    updateWarehouse,
    assignBranches,
    deleteWarehouse,
    restoreWarehouse,
    permanentDeleteWarehouse,
    bulkDeleteWarehouses,
    bulkRestoreWarehouses,
    bulkPermanentDeleteWarehouses,
    getWarehouseStats,
    setStatus,
    setDefault
};
