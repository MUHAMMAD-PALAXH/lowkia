const Counter = require("../model/counter");

// =====================================================
// Module → prefix / padding (aligned with cursor_rules)
// =====================================================

const MODULE_CONFIG = {
    branch: { prefix: "BRN", padding: 6 },
    warehouse: { prefix: "WH", padding: 6 },
    department: { prefix: "DEP", padding: 6 },
    designation: { prefix: "DES", padding: 6 },
    employee: { prefix: "EMP", padding: 6 },
    shift: { prefix: "SHF", padding: 6 },
    leave_type: { prefix: "LVT", padding: 6 },
    holiday: { prefix: "HOL", padding: 6 },
    leave: { prefix: "LV", padding: 6 },
    attendance_policy: { prefix: "ATP", padding: 6 },
    attendance: { prefix: "ATT", padding: 6 },
    attendance_correction: { prefix: "ACR", padding: 6 },
    overtime_request: { prefix: "OTR", padding: 6 },

    supplier: { prefix: "SUP", padding: 6 },
    customer: { prefix: "CUS", padding: 6 },

    category: { prefix: "CAT", padding: 6 },
    sub_category: { prefix: "SCAT", padding: 6 },
    brand: { prefix: "BRD", padding: 6 },
    unit: { prefix: "UNT", padding: 6 },
    variant_type: { prefix: "VT", padding: 6 },
    variant: { prefix: "VAR", padding: 6 },
    product: { prefix: "PRD", padding: 6 },
    product_variant: { prefix: "PVAR", padding: 6 },
    asset: { prefix: "AST", padding: 6 },
    barcode: { prefix: "BAR", padding: 6 },

    purchase_order: { prefix: "PO", padding: 6 },
    grn: { prefix: "GRN", padding: 6 },
    purchase_invoice: { prefix: "PINV", padding: 6 },
    purchase_return: { prefix: "PRTN", padding: 6 },

    stock_transfer: { prefix: "ST", padding: 6 },
    stock_adjustment: { prefix: "SA", padding: 6 },
    stock_count: { prefix: "SC", padding: 6 },
    stock_movement: { prefix: "SM", padding: 6 },
    damage_stock: { prefix: "DST", padding: 6 },

    sales_quotation: { prefix: "QT", padding: 6 },
    sales_order: { prefix: "SO", padding: 6 },
    invoice: { prefix: "INV", padding: 6 },
    delivery: { prefix: "DEL", padding: 6 },
    sales_return: { prefix: "SRT", padding: 6 },

    repair_ticket: { prefix: "T", padding: 5 },

    company: { prefix: "CO", padding: 6 },
    company_subscription: { prefix: "SUB", padding: 6 },
    subscription_invoice: { prefix: "SINV", padding: 6 },
    subscription_payment: { prefix: "SPMT", padding: 6 },
    platform_payment_account: { prefix: "PACC", padding: 6 },
    payment: { prefix: "PAY", padding: 6, yearScoped: true },
    supplier_payable: { prefix: "SPAY", padding: 6 },
    payroll_run: { prefix: "PRUN", padding: 6 },
    payroll: { prefix: "PRL", padding: 6 },
    payroll_payable: { prefix: "PPAY", padding: 6 },
    employee_advance: { prefix: "EADV", padding: 6 },
    salary_structure: { prefix: "SSTR", padding: 6 },
    receipt: { prefix: "REC", padding: 6 },
    expense_category: { prefix: "EXCAT", padding: 6 },
    expense: { prefix: "EXP", padding: 6 },
    journal: { prefix: "JRN", padding: 6 },
    ledger: { prefix: "LDG", padding: 6 },

    lead: { prefix: "LEAD", padding: 6 },
    contact: { prefix: "CON", padding: 6 },

    activity_log: { prefix: "ACT", padding: 6 },
    notification: { prefix: "NTF", padding: 6 }
};

const MODULE_ALIASES = {
    purchaseOrder: "purchase_order",
    purchaseInvoice: "purchase_invoice",
    purchaseReturn: "purchase_return",
    subCategory: "sub_category",
    variantType: "variant_type",
    productVariant: "product_variant",
    stockTransfer: "stock_transfer",
    stockAdjustment: "stock_adjustment",
    stockCount: "stock_count",
    damageStock: "damage_stock",
    salesQuotation: "sales_quotation",
    salesOrder: "sales_order",
    salesInvoice: "invoice",
    salesReturn: "sales_return",
    repairTicket: "repair_ticket",
    expenseCategory: "expense_category",
    leaveType: "leave_type",
    activityLog: "activity_log",
    supplierPayable: "supplier_payable",
    payrollRun: "payroll_run",
    payrollPayable: "payroll_payable",
    employeeAdvance: "employee_advance",
    salaryStructure: "salary_structure"
};

// =====================================================
// Helpers
// =====================================================

const pad = (number, length = 6) => String(number).padStart(length, "0");

const resolveModule = (module) => {
    const key = String(module).trim();
    return MODULE_ALIASES[key] || key.toLowerCase();
};

// =====================================================
// Core generator
// Format: SUP-000001
// Year-scoped (payment): PAY-2026-000001
// Optional Mongo session for transactional finance writes.
// =====================================================

const generateCode = async (module, options = {}) => {
    const resolvedBase = resolveModule(module);
    const config = MODULE_CONFIG[resolvedBase];

    if (!config) {
        throw new Error(`Unknown module: ${module}`);
    }

    const year = options.year || new Date().getUTCFullYear();
    const counterModule = config.yearScoped
        ? `${resolvedBase}_${year}`
        : resolvedBase;

    const update = {
        $inc: { lastNumber: 1 },
        $setOnInsert: {
            module: counterModule,
            prefix: config.prefix,
            padding: config.padding
        }
    };

    const queryOptions = {
        new: true,
        upsert: true
    };
    if (options.session) {
        queryOptions.session = options.session;
    }

    const counter = await Counter.findOneAndUpdate(
        { module: counterModule },
        update,
        queryOptions
    );

    const padding = counter.padding ?? config.padding;
    const prefix = counter.prefix ?? config.prefix;
    const number = pad(counter.lastNumber, padding);

    if (config.yearScoped) {
        return `${prefix}-${year}-${number}`;
    }

    return `${prefix}-${number}`;
};

// =====================================================
// Organization
// =====================================================

const generateBranchCode = () => generateCode("branch");
const generateWarehouseCode = () => generateCode("warehouse");
const generateDepartmentCode = () => generateCode("department");
const generateDesignationCode = () => generateCode("designation");
const generateEmployeeCode = () => generateCode("employee");
const generateShiftCode = () => generateCode("shift");
const generateLeaveTypeCode = () => generateCode("leave_type");
const generateHolidayCode = () => generateCode("holiday");
const generateLeaveCode = () => generateCode("leave");
const generateAttendancePolicyCode = () => generateCode("attendance_policy");
const generateAttendanceCode = () => generateCode("attendance");
const generateAttendanceCorrectionCode = () =>
    generateCode("attendance_correction");
const generateOvertimeRequestCode = () => generateCode("overtime_request");
const generateActivityLogCode = () => generateCode("activity_log");

// =====================================================
// Business partners
// =====================================================

const generateSupplierCode = () => generateCode("supplier");
const generateCustomerCode = () => generateCode("customer");

// =====================================================
// Product master
// =====================================================

const generateCategoryCode = () => generateCode("category");
const generateSubCategoryCode = () => generateCode("sub_category");
const generateBrandCode = () => generateCode("brand");
const generateUnitCode = () => generateCode("unit");
const generateVariantTypeCode = () => generateCode("variant_type");
const generateVariantCode = () => generateCode("variant");
const generateProductCode = () => generateCode("product");
const generateProductVariantCode = () => generateCode("product_variant");
const generateBarcodeCode = () => generateCode("barcode");
const generateAssetCode = () => generateCode("asset");

// =====================================================
// Purchase
// =====================================================

const generatePurchaseOrderCode = () => generateCode("purchase_order");
const generateGRNCode = () => generateCode("grn");
const generatePurchaseInvoiceCode = () => generateCode("purchase_invoice");
const generatePurchaseReturnCode = () => generateCode("purchase_return");

// =====================================================
// Inventory
// =====================================================

const generateStockTransferCode = () => generateCode("stock_transfer");
const generateStockAdjustmentCode = () => generateCode("stock_adjustment");
const generateStockCountCode = () => generateCode("stock_count");
const generateStockMovementCode = () => generateCode("stock_movement");
const generateDamageStockCode = () => generateCode("damage_stock");

// =====================================================
// Sales
// =====================================================

const generateSalesQuotationCode = () => generateCode("sales_quotation");
const generateSalesOrderCode = () => generateCode("sales_order");
const generateInvoiceCode = () => generateCode("invoice");
const generateDeliveryCode = () => generateCode("delivery");
const generateSalesReturnCode = () => generateCode("sales_return");
const generateRepairTicketCode = () => generateCode("repair_ticket");

// =====================================================
// Finance
// =====================================================

const generateCompanyCode = () => generateCode("company");
const generatePaymentCode = (options) => generateCode("payment", options);
const generateSupplierPayableCode = (options) =>
    generateCode("supplier_payable", options);
const generatePayrollRunCode = (options) => generateCode("payroll_run", options);
const generatePayrollCode = (options) => generateCode("payroll", options);
const generatePayrollPayableCode = (options) =>
    generateCode("payroll_payable", options);
const generateEmployeeAdvanceCode = (options) =>
    generateCode("employee_advance", options);
const generateSalaryStructureCode = (options) =>
    generateCode("salary_structure", options);
const generateReceiptCode = () => generateCode("receipt");
const generateExpenseCategoryCode = () => generateCode("expense_category");
const generateExpenseCode = () => generateCode("expense");
const generateJournalCode = () => generateCode("journal");
const generateLedgerCode = () => generateCode("ledger");

// =====================================================
// CRM
// =====================================================

const generateLeadCode = () => generateCode("lead");
const generateContactCode = () => generateCode("contact");

// =====================================================
// Export
// =====================================================

module.exports = {
    generateCode,

    generateBranchCode,
    generateWarehouseCode,
    generateDepartmentCode,
    generateDesignationCode,
    generateEmployeeCode,
    generateShiftCode,
    generateLeaveTypeCode,
    generateHolidayCode,
    generateLeaveCode,
    generateAttendancePolicyCode,
    generateAttendanceCode,
    generateAttendanceCorrectionCode,
    generateOvertimeRequestCode,
    generateActivityLogCode,

    generateSupplierCode,
    generateCustomerCode,

    generateCategoryCode,
    generateSubCategoryCode,
    generateBrandCode,
    generateUnitCode,
    generateVariantTypeCode,
    generateVariantCode,
    generateProductCode,
    generateProductVariantCode,
    generateBarcodeCode,
    generateAssetCode,

    generatePurchaseOrderCode,
    generateGRNCode,
    generatePurchaseInvoiceCode,
    generatePurchaseReturnCode,

    generateStockTransferCode,
    generateStockAdjustmentCode,
    generateStockCountCode,
    generateStockMovementCode,
    generateDamageStockCode,

    generateSalesQuotationCode,
    generateSalesOrderCode,
    generateInvoiceCode,
    generateDeliveryCode,
    generateSalesReturnCode,
    generateRepairTicketCode,

    generateCompanyCode,
    generatePaymentCode,
    generateSupplierPayableCode,
    generatePayrollRunCode,
    generatePayrollCode,
    generatePayrollPayableCode,
    generateEmployeeAdvanceCode,
    generateSalaryStructureCode,
    generateReceiptCode,
    generateExpenseCategoryCode,
    generateExpenseCode,
    generateJournalCode,
    generateLedgerCode,

    generateLeadCode,
    generateContactCode
};
