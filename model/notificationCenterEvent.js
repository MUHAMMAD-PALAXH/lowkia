const mongoose = require("mongoose");

const userStateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true,
        },
        at: { type: Date, default: Date.now },
    },
    { _id: false }
);

const notificationCenterEventSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
            index: true,
        },
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
            index: true,
        },
        audienceRoles: {
            type: [String],
            default: ["admin", "branch_manager"],
        },
        category: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        priority: {
            type: String,
            enum: ["low", "normal", "high", "critical"],
            default: "normal",
            index: true,
        },
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true, trim: true },
        entityType: { type: String, default: "", trim: true },
        entityId: { type: String, default: "", trim: true },
        entityLabel: { type: String, default: "", trim: true },
        screen: { type: String, default: "Dashboard", trim: true },
        tab: { type: String, default: "", trim: true },
        actor: {
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "AdminUser",
                default: null,
            },
            name: { type: String, default: "" },
            role: { type: String, default: "" },
        },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        source: { type: String, default: "api", trim: true },
        eventKey: {
            type: String,
            trim: true,
        },
        readBy: { type: [userStateSchema], default: [] },
        archivedBy: { type: [userStateSchema], default: [] },
        expiresAt: { type: Date, default: null },
    },
    { timestamps: true, versionKey: false }
);

notificationCenterEventSchema.index({ companyId: 1, createdAt: -1 });
notificationCenterEventSchema.index({
    companyId: 1,
    category: 1,
    createdAt: -1,
});
notificationCenterEventSchema.index(
    { eventKey: 1 },
    { unique: true, sparse: true }
);
notificationCenterEventSchema.index({
    companyId: 1,
    recipientId: 1,
    createdAt: -1,
});
notificationCenterEventSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: "date" } } }
);

module.exports = mongoose.model(
    "NotificationCenterEvent",
    notificationCenterEventSchema
);
