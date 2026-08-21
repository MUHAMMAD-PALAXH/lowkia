/**
 * Canonical SaaS roles (V1).
 * Legacy values remain accepted until migration backfill completes.
 */

const ROLES = {
    GLOBAL_SUPER_ADMIN: "global_super_admin",
    COMPANY_SUPER_ADMIN: "company_super_admin",
    ADMIN: "admin", // legacy alias → treat as company_super_admin
    EMPLOYEE: "employee",
    BRANCH_MANAGER: "branch_manager", // legacy alias → treat as employee
    VENDOR: "vendor",
    SUPPLIER: "supplier", // deprecated auth role; keep for migration only
};

/** Roles allowed on public self-signup (supplier login removed). */
const PUBLIC_SIGNUP_ROLES = [
    ROLES.COMPANY_SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.EMPLOYEE,
    ROLES.BRANCH_MANAGER,
    ROLES.VENDOR,
];

/** All values allowed on AdminUser.role enum (incl. legacy). */
const ADMIN_USER_ROLE_ENUM = [
    ROLES.GLOBAL_SUPER_ADMIN,
    ROLES.COMPANY_SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.EMPLOYEE,
    ROLES.BRANCH_MANAGER,
    ROLES.VENDOR,
    ROLES.SUPPLIER,
];

const LOGIN_DESTINATION = {
    GLOBAL_CONSOLE: "global_console",
    COMPANY_ERP: "company_erp",
};

module.exports = {
    ROLES,
    PUBLIC_SIGNUP_ROLES,
    ADMIN_USER_ROLE_ENUM,
    LOGIN_DESTINATION,
};
