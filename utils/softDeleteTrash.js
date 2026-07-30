const mongoose = require("mongoose");
const AppError = require("./appError");

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

/**
 * Generic soft-delete trash operations for any Mongoose model
 * that uses isDeleted / deletedAt / deletedBy.
 */
const createTrashOps = (Model, options = {}) => {
    const {
        label = "Item",
        nameField = "name",
        dateField = "createdAt",
        statusField = "status",
        restoreStatus = "Active",
        softDeleteExtra = null, // (doc) => void
        restoreExtra = null, // (doc) => void
        beforeSoftDelete = null, // async (doc, actorId) => void — throw to block
        beforePermanent = null, // async (doc) => void
        scopeStatusMap = {
            active: "Active",
            inactive: "Inactive",
            blocked: "Blocked",
            draft: "Draft",
            archived: "Archived"
        }
    } = options;

    const findActiveOrFail = async (id) => {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError(`Invalid ${label.toLowerCase()} id.`, 400);
        }
        const doc = await Model.findOne({ _id: id, isDeleted: { $ne: true } });
        if (!doc) throw new AppError(`${label} not found.`, 404);
        return doc;
    };

    const findTrashOrFail = async (id) => {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError(`Invalid ${label.toLowerCase()} id.`, 400);
        }
        const doc = await Model.findOne({ _id: id, isDeleted: true });
        if (!doc) throw new AppError(`Trash ${label.toLowerCase()} not found.`, 404);
        return doc;
    };

    const softDelete = async (id, actorId = null) => {
        const doc = await findActiveOrFail(id);
        if (beforeSoftDelete) await beforeSoftDelete(doc, actorId);
        markSoftDeleted(doc, actorId);
        if (softDeleteExtra) softDeleteExtra(doc);
        await doc.save();
        return doc;
    };

    const restore = async (id, actorId = null) => {
        const doc = await findTrashOrFail(id);
        clearSoftDeleted(doc, actorId);
        if (restoreStatus && statusField) {
            doc[statusField] = restoreStatus;
        }
        if (restoreExtra) restoreExtra(doc);
        await doc.save();
        return doc;
    };

    const permanentDelete = async (id) => {
        const doc = await findTrashOrFail(id);
        if (beforePermanent) await beforePermanent(doc);
        await Model.deleteOne({ _id: doc._id, isDeleted: true });
        return { id: String(doc._id) };
    };

    const buildScopeFilter = ({ ids = [], scope = "ids", status } = {}, trash) => {
        const filter = trash
            ? { isDeleted: true }
            : { isDeleted: { $ne: true } };
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
            // all matching trash/active
        } else if (scopeStatusMap[scopeKey]) {
            filter[statusField] = scopeStatusMap[scopeKey];
        } else if (status) {
            filter[statusField] = status;
        } else {
            throw new AppError("Invalid scope.", 400);
        }
        return filter;
    };

    const bulkSoftDelete = async (payload = {}, actorId = null) => {
        const filter = buildScopeFilter(payload, false);
        const docs = await Model.find(filter);
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
        return { deleted, failed: errors.length, errors };
    };

    const bulkRestore = async (payload = {}, actorId = null) => {
        const filter = buildScopeFilter(payload, true);
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

    const bulkPermanentDelete = async (payload = {}) => {
        const filter = buildScopeFilter(payload, true);
        if (beforePermanent) {
            const docs = await Model.find(filter);
            for (const doc of docs) {
                await beforePermanent(doc);
            }
        }
        const result = await Model.deleteMany(filter);
        return { deleted: result.deletedCount || 0 };
    };

    const trashCount = () => Model.countDocuments({ isDeleted: true });

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
