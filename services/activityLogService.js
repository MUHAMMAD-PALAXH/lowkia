const ActivityLog = require("../model/activityLog");
const { generateActivityLogCode } = require("./codeGenerator");
const { applyBranchScopeFilter } = require("../middleware/hrAccess");

const NOT_DELETED = { isDeleted: { $ne: true } };

/**
 * Best-effort audit writer using existing ActivityLog model.
 * Never throws to callers — attendance flow must not fail on audit errors.
 */
const writeActivityLog = async ({
    user,
    companyId = null,
    branchId = null,
    activityType = "Update",
    module = "Attendance",
    subModule = "",
    description,
    shortDescription = "",
    referenceType = "Attendance",
    referenceId = null,
    oldData = null,
    newData = null,
    changedFields = [],
    ipAddress = "",
    securityLevel = "Medium"
} = {}) => {
    try {
        if (!user?._id || !description) return null;

        const activityNumber = await generateActivityLogCode();
        const userName =
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.username ||
            user.email ||
            "";

        const [doc] = await ActivityLog.create([
            {
                companyId: companyId || user.companyId || null,
                branchId: branchId || null,
                userId: user._id,
                userRole: user.role || "",
                userName,
                userEmail: user.email || "",
                activityNumber,
                activityType,
                module,
                subModule,
                description,
                shortDescription: shortDescription || description.slice(0, 120),
                referenceType,
                referenceId,
                oldData,
                newData,
                changedFields: Array.isArray(changedFields)
                    ? changedFields
                    : [],
                ipAddress: ipAddress || "",
                securityLevel,
                status: "Success"
            }
        ]);
        return doc;
    } catch (err) {
        console.warn(
            "[ActivityLog] write failed:",
            err?.message || err
        );
        return null;
    }
};

const listAttendanceAudit = async (query = {}, managedBranchIds = null) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {
        module: "Attendance",
        ...NOT_DELETED
    };

    if (query.activityType) filter.activityType = query.activityType;
    if (query.subModule) filter.subModule = query.subModule;
    if (query.userId) filter.userId = query.userId;
    if (query.referenceId) filter.referenceId = query.referenceId;

    applyBranchScopeFilter(filter, managedBranchIds, query.branchId);

    const [items, total] = await Promise.all([
        ActivityLog.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ActivityLog.countDocuments(filter)
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

module.exports = { writeActivityLog, listAttendanceAudit };
