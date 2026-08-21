/**
 * Attach tenant.plugin BEFORE the mongoose.model() statement (not mid-assignment).
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "model");
const files = [
    "StockMovement.js",
    "account.js",
    "adminNotification.js",
    "advanceSalary.js",
    "attendance.js",
    "attendanceCorrection.js",
    "attendancePolicy.js",
    "branch.js",
    "branchTransfer.js",
    "brand.js",
    "category.js",
    "couponCode.js",
    "delivery.js",
    "department.js",
    "designation.js",
    "employeeLoan.js",
    "expense.js",
    "grn.js",
    "holiday.js",
    "inventory.js",
    "itemTrack.js",
    "journal.js",
    "leave.js",
    "ledger.js",
    "overtimeRequest.js",
    "payslip.js",
    "poster.js",
    "product.js",
    "productVariant.js",
    "purchaseInvoice.js",
    "purchaseReturn.js",
    "review.js",
    "salesInvoice.js",
    "salesQuotation.js",
    "salesReturn.js",
    "settings.js",
    "shift.js",
    "stockAdjustment.js",
    "stockLedger.js",
    "stockTransfer.js",
    "subCategory.js",
    "unit.js",
    "variant.js",
    "variantType.js",
    "warehouse.js",
];

let ok = 0;
let fail = 0;

for (const f of files) {
    const p = path.join(dir, f);
    let s = fs.readFileSync(p, "utf8");

    // Strip prior bad patches if any
    s = s.replace(/^\s*\w+\.plugin\(tenantPlugin\);\s*\r?\n?/gm, "");
    s = s.replace(
        /\r?\nconst tenantPlugin = require\(["']\.\/plugins\/tenant\.plugin["']\);\r?\n?/g,
        "\n"
    );

    const stmtRe =
        /(?:module\.exports\s*=\s*|const\s+\w+\s*=\s*)mongoose\.model\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/gs;

    let last = null;
    let m;
    while ((m = stmtRe.exec(s)) !== null) last = m;
    if (!last) {
        console.log("FAIL no model stmt", f);
        fail += 1;
        continue;
    }

    const modelName = last[1];
    const schemaVar = last[2];
    const stmtStart = last.index;

    if (!/const mongoose = require\(['"]mongoose['"]\);/.test(s)) {
        console.log("FAIL no mongoose require", f);
        fail += 1;
        continue;
    }

    s = s.replace(
        /const mongoose = require\(['"]mongoose['"]\);/,
        (line) =>
            `${line}\nconst tenantPlugin = require("./plugins/tenant.plugin");`
    );

    // Re-find after require insert
    const stmtRe2 =
        /(?:module\.exports\s*=\s*|const\s+\w+\s*=\s*)mongoose\.model\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/gs;
    let last2 = null;
    let m2;
    while ((m2 = stmtRe2.exec(s)) !== null) last2 = m2;
    const idx = last2.index;
    const schemaVar2 = last2[2];

    s =
        s.slice(0, idx) +
        `${schemaVar2}.plugin(tenantPlugin);\n\n` +
        s.slice(idx);

    if (/module\.exports\s*=\s*\w+\.plugin\(tenantPlugin\)/.test(s)) {
        console.log("FAIL still corrupted", f);
        fail += 1;
        continue;
    }

    const pluginPos = s.indexOf(`${schemaVar2}.plugin(tenantPlugin)`);
    const modelPos = s.lastIndexOf("mongoose.model(");
    if (pluginPos < 0 || pluginPos > modelPos) {
        console.log("FAIL order", f);
        fail += 1;
        continue;
    }

    fs.writeFileSync(p, s);
    console.log("OK", f, "->", modelName, schemaVar2);
    ok += 1;
}

console.log(`DONE ok=${ok} fail=${fail}`);
