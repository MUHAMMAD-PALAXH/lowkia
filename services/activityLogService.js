const ActivityLog = require("../model/activityLog");
const { generateActivityLogCode } = require("./codeGenerator");

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

module.exports = { writeActivityLog };
