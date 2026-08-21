/**
 * Ensure tenantPlugin is applied BEFORE mongoose.model() compiles the schema.
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "model");
const intended = [
    "account", "adminNotification", "advanceSalary", "attendance",
    "attendanceCorrection", "attendancePolicy", "branch", "branchTransfer",
    "brand", "category", "couponCode", "delivery", "department", "designation",
    "employeeLoan", "expense", "grn", "holiday", "inventory", "itemTrack",
    "journal", "leave", "ledger", "overtimeRequest", "payslip", "poster",
    "product", "productVariant", "purchaseInvoice", "purchaseReturn",
    "review", "salesInvoice", "salesQuotation", "salesReturn", "settings",
    "shift", "stockAdjustment", "stockLedger", "StockMovement", "stockTransfer",
    "subCategory", "unit", "variant", "variantType", "warehouse",
];

for (const base of intended) {
    const f = base + ".js";
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
        console.log("MISSING FILE", f);
        continue;
    }
    let s = fs.readFileSync(p, "utf8");

    // Find schema var from first mongoose.model call's 2nd arg
    const mm = s.match(/mongoose\.model\(\s*["'][^"']+["']\s*,\s*(\w+)/s);
    if (!mm) {
        console.log("NO MODEL", f);
        continue;
    }
    const main = mm[1];

    // Remove all plugin lines
    s = s.replace(/^\s*\w+\.plugin\(tenantPlugin\);\s*\r?\n?/gm, "");

    // Ensure require
    if (!s.includes('require("./plugins/tenant.plugin")')) {
        s = s.replace(
            /const mongoose = require\(["']mongoose["']\);/,
            (m) =>
                `${m}\nconst tenantPlugin = require("./plugins/tenant.plugin");`
        );
    }

    // Insert plugin immediately before the first mongoose.model( that uses this schema
    // Match patterns: module.exports = mongoose.model(  OR  const X = mongoose.model(
    const beforeModel = new RegExp(
        `(\\n)((?:module\\.exports\\s*=\\s*)?(?:const\\s+\\w+\\s*=\\s*)?mongoose\\.model\\(\\s*["'][^"']+["']\\s*,\\s*${main})`,
        "s"
    );

    if (!beforeModel.test(s)) {
        // try looser: any mongoose.model before which we insert
        const idx = s.search(/mongoose\.model\s*\(/);
        if (idx < 0) {
            console.log("NO INSERT POINT", f);
            continue;
        }
        s =
            s.slice(0, idx) +
            `${main}.plugin(tenantPlugin);\n\n` +
            s.slice(idx);
    } else {
        s = s.replace(beforeModel, `$1${main}.plugin(tenantPlugin);\n\n$2`);
    }

    // Verify plugin appears before model compile
    const pluginIdx = s.indexOf(`${main}.plugin(tenantPlugin)`);
    const modelIdx = s.search(/mongoose\.model\s*\(/);
    if (pluginIdx < 0 || pluginIdx > modelIdx) {
        console.log("ORDER FAIL", f, { pluginIdx, modelIdx });
    } else {
        console.log("OK", f, "->", main);
    }

    fs.writeFileSync(p, s);
}

console.log("DONE");
