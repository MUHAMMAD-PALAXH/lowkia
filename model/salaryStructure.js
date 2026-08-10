const mongoose = require("mongoose");
const { DEFAULT_CURRENCY } = require("../config/finance");

/**
 * Flexible salary component (earning or deduction).
 * amountMinor is the source of truth for fixed amounts (USD cents).
 */
const componentSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            default: "",
            trim: true,
            uppercase: true,
        },

        componentName: {
            type: String,
            required: true,
            trim: true,
        },

        componentType: {
            type: String,
            enum: ["Earning", "Deduction"],
            required: true,
        },

        calculationType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Fixed",
        },

        /** Fixed amount in minor units (cents). */
        amountMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Legacy major-unit mirror. */
        amount: {
            type: Number,
            default: 0,
            min: 0,
        },

        percentage: {
            type: Number,
            default: 0,
            min: 0,
        },

        basedOn: {
            type: String,
            enum: ["Basic", "Gross", "Net"],
            default: "Basic",
        },

        isTaxable: {
            type: Boolean,
            default: false,
        },

        isRecurring: {
            type: Boolean,
            default: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },
    },
    { _id: false }
);

/**
 * Salary structure template or employee-assigned package.
 * Supports Monthly / Daily / Hourly pay bases for payroll (Phase 5).
 */
const salaryStructureSchema = new mongoose.Schema(
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

        structureName: {
            type: String,
            required: true,
            trim: true,
        },

        structureCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },

        /** Pay basis used by payroll calculator. */
        salaryType: {
            type: String,
            enum: ["Monthly", "Daily", "Hourly"],
            default: "Monthly",
            index: true,
        },

        // ── Rates (minor units) ──────────────────────────────
        basicSalaryMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        dailyRateMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        hourlyRateMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        overtimeRateMinor: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Legacy major mirrors (derived in service). */
        basicSalary: { type: Number, default: 0, min: 0 },
        dailyRate: { type: Number, default: 0, min: 0 },
        hourlyRate: { type: Number, default: 0, min: 0 },
        overtimeRate: { type: Number, default: 0, min: 0 },
        grossSalary: { type: Number, default: 0, min: 0 },
        grossSalaryMinor: { type: Number, default: 0, min: 0 },

        components: {
            type: [componentSchema],
            default: [],
        },

        departmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Department",
            default: null,
        },

        designationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Designation",
            default: null,
        },

        /** Optional primary employee this structure belongs to. */
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            default: null,
            index: true,
        },

        assignedEmployees: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Employee",
            },
        ],

        overtimeEnabled: {
            type: Boolean,
            default: true,
        },

        /** Multiplier of hourly rate for OT (e.g. 1.5). */
        overtimeMultiplier: {
            type: Number,
            default: 1.5,
            min: 0,
        },

        workingDaysPerMonth: {
            type: Number,
            default: 22,
            min: 1,
            max: 31,
        },

        workingHoursPerDay: {
            type: Number,
            default: 8,
            min: 1,
            max: 24,
        },

        effectiveFrom: {
            type: Date,
            default: Date.now,
        },

        effectiveTo: {
            type: Date,
            default: null,
        },

        isCurrent: {
            type: Boolean,
            default: true,
            index: true,
        },

        status: {
            type: String,
            enum: ["draft", "active", "archived"],
            default: "active",
            index: true,
        },

        previousStructureId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalaryStructure",
            default: null,
        },

        revisionReason: {
            type: String,
            default: "",
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        deletedAt: {
            type: Date,
            default: null,
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

salaryStructureSchema.index(
    { companyId: 1, structureCode: 1 },
    { unique: true }
);
salaryStructureSchema.index({ companyId: 1, status: 1, isCurrent: 1 });
salaryStructureSchema.index({ companyId: 1, employeeId: 1, isCurrent: 1 });
salaryStructureSchema.index({ companyId: 1, salaryType: 1 });

salaryStructureSchema.virtual("id").get(function () {
    return this._id.toHexString();
});

salaryStructureSchema.set("toJSON", { virtuals: true });
salaryStructureSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("SalaryStructure", salaryStructureSchema);
