const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "model");
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    if (!s.includes("tenantPlugin")) continue;
    const plugins = [...s.matchAll(/(\w+)\.plugin\(tenantPlugin\)/g)].map(
        (m) => m[1]
    );
    const mm =
        s.match(
            /mongoose\.model\(\s*["']([^"']+)["']\s*,\s*(\w+)/
        ) ||
        s.match(
            /mongoose\.model\(\s*["']([^"']+)["']\s*,\s*\r?\n\s*(\w+)/
        );
    if (!mm) {
        console.log("NOEXPORT", f, plugins);
        bad += 1;
        continue;
    }
    const main = mm[2];
    if (plugins.length !== 1 || plugins[0] !== main) {
        console.log("BAD", f, "plugins", plugins, "main", main);
        bad += 1;
    }
}
console.log(bad ? "FAIL " + bad : "ALL OK");
