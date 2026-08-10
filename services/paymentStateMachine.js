const AppError = require("../utils/appError");
const { PAYMENT_STATUSES } = require("../config/finance");

/**
 * Allowed payment status transitions.
 * Keys = current status; values = allowed next statuses.
 */
const TRANSITIONS = Object.freeze({
    draft: ["pendingApproval", "approved", "cancelled"],
    pendingApproval: ["approved", "cancelled", "failed"],
    approved: ["processing", "paid", "cancelled"],
    processing: ["paid", "failed", "cancelled"],
    paid: ["reversed"],
    failed: ["draft", "cancelled"],
    cancelled: [],
    reversed: [],
});

const normalizeStatus = (status) =>
    String(status || "")
        .trim()
        .replace(/\s+/g, "");

/** Map legacy Title Case statuses from unused schema drafts → canonical. */
const LEGACY_STATUS_MAP = Object.freeze({
    Draft: "draft",
    "PendingApproval": "pendingApproval",
    "Pending Approval": "pendingApproval",
    Approved: "approved",
    Processing: "processing",
    Paid: "paid",
    Failed: "failed",
    Cancelled: "cancelled",
    Reversed: "reversed",
});

const toCanonicalStatus = (status) => {
    if (PAYMENT_STATUSES.includes(status)) return status;
    if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status];
    const compact = normalizeStatus(status);
    const hit = PAYMENT_STATUSES.find(
        (s) => s.toLowerCase() === compact.toLowerCase()
    );
    return hit || null;
};

const assertValidStatus = (status) => {
    const canonical = toCanonicalStatus(status);
    if (!canonical) {
        throw new AppError(`Invalid payment status: ${status}`, 400);
    }
    return canonical;
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
            `Invalid payment status transition: ${current} → ${next}`,
            400
        );
    }
    return next;
};

const isTerminal = (status) => {
    const s = assertValidStatus(status);
    return TRANSITIONS[s].length === 0;
};

const isEditable = (status) => {
    const s = assertValidStatus(status);
    return s === "draft" || s === "pendingApproval" || s === "failed";
};

const isPaidLocked = (status) => assertValidStatus(status) === "paid";

module.exports = {
    TRANSITIONS,
    PAYMENT_STATUSES,
    toCanonicalStatus,
    assertValidStatus,
    canTransition,
    assertTransition,
    isTerminal,
    isEditable,
    isPaidLocked,
};
