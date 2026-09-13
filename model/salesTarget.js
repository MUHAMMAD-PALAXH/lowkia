const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

const PERIOD_TYPES = ["daily", "weekly", "monthly", "yearly"];

const salesTargetSchema = new mongoose.Schema(
    {
        periodType: {
            type: String,
            enum: PERIOD_TYPES,
            required: true,
            index: true,
        },
        /** daily/weekly: YYYY-MM-DD, monthly: YYYY-MM, yearly: YYYY */
        periodKey: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        note: {
            type: String,
            trim: true,
            maxlength: 200,
            default: "",
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    { timestamps: true }
);

salesTargetSchema.plugin(tenantPlugin);
salesTargetSchema.index(
    { companyId: 1, periodType: 1, periodKey: 1 },
    { unique: true }
);

module.exports = mongoose.model("SalesTarget", salesTargetSchema);
module.exports.PERIOD_TYPES = PERIOD_TYPES;
