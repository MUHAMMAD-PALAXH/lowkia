/**
 * Shared finance / payment constants for ERP Payment + Payroll.
 * Payment Method ≠ Payment Provider.
 */

const DEFAULT_CURRENCY = "USD";
const SUPPORTED_CURRENCIES = Object.freeze(["USD"]); // V1; extend later: CAD, GBP, EUR

/** ERP payment methods (US-oriented). */
const PAYMENT_METHODS = Object.freeze([
    "CASH",
    "CARD",
    "BANK_TRANSFER",
    "ACH",
    "CHECK",
    "APPLE_PAY",
]);

/** PCI-compliant processors / banks — never store raw card data. */
const PAYMENT_PROVIDERS = Object.freeze([
    "NONE",
    "STRIPE",
    "BANK",
    "OTHER",
]);

/**
 * Controlled payment lifecycle.
 * Do not allow arbitrary transitions — use paymentStateMachine.
 */
const PAYMENT_STATUSES = Object.freeze([
    "draft",
    "pendingApproval",
    "approved",
    "processing",
    "paid",
    "failed",
    "cancelled",
    "reversed",
]);

const PAYMENT_TYPES = Object.freeze([
    "SupplierPayment",
    "SupplierAdvance",
    "EmployeeSalary",
    "EmployeeAdvance",
    "EmployeeBonus",
    "EmployeeOther",
    "CustomerPayment",
    "CustomerRefund",
    "ExpensePayment",
    "Other",
]);

const PARTY_TYPES = Object.freeze([
    "Supplier",
    "Employee",
    "Customer",
    "Other",
]);

/** Why this payment exists (allocation / business purpose). */
const PAYMENT_PURPOSES = Object.freeze([
    "advance",
    "againstPayable",
    "salary",
    "bonus",
    "reimbursement",
    "other",
]);

/** Payroll batch run lifecycle (Phase 5). */
const PAYROLL_RUN_STATUSES = Object.freeze([
    "draft",
    "calculating",
    "calculated",
    "pendingApproval",
    "approved",
    "locked",
    "paid",
    "cancelled",
]);

/** Per-employee payroll line status. */
const PAYROLL_LINE_STATUSES = Object.freeze([
    "draft",
    "calculated",
    "approved",
    "paid",
    "cancelled",
    "skipped",
]);

/** Employee salary advance lifecycle (Phase 6). */
const EMPLOYEE_ADVANCE_STATUSES = Object.freeze([
    "draft",
    "pendingApproval",
    "approved",
    "rejected",
    "cancelled",
    "disbursed",
    "recovering",
    "settled",
    "reversed",
]);

module.exports = {
    DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
    PAYMENT_STATUSES,
    PAYMENT_TYPES,
    PARTY_TYPES,
    PAYMENT_PURPOSES,
    PAYROLL_RUN_STATUSES,
    PAYROLL_LINE_STATUSES,
    EMPLOYEE_ADVANCE_STATUSES,
};
