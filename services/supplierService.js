const mongoose = require("mongoose");
const Supplier = require("../model/supplier");
const { generateSupplierCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const trash = createTrashOps(Supplier, {
    label: "Supplier",
    nameField: "name",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
    },
    restoreStatus: "Active",
    scopeStatusMap: {
        active: "Active",
        inactive: "Inactive",
        blocked: "Blocked"
    }
});

// Fields clients must never overwrite directly
const PROTECTED_FIELDS = [
    "supplierCode",
    "totalPurchaseAmount",
    "totalPaidAmount",
    "totalDueAmount",
    "currentBalance",
    "rating",
    "ratingCount",
    "ledgerAccountId",
    "supplierLedgerId",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "approvedBy",
    "approvedAt",
    "isApproved",
    "createdBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };

    // Backward-compatible alias from older clients
    if (!data.companyName && data.company) {
        data.companyName = data.company;
    }
    delete data.company;
    delete data.supplierId;

    PROTECTED_FIELDS.forEach((field) => {
        delete data[field];
    });
    return data;
};

const findActiveSupplierOrFail = trash.findActiveOrFail;

// ==========================================================
// Create Supplier
// ==========================================================

const createSupplier = async (payload, actorId = null) => {
    const name = payload.name?.trim();

    if (!name) {
        throw new AppError("Supplier name is required.", 400);
    }

    const duplicate = await Supplier.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        isDeleted: false
    });

    if (duplicate) {
        throw new AppError("Supplier with this name already exists.", 409);
    }

    if (payload.email) {
        const emailExists = await Supplier.findOne({
            email: payload.email.toLowerCase().trim(),
            isDeleted: false
        });

        if (emailExists) {
            throw new AppError("Supplier with this email already exists.", 409);
        }
    }

    if (payload.phone) {
        const phoneExists = await Supplier.findOne({
            phone: payload.phone.trim(),
            isDeleted: false
        });

        if (phoneExists) {
            throw new AppError("Supplier with this phone already exists.", 409);
        }
    }

    const supplierCode = await generateSupplierCode();
    const data = pickUpdatableFields(payload);

    const supplier = await Supplier.create({
        ...data,
        name,
        supplierCode,
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
        createdBy: actorId || null
    });

    return supplier;
};

// ==========================================================
// List Suppliers (pagination + filters)
// ==========================================================

const getSuppliers = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = trashMode ? { isDeleted: true } : { isDeleted: false };

    if (query.status) {
        filter.status = query.status;
    }

    if (query.supplierType) {
        filter.supplierType = query.supplierType;
    }

    if (query.isApproved !== undefined) {
        filter.isApproved =
            query.isApproved === true ||
            query.isApproved === "true";
    }

    if (query.search) {
        const search = query.search.trim();
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
            { supplierCode: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        Supplier.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate("createdBy", "firstName lastName email")
            .populate("updatedBy", "firstName lastName email")
            .populate("approvedBy", "firstName lastName email"),
        Supplier.countDocuments(filter)
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

// ==========================================================
// Get Single Supplier
// ==========================================================

const getSupplierById = async (id) => {
    const supplier = await findActiveSupplierOrFail(id);

    await supplier.populate([
        { path: "createdBy", select: "firstName lastName email" },
        { path: "updatedBy", select: "firstName lastName email" },
        { path: "approvedBy", select: "firstName lastName email" }
    ]);

    return supplier;
};

// ==========================================================
// Update Supplier
// ==========================================================

const updateSupplier = async (id, payload, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const name = data.name.trim();
        const duplicate = await Supplier.findOne({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            isDeleted: false
        });

        if (duplicate) {
            throw new AppError("Supplier with this name already exists.", 409);
        }

        data.name = name;
    }

    if (data.email) {
        const emailExists = await Supplier.findOne({
            _id: { $ne: id },
            email: data.email.toLowerCase().trim(),
            isDeleted: false
        });

        if (emailExists) {
            throw new AppError("Supplier with this email already exists.", 409);
        }
    }

    if (data.phone) {
        const phoneExists = await Supplier.findOne({
            _id: { $ne: id },
            phone: data.phone.trim(),
            isDeleted: false
        });

        if (phoneExists) {
            throw new AppError("Supplier with this phone already exists.", 409);
        }
    }

    Object.assign(supplier, data);
    supplier.updatedBy = actorId || supplier.updatedBy;
    await supplier.save();

    return supplier;
};

// ==========================================================
// Soft Delete
// ==========================================================

const deleteSupplier = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreSupplier = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteSupplier = (id) => trash.permanentDelete(id);
const bulkDeleteSuppliers = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreSuppliers = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteSuppliers = (payload) =>
    trash.bulkPermanentDelete(payload);

const getSupplierStats = async () => {
    const [[rows], trashCount] = await Promise.all([
        Supplier.aggregate([
            { $match: { isDeleted: false } },
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
                    blocked: {
                        $sum: { $cond: [{ $eq: ["$status", "Blocked"] }, 1, 0] }
                    },
                    approved: {
                        $sum: { $cond: ["$isApproved", 1, 0] }
                    },
                    pendingApproval: {
                        $sum: { $cond: ["$isApproved", 0, 1] }
                    },
                    dueAmount: { $sum: "$totalDueAmount" }
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
            blocked: 0,
            approved: 0,
            pendingApproval: 0,
            dueAmount: 0
        }),
        trashCount
    };
};

// ==========================================================
// Approve
// ==========================================================

const approveSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.isApproved) {
        throw new AppError("Supplier is already approved.", 400);
    }

    supplier.isApproved = true;
    supplier.approvedBy = actorId || null;
    supplier.approvedAt = new Date();
    supplier.updatedBy = actorId || null;

    if (supplier.status === "Inactive") {
        supplier.status = "Active";
    }

    await supplier.save();
    return supplier;
};

// ==========================================================
// Status Actions
// ==========================================================

const blockSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);
    supplier.status = "Blocked";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

const activateSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.status === "Active") {
        throw new AppError("Supplier is already active.", 400);
    }

    supplier.status = "Active";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

const deactivateSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.status === "Inactive") {
        throw new AppError("Supplier is already inactive.", 400);
    }

    supplier.status = "Inactive";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

// ==========================================================
// Rating
// ==========================================================

const rateSupplier = async (id, score, actorId = null) => {
    if (score < 0 || score > 5) {
        throw new AppError("Rating must be between 0 and 5.", 400);
    }

    const supplier = await findActiveSupplierOrFail(id);
    await supplier.addRating(score);
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

// ==========================================================
// Reports / helpers
// ==========================================================

const getActiveSuppliers = async () => {
    return Supplier.getActiveSuppliers();
};

const getPurchaseReport = async () => {
    return Supplier.getPurchaseReport();
};

const getDueReport = async () => {
    return Supplier.getDueReport();
};

module.exports = {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier,
    restoreSupplier,
    permanentDeleteSupplier,
    bulkDeleteSuppliers,
    bulkRestoreSuppliers,
    bulkPermanentDeleteSuppliers,
    getSupplierStats,
    approveSupplier,
    blockSupplier,
    activateSupplier,
    deactivateSupplier,
    rateSupplier,
    getActiveSuppliers,
    getPurchaseReport,
    getDueReport
};
