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

    payment: { prefix: "PAY", padding: 6 },
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
    expenseCategory: "expense_category",
    leaveType: "leave_type",
    activityLog: "activity_log"
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
// Core generator — global IDs, no companyId
// Format: SUP-000001
// =====================================================

const generateCode = async (module) => {
    const resolvedModule = resolveModule(module);
    const config = MODULE_CONFIG[resolvedModule];

    if (!config) {
        throw new Error(`Unknown module: ${module}`);
    }

    const counter = await Counter.findOneAndUpdate(
        { module: resolvedModule },
        {
            $inc: { lastNumber: 1 },
            $setOnInsert: {
                module: resolvedModule,
                prefix: config.prefix,
                padding: config.padding
            }
        },
        {
            new: true,
            upsert: true
        }
    );

    const padding = counter.padding ?? config.padding;
    const prefix = counter.prefix ?? config.prefix;

    return `${prefix}-${pad(counter.lastNumber, padding)}`;
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

// =====================================================
// Finance
// =====================================================

const generatePaymentCode = () => generateCode("payment");
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

    generatePaymentCode,
    generateReceiptCode,
    generateExpenseCategoryCode,
    generateExpenseCode,
    generateJournalCode,
    generateLedgerCode,

    generateLeadCode,
    generateContactCode
};
