const Counter = require("../model/counter");
const Company = require("../model/company");

// =====================================================
// Helper
// =====================================================

const pad = (number, length = 6) => {
    return String(number).padStart(length, "0");
};

// =====================================================
// Company Code
// CMP001
// =====================================================

const generateCompanyCode = async () => {

    const totalCompany = await Company.countDocuments();

    const next = totalCompany + 1;

    return `CMP${String(next).padStart(3, "0")}`;

};

// =====================================================
// Generic Counter
// =====================================================

const getNextCounter = async (companyId, field) => {

    const counter = await Counter.findOneAndUpdate(
        { companyId },
        {
            $inc: {
                [field]: 1
            }
        },
        {
            new: true
        }
    );

    if (!counter) {
        throw new Error("Counter not found.");
    }

    return counter;

};

// =====================================================
// Generic Generator
// =====================================================

const generateCode = async (
    companyId,
    field,
    prefix
) => {

    const counter = await getNextCounter(
        companyId,
        field
    );

    return `${counter.companyCode}-${prefix}${pad(counter[field])}`;

};

// =====================================================
// Organization
// =====================================================

const generateBranchCode = (companyId) =>
    generateCode(companyId, "branch", "BR");

const generateWarehouseCode = (companyId) =>
    generateCode(companyId, "warehouse", "WH");

const generateDepartmentCode = (companyId) =>
    generateCode(companyId, "department", "DEP");

const generateDesignationCode = (companyId) =>
    generateCode(companyId, "designation", "DES");

const generateEmployeeCode = (companyId) =>
    generateCode(companyId, "employee", "EMP");

const generateShiftCode = (companyId) =>
    generateCode(companyId, "shift", "SHF");

const generateLeaveTypeCode = (companyId) =>
    generateCode(companyId, "leaveType", "LVT");

const generateHolidayCode = (companyId) =>
    generateCode(companyId, "holiday", "HOL");

// =====================================================
// Business Partner
// =====================================================

const generateSupplierCode = (companyId) =>
    generateCode(companyId, "supplier", "SUP");

const generateCustomerCode = (companyId) =>
    generateCode(companyId, "customer", "CUS");

// =====================================================
// Product
// =====================================================

const generateProductCode = (companyId) =>
    generateCode(companyId, "product", "PRD");

const generateBarcodeCode = (companyId) =>
    generateCode(companyId, "barcode", "BAR");

const generateAssetCode = (companyId) =>
    generateCode(companyId, "asset", "AST");

// =====================================================
// Purchase
// =====================================================

const generatePurchaseOrderCode = (companyId) =>
    generateCode(companyId, "purchaseOrder", "PO");

const generateGRNCode = (companyId) =>
    generateCode(companyId, "grn", "GRN");

const generatePurchaseInvoiceCode = (companyId) =>
    generateCode(companyId, "purchaseInvoice", "PINV");

const generatePurchaseReturnCode = (companyId) =>
    generateCode(companyId, "purchaseReturn", "PRTN");

// =====================================================
// Inventory
// =====================================================

const generateStockTransferCode = (companyId) =>
    generateCode(companyId, "stockTransfer", "ST");

const generateStockAdjustmentCode = (companyId) =>
    generateCode(companyId, "stockAdjustment", "SA");

const generateStockCountCode = (companyId) =>
    generateCode(companyId, "stockCount", "SC");

const generateDamageStockCode = (companyId) =>
    generateCode(companyId, "damageStock", "DST");

// =====================================================
// Sales
// =====================================================

const generateSalesQuotationCode = (companyId) =>
    generateCode(companyId, "salesQuotation", "QT");

const generateSalesOrderCode = (companyId) =>
    generateCode(companyId, "salesOrder", "SO");

const generateInvoiceCode = (companyId) =>
    generateCode(companyId, "salesInvoice", "INV");

const generateDeliveryCode = (companyId) =>
    generateCode(companyId, "delivery", "DEL");

const generateSalesReturnCode = (companyId) =>
    generateCode(companyId, "salesReturn", "SRT");

// =====================================================
// Finance
// =====================================================

const generatePaymentCode = (companyId) =>
    generateCode(companyId, "payment", "PAY");

const generateReceiptCode = (companyId) =>
    generateCode(companyId, "receipt", "REC");

const generateExpenseCategoryCode = (companyId) =>
    generateCode(companyId, "expenseCategory", "EXCAT");

const generateExpenseCode = (companyId) =>
    generateCode(companyId, "expense", "EXP");

const generateJournalCode = (companyId) =>
    generateCode(companyId, "journal", "JRN");

const generateLedgerCode = (companyId) =>
    generateCode(companyId, "ledger", "LDG");

// =====================================================
// CRM
// =====================================================

const generateLeadCode = (companyId) =>
    generateCode(companyId, "lead", "LEAD");

const generateContactCode = (companyId) =>
    generateCode(companyId, "contact", "CON");

// =====================================================
// Export
// =====================================================

module.exports = {

    generateCompanyCode,

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

    generateProductCode,
    generateBarcodeCode,
    generateAssetCode,

    generatePurchaseOrderCode,
    generateGRNCode,
    generatePurchaseInvoiceCode,
    generatePurchaseReturnCode,

    generateStockTransferCode,
    generateStockAdjustmentCode,
    generateStockCountCode,
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