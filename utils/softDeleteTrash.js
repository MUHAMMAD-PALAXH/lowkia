const mongoose = require("mongoose");
const AppError = require("./appError");
const { companyFilter } = require("./tenantScope");

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const isTrashQuery = (query = {}) =>
    query.deleted === "true" ||
    query.trash === "true" ||
    query.includeDeleted === "trash";

/**
 * Build sort object for list/trash.
 * Supports: newest | oldest | alpha | items_asc | items_desc
 */
const resolveEntitySort = (
    query = {},
    { nameField = "name", dateField = "createdAt" } = {}
) => {
    const sortKey = String(query.sort || query.sortBy || "newest").toLowerCase();
    switch (sortKey) {
        case "alpha":
        case "alphabetical":
        case "name":
            return { [nameField]: 1 };
        case "oldest":
            return { [dateField]: 1 };
        case "items_asc":
        case "count_asc":
        case "low":
            return { itemCount: 1, [dateField]: -1 };
        case "items_desc":
        case "count_desc":
        case "high":
            return { itemCount: -1, [dateField]: -1 };
        case "newest":
        default:
            return { [dateField]: -1 };
    }
};

const markSoftDeleted = (doc, actorId = null) => {
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.deletedBy = actorId || null;
    return doc;
};

const clearSoftDeleted = (doc, actorId = null) => {
    doc.isDeleted = false;
    doc.deletedAt = null;
    doc.deletedBy = null;
    if (actorId) doc.updatedBy = actorId;
    return doc;
};

const applyTenant = (filter, companyId) => {
    if (companyId == null || companyId === "") return filter;
    return { ...filter, ...companyFilter(companyId) };
};

/**
 * Generic soft-delete trash operations for any Mongoose model
 * that uses isDeleted / deletedAt / deletedBy.
 *
 * When companyId is provided, all find/bulk ops are tenant-scoped.
 */
const createTrashOps = (Model, options = {}) => {
    const {
        label = "Item",
        nameField = "name",
        dateField = "createdAt",
        statusField = "status",
        restoreStatus = "Active",
        softDeleteExtra = null,
        restoreExtra = null,
        beforeSoftDelete = null,
        beforePermanent = null,
        scopeStatusMap = {
            active: "Active",
            inactive: "Inactive",
            blocked: "Blocked",
            draft: "Draft",
            archived: "Archived"
        }
    } = options;

    const findActiveOrFail = async (id, companyId = null) => {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError(`Invalid ${label.toLowerCase()} id.`, 400);
        }
        const filter = applyTenant(
            { _id: id, isDeleted: { $ne: true } },
            companyId
        );
        const doc = await Model.findOne(filter);
        if (!doc) throw new AppError(`${label} not found.`, 404);
        return doc;
    };

    const findTrashOrFail = async (id, companyId = null) => {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError(`Invalid ${label.toLowerCase()} id.`, 400);
        }
        const filter = applyTenant({ _id: id, isDeleted: true }, companyId);
        const doc = await Model.findOne(filter);
        if (!doc) throw new AppError(`Trash ${label.toLowerCase()} not found.`, 404);
        return doc;
    };

    const softDelete = async (id, actorId = null, companyId = null) => {
        const doc = await findActiveOrFail(id, companyId);
        if (beforeSoftDelete) await beforeSoftDelete(doc, actorId);
        markSoftDeleted(doc, actorId);
        if (softDeleteExtra) softDeleteExtra(doc);
        await doc.save();
        return doc;
    };

    const restore = async (id, actorId = null, companyId = null) => {
        const doc = await findTrashOrFail(id, companyId);
        clearSoftDeleted(doc, actorId);
        if (restoreStatus && statusField) {
            doc[statusField] = restoreStatus;
        }
        if (restoreExtra) restoreExtra(doc);
        await doc.save();
        return doc;
    };

    const permanentDelete = async (id, companyId = null) => {
        const doc = await findTrashOrFail(id, companyId);
        if (beforePermanent) await beforePermanent(doc);
        await Model.deleteOne(
            applyTenant({ _id: doc._id, isDeleted: true }, companyId)
        );
        return { id: String(doc._id) };
    };

    const buildScopeFilter = (
        { ids = [], scope = "ids", status } = {},
        trash,
        companyId = null
    ) => {
        let filter = trash
            ? { isDeleted: true }
            : { isDeleted: { $ne: true } };
        filter = applyTenant(filter, companyId);
        const scopeKey = String(scope || "ids").toLowerCase();

        if (scopeKey === "ids") {
            const objectIds = (ids || []).map(toObjectId).filter(Boolean);
            if (!objectIds.length) {
                throw new AppError(
                    `Select at least one ${label.toLowerCase()}.`,
                    400
                );
            }
            filter._id = { $in: objectIds };
        } else if (scopeKey === "all") {
            // all matching trash/active within tenant
        } else if (scopeStatusMap[scopeKey]) {
            filter[statusField] = scopeStatusMap[scopeKey];
        } else if (status) {
            filter[statusField] = status;
        } else {
            throw new AppError("Invalid scope.", 400);
        }
        return filter;
    };

    const bulkSoftDelete = async (
        payload = {},
        actorId = null,
        companyId = null
    ) => {
        const filter = buildScopeFilter(payload, false, companyId);
        const docs = await Model.find(filter);
        if (!docs.length) {
            throw new AppError(
                `No matching active ${label.toLowerCase()} found for the selected trash action.`,
                404
            );
        }
        let deleted = 0;
        const errors = [];
        for (const doc of docs) {
            try {
                if (beforeSoftDelete) await beforeSoftDelete(doc, actorId);
                markSoftDeleted(doc, actorId);
                if (softDeleteExtra) softDeleteExtra(doc);
                await doc.save();
                deleted += 1;
            } catch (e) {
                errors.push({
                    id: String(doc._id),
                    message: e?.message || "Failed"
                });
            }
        }
        if (deleted === 0 && errors.length) {
            throw new AppError(errors.map((e) => e.message).join(" | "), 400);
        }
        return { deleted, failed: errors.length, errors };
    };

    const bulkRestore = async (
        payload = {},
        actorId = null,
        companyId = null
    ) => {
        const filter = buildScopeFilter(payload, true, companyId);
        const docs = await Model.find(filter);
        let restored = 0;
        for (const doc of docs) {
            clearSoftDeleted(doc, actorId);
            if (restoreStatus && statusField) {
                doc[statusField] = restoreStatus;
            }
            if (restoreExtra) restoreExtra(doc);
            await doc.save();
            restored += 1;
        }
        return { restored };
    };

    const bulkPermanentDelete = async (payload = {}, companyId = null) => {
        const filter = buildScopeFilter(payload, true, companyId);
        if (beforePermanent) {
            const docs = await Model.find(filter);
            for (const doc of docs) {
                await beforePermanent(doc);
            }
        }
        const result = await Model.deleteMany(filter);
        return { deleted: result.deletedCount || 0 };
    };

    const trashCount = (companyId = null) =>
        Model.countDocuments(applyTenant({ isDeleted: true }, companyId));

    return {
        toObjectId,
        isTrashQuery,
        resolveEntitySort: (query) =>
            resolveEntitySort(query, { nameField, dateField }),
        findActiveOrFail,
        findTrashOrFail,
        softDelete,
        restore,
        permanentDelete,
        bulkSoftDelete,
        bulkRestore,
        bulkPermanentDelete,
        trashCount,
        nameField,
        dateField
    };
};

module.exports = {
    toObjectId,
    isTrashQuery,
    resolveEntitySort,
    markSoftDeleted,
    clearSoftDeleted,
    createTrashOps
};
