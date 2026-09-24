const mongoose = require("mongoose");

const recordDeleteRequestSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        entityType: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        entityLabel: { type: String, default: "", trim: true },
        screen: { type: String, default: "Dashboard", trim: true },
        snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
        reason: { type: String, default: "", trim: true },
        recordOwnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true,
            index: true,
        },
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected", "cancelled", "completed"],
            default: "pending",
            index: true,
        },
        decidedAt: { type: Date, default: null },
        decidedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        decisionNote: { type: String, default: "", trim: true },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

recordDeleteRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
recordDeleteRequestSchema.index({
    companyId: 1,
    entityType: 1,
    entityId: 1,
    status: 1,
});

module.exports = mongoose.model("RecordDeleteRequest", recordDeleteRequestSchema);
