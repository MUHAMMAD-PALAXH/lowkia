/**
 * Bookkeeping ledger vocabulary.
 *
 * Accounts are sub-ledger "lanes". Each entry carries signed effects per lane so
 * balances (cash, receivable, payable, …) are computed per lane — never one
 * mixed global balance. INVENTORY entries are quantity movements only (no
 * valuation lane: sale movements store selling price, not cost).
 */

const BK_SOURCE_MODULES = Object.freeze([
    "Sales",
    "Online Order",
    "Purchase",
    "GRN",
    "Inventory",
    "Return",
    "Repair",
    "Expense",
    "Salary",
    "Supplier Payment",
    "Customer Payment",
    "Transfer",
    "Adjustment",
    "Other",
]);

const BK_ACCOUNTS = Object.freeze([
    "CASH",
    "BANK",
    "RECEIVABLE",
    "PAYABLE",
    "REVENUE",
    "PURCHASES",
    "EXPENSE",
    "INVENTORY",
]);

const BK_TRANSACTION_TYPES = Object.freeze([
    "sale",
    "sale_reversal",
    "sales_return",
    "customer_payment",
    "customer_refund",
    "online_sale",
    "online_sale_reversal",
    "online_payment",
    "online_refund",
    "repair_charge",
    "repair_charge_reversal",
    "repair_payment",
    "purchase",
    "purchase_reversal",
    "supplier_payment",
    "supplier_advance",
    "salary_payment",
    "employee_advance",
    "employee_bonus",
    "employee_payment",
    "expense_payment",
    "other_payment",
    "payment_reversal",
    "stock_in",
    "stock_out",
    "stock_transfer",
    "branch_transfer",
    "adjustment",
]);

const BK_STATUSES = Object.freeze([
    "completed",
    "pending",
    "reversed",
    "voided",
]);

const CASH_ACCOUNTS = Object.freeze(["CASH", "BANK"]);

module.exports = {
    BK_SOURCE_MODULES,
    BK_ACCOUNTS,
    BK_TRANSACTION_TYPES,
    BK_STATUSES,
    CASH_ACCOUNTS,
};
