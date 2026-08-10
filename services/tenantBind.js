const AppError = require("../utils/appError");
const { assertDocumentCompany } = require("./companyService");

/**
 * Bind legacy operational docs into the caller's tenant, or enforce match.
 * Docs without companyId are claimed once (migration-safe for single→multi tenant).
 * Docs with a different companyId → 404 (no cross-tenant leak).
 */
const bindCompanyOrFail = async (doc, companyId, label = "Document") => {
    if (!doc) throw new AppError(`${label} not found.`, 404);
    if (!companyId) throw new AppError("companyId required.", 400);

    if (doc.companyId) {
        assertDocumentCompany(doc, companyId, label);
        return doc;
    }

    doc.companyId = companyId;
    if (typeof doc.save === "function") {
        await doc.save();
    }
    return doc;
};

/**
 * Read-only variant: if companyId missing, treat as not found for foreign tenants
 * only when we already know multi-tenant is active. Prefer bind for payment writes.
 */
const assertCompanyIfSet = (doc, companyId, label = "Document") => {
    if (!doc) throw new AppError(`${label} not found.`, 404);
    if (doc.companyId) {
        assertDocumentCompany(doc, companyId, label);
    }
    return doc;
};

module.exports = {
    bindCompanyOrFail,
    assertCompanyIfSet,
};
