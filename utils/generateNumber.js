const { generateCode } = require("../services/codeGenerator");

/**
 * Thin wrapper — accepts a module name (e.g. "supplier", "purchase_order")
 * and returns a global business ID (e.g. SUP-000001).
 */
async function generateNumber(module) {
    return generateCode(module);
}

module.exports = generateNumber;
