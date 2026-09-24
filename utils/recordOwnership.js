const mongoose = require("mongoose");
const AppError = require("./appError");
const { isCompanyOwner } = require("./roleAccess");

const toId = (value) => {
    if (value == null) return "";
    if (typeof value === "object") {
        if (value._id != null) return String(value._id);
        if (value.id != null) return String(value.id);
    }
    return String(value);
};

const actorIdOf = (actor) => {
    if (!actor) return "";
    return toId(actor._id || actor.id || actor);
};

const createdByIdOf = (doc) => {
    if (!doc) return "";
    return toId(doc.createdBy);
};

/** True when the signed-in user created the document. */
const isRecordCreator = (doc, actor) => {
    const ownerId = createdByIdOf(doc);
    const userId = actorIdOf(actor);
    if (!ownerId || !userId) return false;
    return ownerId === userId;
};

/**
 * Legacy rows without createdBy: only company owner may mutate.
 * Others' rows: only the creator may mutate (SA cannot edit/trash peers).
 */
const canMutateRecordContent = (doc, actor) => {
    if (!actor) return false;
    const ownerId = createdByIdOf(doc);
    if (!ownerId) return isCompanyOwner(actor.role);
    return isRecordCreator(doc, actor);
};

const assertCanEditContent = (doc, actor, label = "Record") => {
    if (canMutateRecordContent(doc, actor)) return;
    throw new AppError(
        `Only the creator can edit this ${String(label).toLowerCase()}.`,
        403
    );
};

const assertCanTrash = (doc, actor, label = "Record") => {
    if (canMutateRecordContent(doc, actor)) return;
    throw new AppError(
        `Only the creator can move this ${String(label).toLowerCase()} to trash.`,
        403
    );
};

/** Restore / permanent delete from trash — own trash only. */
const assertCanManageTrashItem = (doc, actor, label = "Record") => {
    if (canMutateRecordContent(doc, actor)) return;
    throw new AppError(
        `You can only manage your own trash for this ${String(label).toLowerCase()}.`,
        403
    );
};

/**
 * Force trash listings to the current user's createdBy.
 * Company owner still only sees their own trash (per product policy).
 */
const applyOwnTrashFilter = (filter = {}, actor) => {
    const userId = actorIdOf(actor);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        filter.createdBy = null;
        return filter;
    }
    filter.createdBy = new mongoose.Types.ObjectId(userId);
    return filter;
};

const assertCanRequestPeerDelete = (doc, actor, label = "Record") => {
    if (!actor || !isCompanyOwner(actor.role)) {
        throw new AppError(
            "Only the company super admin can request deletion of another user's record.",
            403
        );
    }
    if (isRecordCreator(doc, actor)) {
        throw new AppError(
            `Use trash to remove your own ${String(label).toLowerCase()}.`,
            400
        );
    }
    if (!createdByIdOf(doc)) {
        throw new AppError(
            `This ${String(label).toLowerCase()} has no creator and cannot use the peer-delete flow.`,
            400
        );
    }
};

module.exports = {
    toId,
    actorIdOf,
    createdByIdOf,
    isRecordCreator,
    canMutateRecordContent,
    assertCanEditContent,
    assertCanTrash,
    assertCanManageTrashItem,
    applyOwnTrashFilter,
    assertCanRequestPeerDelete,
};
