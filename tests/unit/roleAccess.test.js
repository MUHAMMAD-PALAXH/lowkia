const assert = require("assert");
const {
    isGlobalSuperAdmin,
    isCompanyOwner,
    isCompanyEmployee,
    isVendor,
    isSupplierLogin,
    hasAdminPower,
    hasManagerPower,
    loginDestinationForRole,
    normalizeSignupRole,
} = require("../../utils/roleAccess");
const { ROLES, LOGIN_DESTINATION, PUBLIC_SIGNUP_ROLES } = require("../../constants/roles");

exports.global_super_admin_detection = () => {
    assert.strictEqual(isGlobalSuperAdmin(ROLES.GLOBAL_SUPER_ADMIN), true);
    assert.strictEqual(isGlobalSuperAdmin("admin"), false);
    assert.strictEqual(isGlobalSuperAdmin("GLOBAL_SUPER_ADMIN"), true);
};

exports.company_owner_includes_legacy_admin = () => {
    assert.strictEqual(isCompanyOwner(ROLES.COMPANY_SUPER_ADMIN), true);
    assert.strictEqual(isCompanyOwner(ROLES.ADMIN), true);
    assert.strictEqual(isCompanyOwner(ROLES.EMPLOYEE), false);
};

exports.employee_includes_legacy_branch_manager = () => {
    assert.strictEqual(isCompanyEmployee(ROLES.EMPLOYEE), true);
    assert.strictEqual(isCompanyEmployee(ROLES.BRANCH_MANAGER), true);
    assert.strictEqual(isCompanyEmployee(ROLES.VENDOR), false);
};

exports.power_helpers = () => {
    assert.strictEqual(hasAdminPower(ROLES.GLOBAL_SUPER_ADMIN), true);
    assert.strictEqual(hasAdminPower(ROLES.COMPANY_SUPER_ADMIN), true);
    assert.strictEqual(hasAdminPower(ROLES.EMPLOYEE), false);
    assert.strictEqual(hasManagerPower(ROLES.EMPLOYEE), true);
    assert.strictEqual(hasManagerPower(ROLES.VENDOR), false);
    assert.strictEqual(isVendor(ROLES.VENDOR), true);
    assert.strictEqual(isSupplierLogin(ROLES.SUPPLIER), true);
};

exports.login_destination = () => {
    assert.strictEqual(
        loginDestinationForRole(ROLES.GLOBAL_SUPER_ADMIN),
        LOGIN_DESTINATION.GLOBAL_CONSOLE
    );
    assert.strictEqual(
        loginDestinationForRole(ROLES.COMPANY_SUPER_ADMIN),
        LOGIN_DESTINATION.COMPANY_ERP
    );
};

exports.signup_role_normalization = () => {
    assert.strictEqual(
        normalizeSignupRole("admin"),
        ROLES.COMPANY_SUPER_ADMIN
    );
    assert.strictEqual(normalizeSignupRole("branch_manager"), ROLES.EMPLOYEE);
    assert.strictEqual(normalizeSignupRole("vendor"), ROLES.VENDOR);
};

exports.public_signup_excludes_supplier = () => {
    assert.ok(!PUBLIC_SIGNUP_ROLES.includes(ROLES.SUPPLIER));
    assert.ok(PUBLIC_SIGNUP_ROLES.includes(ROLES.COMPANY_SUPER_ADMIN));
    assert.ok(PUBLIC_SIGNUP_ROLES.includes(ROLES.VENDOR));
};
