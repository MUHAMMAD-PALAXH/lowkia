const { param, query } = require("express-validator");
const { PAYMENT_STATUSES, PAYMENT_PURPOSES } = require("../config/finance");

const idValidator = [
    param("id").isMongoId().withMessage("Invalid id."),
];

const payrollIdValidator = [
    param("payrollId").isMongoId().withMessage("Invalid payroll id."),
];

const runIdValidator = [
    param("runId").isMongoId().withMessage("Invalid payroll run id."),
];

const commonFilters = [
    query("branchId").optional().isMongoId(),
    query("limit").optional().isInt({ min: 1, max: 500 }),
    query("year").optional().isInt({ min: 2000, max: 2100 }),
    query("month").optional().isInt({ min: 1, max: 12 }),
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
];

const payablesValidator = [
    ...commonFilters,
    query("status").optional().isString(),
    query("supplierId").optional().isMongoId(),
];

const supplierPaymentsValidator = [
    ...commonFilters,
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("purpose").optional().isIn(PAYMENT_PURPOSES),
    query("supplierId").optional().isMongoId(),
];

const payrollRunsValidator = [
    ...commonFilters,
    query("status").optional().isString(),
];

const advancesValidator = [
    ...commonFilters,
    query("status").optional().isString(),
    query("employeeId").optional().isMongoId(),
];

const employeePaymentsValidator = [
    ...commonFilters,
    query("status").optional().isIn(PAYMENT_STATUSES),
    query("paymentType")
        .optional()
        .isIn([
            "EmployeeSalary",
            "EmployeeAdvance",
            "EmployeeBonus",
            "EmployeeOther",
        ]),
    query("employeeId").optional().isMongoId(),
];

module.exports = {
    idValidator,
    payrollIdValidator,
    runIdValidator,
    commonFilters,
    payablesValidator,
    supplierPaymentsValidator,
    payrollRunsValidator,
    advancesValidator,
    employeePaymentsValidator,
};
