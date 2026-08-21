const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

const settingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        default: "global",
        index: true
    },

    salesTargets: {
        daily: { type: Number, default: 1000 },
        weekly: { type: Number, default: 7000 },
        monthly: { type: Number, default: 30000 },
        yearly: { type: Number, default: 365000 }
    },

    /**
     * Company/tenant timezone for attendance day boundaries.
     * Until a Company model exists, this is the global ERP timezone.
     */
    timezone: {
        type: String,
        default: "Asia/Dhaka",
        trim: true
    },

    /**
     * Default attendance policy reference (optional shortcut).
     * Runtime rules still come from AttendancePolicy documents.
     */
    defaultAttendancePolicyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AttendancePolicy",
        default: null
    },

    updatedAt: { type: Date, default: Date.now }
});

settingsSchema.plugin(tenantPlugin);
settingsSchema.index({ companyId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Settings", settingsSchema);
