const AppError = require("./appError");
const {
    DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES,
} = require("../config/finance");

/**
 * Financially safe money helpers.
 * Store and compare amounts as integer minor units (cents for USD).
 * Never use raw floating-point for balances / overpayment checks.
 */

const toNumber = (value) => {
    if (value == null || value === "") return NaN;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value.trim());
    if (typeof value === "bigint") return Number(value);
    return NaN;
};

const assertCurrency = (currency = DEFAULT_CURRENCY) => {
    const code = String(currency || DEFAULT_CURRENCY)
        .trim()
        .toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(code)) {
        throw new AppError(
            `Currency ${code} is not supported in V1. Use ${DEFAULT_CURRENCY}.`,
            400
        );
    }
    return code;
};

/**
 * Convert major units (e.g. 100.25) → minor units (10025).
 * Uses banker's-safe rounding via Math.round after scaling.
 */
const toMinor = (majorAmount, currency = DEFAULT_CURRENCY) => {
    assertCurrency(currency);
    const n = toNumber(majorAmount);
    if (!Number.isFinite(n)) {
        throw new AppError("Invalid monetary amount.", 400);
    }
    return Math.round(n * 100);
};

/** Convert minor units → major units number (for API display / legacy float fields). */
const toMajor = (minorAmount, currency = DEFAULT_CURRENCY) => {
    assertCurrency(currency);
    const n = toNumber(minorAmount);
    if (!Number.isFinite(n)) {
        throw new AppError("Invalid monetary amount.", 400);
    }
    return Math.round(n) / 100;
};

/** Format for receipts/UI: "$1,234.56" */
const formatMoney = (minorAmount, currency = DEFAULT_CURRENCY) => {
    const code = assertCurrency(currency);
    const major = toMajor(minorAmount, code);
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
    }).format(major);
};

const assertPositiveMinor = (minorAmount, label = "Amount") => {
    const n = Math.round(toNumber(minorAmount));
    if (!Number.isFinite(n) || n <= 0) {
        throw new AppError(`${label} must be greater than zero.`, 400);
    }
    return n;
};

const assertNonNegativeMinor = (minorAmount, label = "Amount") => {
    const n = Math.round(toNumber(minorAmount));
    if (!Number.isFinite(n) || n < 0) {
        throw new AppError(`${label} cannot be negative.`, 400);
    }
    return n;
};

/**
 * Hard-reject overpayment (V1).
 * outstandingMinor must already be the remaining due.
 */
const assertNotOverpaying = (payMinor, outstandingMinor, label = "Payment") => {
    const pay = assertPositiveMinor(payMinor, label);
    const due = assertNonNegativeMinor(outstandingMinor, "Outstanding");
    if (pay > due) {
        throw new AppError(
            `${label} of ${formatMoney(pay)} exceeds outstanding ${formatMoney(due)}. Overpayment is not allowed.`,
            400
        );
    }
    return pay;
};

const addMinor = (...parts) =>
    parts.reduce((sum, p) => sum + Math.round(toNumber(p) || 0), 0);

const subMinor = (a, b) => Math.round(toNumber(a) || 0) - Math.round(toNumber(b) || 0);

module.exports = {
    DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES,
    assertCurrency,
    toMinor,
    toMajor,
    formatMoney,
    assertPositiveMinor,
    assertNonNegativeMinor,
    assertNotOverpaying,
    addMinor,
    subMinor,
};
