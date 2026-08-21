const mongoose = require("mongoose");

/**
 * Adds companyId tenant field to a schema (idempotent if already present).
 */
function tenantPlugin(schema) {
    if (schema.path("companyId")) return;

    schema.add({
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },
    });
}

module.exports = tenantPlugin;
