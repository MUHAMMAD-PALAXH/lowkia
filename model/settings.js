const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        default: "global"
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

module.exports = mongoose.model("Settings", settingsSchema);
