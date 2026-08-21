/**
 * Ensure tenant.plugin is on the exported model schema (not nested schemas).
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "model");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));

let fixed = 0;

for (const f of files) {
    const p = path.join(dir, f);
    let s = fs.readFileSync(p, "utf8");
    if (!s.includes("tenantPlugin") && !s.includes("tenant.plugin")) {
        // still may need plugin if we add require later — skip clean files without intent
    }

    // Detect exported schema var from mongoose.model("Name", schemaVar)
    const modelMatch = s.match(
        /module\.exports\s*=\s*mongoose\.model\(\s*["'][^"']+["']\s*,\s*(\w+)\s*\)/
    ) || s.match(
        /module\.exports\s*=\s*mongoose\.model\(\s*["'][^"']+["']\s*,\s*(\w+)\s*\)/s
    ) || s.match(
        /mongoose\.model\(\s*["'][^"']+["']\s*,\s*(\w+)\s*\)/s
    );

    if (!modelMatch) {
        if (s.includes("tenantPlugin") || s.includes("tenant.plugin")) {
            console.log("NO MODEL MATCH", f);
        }
        continue;
    }

    const main = modelMatch[1];
    const needsTenant =
        s.includes("tenantPlugin") ||
        s.includes("tenant.plugin") ||
        // files we intended to patch earlier
        true;

    // Only process files that already reference tenant or previously should
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
    const base = f.replace(/\.js$/, "");
    if (!intended.includes(base) && !s.includes("tenantPlugin")) continue;

    // Strip all plugin lines
    s = s.replace(/^\s*\w+\.plugin\(tenantPlugin\);\s*\r?\n?/gm, "");

    if (!s.includes('require("./plugins/tenant.plugin")')) {
        if (/const mongoose = require\(["']mongoose["']\);/.test(s)) {
            s = s.replace(
                /const mongoose = require\(["']mongoose["']\);/,
                (m) =>
                    `${m}\nconst tenantPlugin = require("./plugins/tenant.plugin");`
            );
        } else {
            console.log("NO MONGOOSE REQUIRE", f);
            continue;
        }
    }

    if (!s.includes(`${main}.plugin(tenantPlugin)`)) {
        // Prefer insert right before module.exports
        if (/\nmodule\.exports\s*=\s*mongoose\.model/.test(s)) {
            s = s.replace(
                /\n(module\.exports\s*=\s*mongoose\.model)/,
                `\n${main}.plugin(tenantPlugin);\n\n$1`
            );
        } else {
            s += `\n${main}.plugin(tenantPlugin);\n`;
        }
    }

    fs.writeFileSync(p, s);
    fixed += 1;
    console.log("fixed", f, "->", main);
}

console.log("DONE", fixed);

// Verify
let bad = 0;
for (const f of files) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    const base = f.replace(/\.js$/, "");
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
    if (!intended.includes(base)) continue;
    const plugins = [...s.matchAll(/(\w+)\.plugin\(tenantPlugin\)/g)].map((m) => m[1]);
    const mm = s.match(/mongoose\.model\(\s*["']([^"']+)["']\s*,\s*(\w+)/s);
    if (!mm || plugins.length !== 1 || plugins[0] !== mm[2]) {
        console.log("VERIFY BAD", f, "plugins=", plugins, "export=", mm && mm[2]);
        bad += 1;
    }
}
console.log(bad ? "VERIFY FAIL " + bad : "VERIFY ALL OK");
