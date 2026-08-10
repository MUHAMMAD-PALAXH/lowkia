/**
 * Security posture smoke — verifies critical modules load and gates exist.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function read(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustInclude(rel, needle, label) {
    const src = read(rel);
    assert.ok(
        src.includes(needle),
        `${label || rel} must include ${needle}`
    );
}

console.log("— Protected money / ops routes");
[
    "routes/salesOrder.js",
    "routes/purchaseOrder.js",
    "routes/grn.js",
    "routes/supplier.js",
    "routes/customer.js",
    "routes/inventory.js",
    "routes/warehouse.js",
    "routes/branch.js",
    "routes/repairTicket.js",
    "routes/productMaster.js",
    "routes/salesReturn.js",
    "routes/customerPayment.js",
    "routes/supplierPayment.js",
].forEach((rel) => mustInclude(rel, "protect", rel));

console.log("— Legacy payment retired");
mustInclude("routes/payment.js", "410", "legacy payment");

console.log("— Self-approval enforcement");
mustInclude(
    "services/supplierPaymentService.js",
    "cannot approve your own payment",
    "supplier SoD"
);
mustInclude(
    "services/employeePaymentService.js",
    "cannot approve your own payment",
    "employee SoD"
);

console.log("— Tenant bind helper");
require("../services/tenantBind");

console.log("— Rate limit + helmet wiring");
mustInclude("index.js", "helmet", "helmet");
mustInclude("middleware/rateLimit.js", "Too many requests", "rateLimit");

console.log("— Unique payment locks present");
mustInclude("model/payment.js", "EmployeeSalary", "salary unique");
mustInclude("model/payment.js", "providerPaymentIntentId", "PI unique");

console.log("\n✅ App payment security posture smoke passed.");
