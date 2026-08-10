const AppError = require("../utils/appError");
const { EMPLOYEE_ADVANCE_STATUSES } = require("../config/finance");

/**
 * EmployeeAdvance status transitions (Phase 6).
 * disbursed / recovering / settled feed Phase 7 payments + payroll recovery.
 */
const TRANSITIONS = Object.freeze({
    draft: ["pendingApproval", "cancelled"],
    pendingApproval: ["approved", "rejected", "cancelled", "draft"],
    approved: ["disbursed", "cancelled", "reversed"],
    rejected: [],
    cancelled: [],
    disbursed: ["recovering", "settled", "reversed"],
    recovering: ["settled", "reversed"],
    settled: [],
    reversed: [],
});

const assertValidStatus = (status) => {
    const s = String(status || "").trim();
    if (!EMPLOYEE_ADVANCE_STATUSES.includes(s)) {
        throw new AppError(`Invalid employee advance status: ${status}`, 400);
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
            `Invalid employee advance transition: ${current} → ${next}`,
            400
        );
    }
    return next;
};

const isEditable = (status) => {
    const s = assertValidStatus(status);
    return s === "draft" || s === "pendingApproval";
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
