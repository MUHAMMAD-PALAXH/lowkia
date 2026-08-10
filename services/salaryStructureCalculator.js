const {
    DEFAULT_CURRENCY,
    toMinor,
    toMajor,
    assertCurrency,
    assertNonNegativeMinor,
} = require("../utils/money");

/**
 * Pure salary-structure math (Phase 4).
 * Used by API preview and Phase 5 payroll calculator.
 */

const normalizeSalaryType = (raw) => {
    const s = String(raw || "Monthly").trim();
    const key = s.toLowerCase();
    if (key === "daily") return "Daily";
    if (key === "hourly") return "Hourly";
    return "Monthly";
};

const normalizeComponent = (c = {}, currency = DEFAULT_CURRENCY) => {
    const calc =
        String(c.calculationType || "Fixed")
            .toLowerCase()
            .includes("percent")
            ? "Percentage"
            : "Fixed";

    let amountMinor = 0;
    if (c.amountMinor != null) {
        amountMinor = assertNonNegativeMinor(c.amountMinor, "Component amount");
    } else if (c.amount != null) {
        amountMinor = toMinor(c.amount, currency);
    }

    const basedRaw = String(c.basedOn || "Basic");
    let basedOn = "Basic";
    if (/gross/i.test(basedRaw)) basedOn = "Gross";
    else if (/net/i.test(basedRaw)) basedOn = "Net";

    return {
        code: String(c.code || "")
            .trim()
            .toUpperCase()
            .slice(0, 32),
        componentName: String(c.componentName || c.name || "Component").trim(),
        componentType: /deduct/i.test(String(c.componentType || "Earning"))
            ? "Deduction"
            : "Earning",
        calculationType: calc,
        amountMinor,
        amount: toMajor(amountMinor, currency),
        percentage: Number(c.percentage) || 0,
        basedOn,
        isTaxable: c.isTaxable === true,
        isRecurring: c.isRecurring !== false,
        description: String(c.description || "").trim(),
    };
};

/**
 * Resolve base pay for a period snapshot.
 * @param {object} structure
 * @param {{ presentDays?: number, workedHours?: number, workedMinutes?: number }} attendance
 */
const resolveBasePayMinor = (structure, attendance = {}) => {
    const type = normalizeSalaryType(structure.salaryType);
    if (type === "Hourly") {
        const hours =
            attendance.workedHours != null
                ? Number(attendance.workedHours)
                : (Number(attendance.workedMinutes) || 0) / 60;
        const rate = assertNonNegativeMinor(
            structure.hourlyRateMinor || 0,
            "Hourly rate"
        );
        return Math.round(rate * Math.max(0, hours));
    }
    if (type === "Daily") {
        const days = Number(attendance.presentDays);
        const dayCount = Number.isFinite(days)
            ? days
            : Number(structure.workingDaysPerMonth) || 22;
        const rate = assertNonNegativeMinor(
            structure.dailyRateMinor || 0,
            "Daily rate"
        );
        return Math.round(rate * Math.max(0, dayCount));
    }
    return assertNonNegativeMinor(
        structure.basicSalaryMinor || 0,
        "Basic salary"
    );
};

/**
 * Apply percentage / fixed components against a basic base.
 * Percentage-of-Gross components use basic + fixed earnings first (2-pass).
 */
const applyComponents = (basicMinor, components = [], currency = DEFAULT_CURRENCY) => {
    const list = (components || []).map((c) =>
        typeof c.amountMinor === "number" ? c : normalizeComponent(c, currency)
    );

    let earningMinor = 0;
    let deductionMinor = 0;
    const lines = [];

    // Pass 1: fixed + % of basic
    for (const c of list) {
        let lineMinor = 0;
        if (c.calculationType === "Percentage") {
            if (c.basedOn === "Basic") {
                lineMinor = Math.round((basicMinor * (c.percentage || 0)) / 100);
            } else {
                // Gross/Net resolved in pass 2
                continue;
            }
        } else {
            lineMinor = assertNonNegativeMinor(c.amountMinor || 0);
        }

        if (c.componentType === "Earning") earningMinor += lineMinor;
        else deductionMinor += lineMinor;

        lines.push({
            ...c,
            computedMinor: lineMinor,
            computed: toMajor(lineMinor, currency),
        });
    }

    const grossAfterFixed = basicMinor + earningMinor;

    // Pass 2: % of Gross (and Net ≈ gross for structure preview)
    for (const c of list) {
        if (c.calculationType !== "Percentage") continue;
        if (c.basedOn === "Basic") continue;

        const base =
            c.basedOn === "Net" ? Math.max(0, grossAfterFixed) : grossAfterFixed;
        const lineMinor = Math.round((base * (c.percentage || 0)) / 100);

        if (c.componentType === "Earning") earningMinor += lineMinor;
        else deductionMinor += lineMinor;

        lines.push({
            ...c,
            computedMinor: lineMinor,
            computed: toMajor(lineMinor, currency),
        });
    }

    const grossMinor = basicMinor + earningMinor;
    const netMinor = Math.max(0, grossMinor - deductionMinor);

    return {
        basicMinor,
        earningMinor,
        deductionMinor,
        grossMinor,
        netMinor,
        lines,
        amounts: {
            basic: toMajor(basicMinor, currency),
            earnings: toMajor(earningMinor, currency),
            deductions: toMajor(deductionMinor, currency),
            gross: toMajor(grossMinor, currency),
            net: toMajor(netMinor, currency),
        },
    };
};

const previewStructurePay = (structure, attendance = {}) => {
    const currency = assertCurrency(structure.currency || DEFAULT_CURRENCY);
    const basicMinor = resolveBasePayMinor(structure, attendance);
    const breakdown = applyComponents(
        basicMinor,
        structure.components || [],
        currency
    );
    return {
        currency,
        salaryType: normalizeSalaryType(structure.salaryType),
        ...breakdown,
    };
};

/** Default US-oriented allowance/deduction starter set (amounts 0). */
const defaultComponentTemplates = () => [
    {
        code: "HOUSE",
        componentName: "House Allowance",
        componentType: "Earning",
        calculationType: "Fixed",
        amountMinor: 0,
    },
    {
        code: "MEDICAL",
        componentName: "Medical Allowance",
        componentType: "Earning",
        calculationType: "Fixed",
        amountMinor: 0,
    },
    {
        code: "TRANSPORT",
        componentName: "Transport Allowance",
        componentType: "Earning",
        calculationType: "Fixed",
        amountMinor: 0,
    },
    {
        code: "FOOD",
        componentName: "Food Allowance",
        componentType: "Earning",
        calculationType: "Fixed",
        amountMinor: 0,
    },
    {
        code: "OTHER_EARN",
        componentName: "Other Allowance",
        componentType: "Earning",
        calculationType: "Fixed",
        amountMinor: 0,
    },
    {
        code: "OTHER_DED",
        componentName: "Other Deduction",
        componentType: "Deduction",
        calculationType: "Fixed",
        amountMinor: 0,
    },
];

module.exports = {
    normalizeSalaryType,
    normalizeComponent,
    resolveBasePayMinor,
    applyComponents,
    previewStructurePay,
    defaultComponentTemplates,
};
