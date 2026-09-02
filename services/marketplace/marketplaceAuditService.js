const { writeActivityLog } = require("../activityLogService");

const toAuditUser = (actor = {}) => ({
    _id: actor._id || actor.id || actor.userId,
    firstName: actor.firstName || actor.userName || "Marketplace",
    lastName: actor.lastName || "",
    email: actor.email || "",
    role: actor.role || actor.userRole || "system",
    companyId: actor.companyId || null,
});

/**
 * Best-effort marketplace audit trail via ActivityLog.
 */
const auditMarketplaceAction = async ({
    actor = null,
    companyId = null,
    activityType = "Update",
    subModule = "",
    description,
    shortDescription = "",
    referenceType = "Marketplace",
    referenceId = null,
    oldData = null,
    newData = null,
    changedFields = [],
    ipAddress = "",
    securityLevel = "High",
} = {}) => {
    if (!description) return null;

    const user = actor?._id ? toAuditUser(actor) : {
        _id: actor?.userId || referenceId,
        firstName: "Marketplace",
        lastName: "System",
        email: "",
        role: "system",
        companyId,
    };

    if (!user._id) return null;

    return writeActivityLog({
        user,
        companyId,
        activityType,
        module: "Marketplace",
        subModule,
        description,
        shortDescription,
        referenceType,
        referenceId,
        oldData,
        newData,
        changedFields,
        ipAddress,
        securityLevel,
    });
};

module.exports = {
    auditMarketplaceAction,
};
