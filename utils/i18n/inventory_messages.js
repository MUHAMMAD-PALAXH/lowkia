/**
 * Inventory static English API response messages (no ${}).
 * Run: node utils/i18n/inventory_messages.js
 */
const fs = require("fs");
const path = require("path");

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git", "uploads", "public"].includes(e.name)) continue;
      walk(p, acc);
    } else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

const root = path.join(__dirname, "..", "..");
const files = walk(root);
const msgs = new Set();
const patterns = [
  /(?:success|error)\(\s*res\s*,\s*['"]([^'"]{3,200})['"]/g,
  /message:\s*['"]([^'"]{3,200})['"]/g,
  /new AppError\(\s*['"]([^'"]{3,200})['"]/g,
];

for (const f of files) {
  if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
  const s = fs.readFileSync(f, "utf8");
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const t = m[1].trim();
      if (!t || t.includes("${") || t.startsWith("http")) continue;
      msgs.add(t);
    }
  }
}

const list = [...msgs].sort();
const out = path.join(__dirname, "message_inventory.json");
fs.writeFileSync(out, JSON.stringify(list, null, 2) + "\n");
console.log("static_msgs", list.length, "->", out);
