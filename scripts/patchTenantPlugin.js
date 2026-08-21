/**
 * One-shot: attach tenant.plugin to model schemas missing companyId.
 * Run: node scripts/patchTenantPlugin.js
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "model");
const skip = new Set([
    "company.js",
    "adminUser.js",
    "activityLog.js",
    "customer.js",
    "employee.js",
    "employeeAdvance.js",
    "notification.js",
    "notificationCenterEvent.js",
    "payment.js",
    "payroll.js",
    "payrollRun.js",
    "purchaseOrder.js",
    "repairTicket.js",
    "salaryStructure.js",
    "salesOrder.js",
    "supplier.js",
    "supplierPayable.js",
    "user.js",
    "order.js",
    "Role.js",
    "Permission.js",
    "rolePermission.js",
    "counter.js",
]);

const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !skip.has(f));

const patched = [];
const skipped = [];

for (const f of files) {
    const p = path.join(dir, f);
    let s = fs.readFileSync(p, "utf8");

    if (s.includes("tenant.plugin") || /\bcompanyId\s*:/.test(s)) {
        skipped.push(`${f} (already)`);
        continue;
    }
    if (!s.includes("mongoose.model")) {
        skipped.push(`${f} (no model)`);
        continue;
    }

    const schemaMatch = s.match(/const\s+(\w+)\s*=\s*new\s+mongoose\.Schema/);
    if (!schemaMatch) {
        skipped.push(`${f} (no schema const)`);
        continue;
    }
    const varName = schemaMatch[1];

    if (!s.includes("tenant.plugin")) {
        s = s.replace(
            /const mongoose = require\(["']mongoose["']\);/,
            (m) =>
                `${m}\nconst tenantPlugin = require("./plugins/tenant.plugin");`
        );
    }

    if (!s.includes(`${varName}.plugin(tenantPlugin)`)) {
        s = s.replace(
            /\n(module\.exports\s*=\s*mongoose\.model)/,
            `\n${varName}.plugin(tenantPlugin);\n\n$1`
        );
    }

    if (!s.includes("tenantPlugin")) {
        skipped.push(`${f} (patch failed)`);
        continue;
    }

    fs.writeFileSync(p, s);
    patched.push(`${f} -> ${varName}`);
}

console.log("PATCHED", patched.length);
patched.forEach((x) => console.log(" +", x));
console.log("SKIPPED", skipped.length);
skipped.forEach((x) => console.log(" -", x));
