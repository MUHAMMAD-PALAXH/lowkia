/**
 * Minimal zero-dep test runner.
 * Usage: node tests/run.js
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const suites = [];

function collect(dir) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) collect(full);
        else if (name.endsWith(".test.js")) suites.push(full);
    }
}

collect(root);

let passed = 0;
let failed = 0;
const failures = [];

async function runFile(file) {
    const rel = path.relative(process.cwd(), file);
    const mod = require(file);
    const tests = typeof mod === "function" ? [{ name: "default", fn: mod }] : [];
    if (mod && typeof mod === "object") {
        for (const [name, fn] of Object.entries(mod)) {
            if (typeof fn === "function" && name !== "skip") {
                tests.push({ name, fn });
            }
        }
    }

    for (const t of tests) {
        const label = `${rel} :: ${t.name}`;
        try {
            await t.fn();
            passed += 1;
            console.log(`  ✓ ${label}`);
        } catch (err) {
            failed += 1;
            failures.push({ label, err });
            console.log(`  ✗ ${label}`);
            console.log(`    ${err.message || err}`);
        }
    }
}

(async () => {
    console.log(`Running ${suites.length} suite file(s)\n`);
    for (const file of suites) {
        delete require.cache[require.resolve(file)];
        await runFile(file);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) {
        console.log("\nFailures:");
        for (const f of failures) {
            console.log(`- ${f.label}: ${f.err.stack || f.err.message}`);
        }
        process.exit(1);
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
