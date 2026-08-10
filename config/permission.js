const PERMISSIONS = {

    // ======================================================
    // Branch
    // ======================================================

    BRANCH_VIEW: "branch.view",
    BRANCH_CREATE: "branch.create",
    BRANCH_UPDATE: "branch.update",
    BRANCH_DELETE: "branch.delete",

    // ======================================================
    // Warehouse
    // ======================================================

    WAREHOUSE_VIEW: "warehouse.view",
    WAREHOUSE_CREATE: "warehouse.create",
    WAREHOUSE_UPDATE: "warehouse.update",
    WAREHOUSE_DELETE: "warehouse.delete",

    // ======================================================
    // Supplier
    // ======================================================

    SUPPLIER_VIEW: "supplier.view",
    SUPPLIER_CREATE: "supplier.create",
    SUPPLIER_UPDATE: "supplier.update",
    SUPPLIER_DELETE: "supplier.delete",

    // ======================================================
    // Purchase
    // ======================================================

    PURCHASE_VIEW: "purchase.view",
    PURCHASE_CREATE: "purchase.create",
    PURCHASE_UPDATE: "purchase.update",
    PURCHASE_DELETE: "purchase.delete",
    PURCHASE_APPROVE: "purchase.approve",
    PURCHASE_CANCEL: "purchase.cancel",

    // ======================================================
    // GRN
    // ======================================================

    GRN_VIEW: "grn.view",
    GRN_CREATE: "grn.create",
    GRN_UPDATE: "grn.update",
    GRN_APPROVE: "grn.approve",

    // ======================================================
    // Inventory
    // ======================================================

    INVENTORY_VIEW: "inventory.view",
    INVENTORY_UPDATE: "inventory.update",
    INVENTORY_ADJUST: "inventory.adjust",

    // ======================================================
    // Stock Transfer
    // ======================================================

    STOCK_TRANSFER_VIEW: "stockTransfer.view",
    STOCK_TRANSFER_CREATE: "stockTransfer.create",
    STOCK_TRANSFER_APPROVE: "stockTransfer.approve",

    // ======================================================
    // Product
    // ======================================================

    PRODUCT_VIEW: "product.view",
    PRODUCT_CREATE: "product.create",
    PRODUCT_UPDATE: "product.update",
    PRODUCT_DELETE: "product.delete",

    // ======================================================
    // Customer
    // ======================================================

    CUSTOMER_VIEW: "customer.view",
    CUSTOMER_CREATE: "customer.create",
    CUSTOMER_UPDATE: "customer.update",

    // ======================================================
    // Sales
    // ======================================================

    SALES_VIEW: "sales.view",
    SALES_CREATE: "sales.create",
    SALES_UPDATE: "sales.update",
    SALES_DELETE: "sales.delete",
    SALES_APPROVE: "sales.approve",

    // ======================================================
    // Invoice
    // ======================================================

    INVOICE_VIEW: "invoice.view",
    INVOICE_CREATE: "invoice.create",
    INVOICE_UPDATE: "invoice.update",

    // ======================================================
    // Payment / Finance
    // ======================================================

    PAYMENT_VIEW: "payment.view",
    PAYMENT_CREATE: "payment.create",
    PAYMENT_APPROVE: "payment.approve",
    PAYMENT_COMPLETE: "payment.complete",
    PAYMENT_REVERSE: "payment.reverse",

    SUPPLIER_PAYABLE_VIEW: "supplierPayable.view",
    SUPPLIER_PAYMENT_CREATE: "supplierPayment.create",
    SUPPLIER_PAYMENT_APPROVE: "supplierPayment.approve",

    // ======================================================
    // Payroll
    // ======================================================

    PAYROLL_VIEW: "payroll.view",
    PAYROLL_CREATE: "payroll.create",
    PAYROLL_CALCULATE: "payroll.calculate",
    PAYROLL_APPROVE: "payroll.approve",
    PAYROLL_ADJUST: "payroll.adjust",

    EMPLOYEE_PAYMENT_VIEW: "employeePayment.view",
    EMPLOYEE_PAYMENT_CREATE: "employeePayment.create",
    EMPLOYEE_PAYMENT_APPROVE: "employeePayment.approve",
    EMPLOYEE_ADVANCE_REQUEST: "employeeAdvance.request",
    EMPLOYEE_ADVANCE_APPROVE: "employeeAdvance.approve",
    EMPLOYEE_ADVANCE_VIEW: "employeeAdvance.view",
    EMPLOYEE_ADVANCE_DISBURSE: "employeeAdvance.disburse",
    EMPLOYEE_ADVANCE_REVERSE: "employeeAdvance.reverse",
    EMPLOYEE_ADVANCE_RECOVER: "employeeAdvance.recover",

    // ======================================================
    // Expense
    // ======================================================

    EXPENSE_VIEW: "expense.view",
    EXPENSE_CREATE: "expense.create",
    EXPENSE_APPROVE: "expense.approve",

    // ======================================================
    // Reports
    // ======================================================

    REPORT_VIEW: "report.view",

    // ======================================================
    // Dashboard
    // ======================================================

    DASHBOARD_VIEW: "dashboard.view",

    // ======================================================
    // HR / Attendance
    // ======================================================

    EMPLOYEE_VIEW: "employee.view",
    EMPLOYEE_CREATE: "employee.create",
    EMPLOYEE_UPDATE: "employee.update",
    EMPLOYEE_DELETE: "employee.delete",

    SHIFT_VIEW: "shift.view",
    SHIFT_CREATE: "shift.create",
    SHIFT_UPDATE: "shift.update",
    SHIFT_DELETE: "shift.delete",

    ATTENDANCE_POLICY_VIEW: "attendancePolicy.view",
    ATTENDANCE_POLICY_CREATE: "attendancePolicy.create",
    ATTENDANCE_POLICY_UPDATE: "attendancePolicy.update",
    ATTENDANCE_POLICY_DELETE: "attendancePolicy.delete",

    ATTENDANCE_VIEW: "attendance.view",
    ATTENDANCE_MANAGE: "attendance.manage",
    ATTENDANCE_APPROVE: "attendance.approve",
    ATTENDANCE_REPORT: "attendance.report",
    ATTENDANCE_CORRECTION_VIEW: "attendanceCorrection.view",
    ATTENDANCE_CORRECTION_APPROVE: "attendanceCorrection.approve",
    OVERTIME_VIEW: "overtime.view",
    OVERTIME_APPROVE: "overtime.approve",

    HOLIDAY_VIEW: "holiday.view",
    HOLIDAY_MANAGE: "holiday.manage",

    LEAVE_VIEW: "leave.view",
    LEAVE_CREATE: "leave.create",
    LEAVE_APPROVE: "leave.approve"

};

module.exports = PERMISSIONS;