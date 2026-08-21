const {
    ROLES,
    LOGIN_DESTINATION,
} = require("../constants/roles");

const normalizeRole = (role) => String(role || "").trim().toLowerCase();

const isGlobalSuperAdmin = (role) =>
    normalizeRole(role) === ROLES.GLOBAL_SUPER_ADMIN;

/** Company owner / full company admin (incl. legacy admin). */
const isCompanyOwner = (role) => {
    const r = normalizeRole(role);
    return r === ROLES.COMPANY_SUPER_ADMIN || r === ROLES.ADMIN;
};

/** Branch / employee staff (incl. legacy branch_manager). */
const isCompanyEmployee = (role) => {
    const r = normalizeRole(role);
    return r === ROLES.EMPLOYEE || r === ROLES.BRANCH_MANAGER;
};

const isVendor = (role) => normalizeRole(role) === ROLES.VENDOR;

/** Deprecated supplier login accounts. */
const isSupplierLogin = (role) => normalizeRole(role) === ROLES.SUPPLIER;

/** Owner-level company ERP access. */
const hasAdminPower = (role) =>
    isCompanyOwner(role) || isGlobalSuperAdmin(role);

/** Admin + employee (branch) levels. */
const hasManagerPower = (role) =>
    hasAdminPower(role) || isCompanyEmployee(role);

const loginDestinationForRole = (role) =>
    isGlobalSuperAdmin(role)
        ? LOGIN_DESTINATION.GLOBAL_CONSOLE
        : LOGIN_DESTINATION.COMPANY_ERP;

/**
 * Map legacy signup roles to canonical V1 names when creating new accounts.
 * Does not rewrite existing DB rows (migration job handles that).
 */
const normalizeSignupRole = (role) => {
    const r = normalizeRole(role);
    if (r === ROLES.ADMIN) return ROLES.COMPANY_SUPER_ADMIN;
    if (r === ROLES.BRANCH_MANAGER) return ROLES.EMPLOYEE;
    return r;
};

module.exports = {
    normalizeRole,
    isGlobalSuperAdmin,
    isCompanyOwner,
    isCompanyEmployee,
    isVendor,
    isSupplierLogin,
    hasAdminPower,
    hasManagerPower,
    loginDestinationForRole,
    normalizeSignupRole,
};
