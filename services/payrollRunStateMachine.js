const AppError = require("../utils/appError");
const { PAYROLL_RUN_STATUSES } = require("../config/finance");

/**
 * PayrollRun status transitions (Phase 5).
 * locked → paid is reserved for Phase 7 employee payments.
 */
const TRANSITIONS = Object.freeze({
    draft: ["calculating", "cancelled"],
    calculating: ["calculated", "draft", "cancelled"],
    calculated: ["pendingApproval", "draft", "cancelled"],
    pendingApproval: ["approved", "calculated", "cancelled"],
    approved: ["locked", "calculated", "cancelled"],
    locked: ["paid"],
    paid: ["locked"], // unlock only via payment reverse
    cancelled: [],
});

const assertValidStatus = (status) => {
    const s = String(status || "").trim();
    if (!PAYROLL_RUN_STATUSES.includes(s)) {
        throw new AppError(`Invalid payroll run status: ${status}`, 400);
    }
    return s;
};

const canTransition = (from, to) => {
    const current = assertValidStatus(from);
    const next = assertValidStatus(to);
    if (current === next) return true;
    return (TRANSITIONS[current] || []).includes(next);
};

const assertTransition = (from, to) => {
    const current = assertValidStatus(from);
    const next = assertValidStatus(to);
    if (current === next) return next;
    if (!canTransition(current, next)) {
        throw new AppError(
            `Invalid payroll run transition: ${current} → ${next}`,
            400
        );
    }
    return next;
};

const isEditable = (status) => {
    const s = assertValidStatus(status);
    return s === "draft" || s === "calculated";
};

const isTerminal = (status) => {
    const s = assertValidStatus(status);
    return (TRANSITIONS[s] || []).length === 0;
};

module.exports = {
    TRANSITIONS,
    assertValidStatus,
    canTransition,
    assertTransition,
    isEditable,
    isTerminal,
};
