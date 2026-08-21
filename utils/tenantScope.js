/**
 * Helpers for stamping / filtering by tenant companyId.
 */

const AppError = require("./appError");

/** Build a Mongo filter fragment for the active company. */
const companyFilter = (companyId) => {
    if (!companyId) {
        throw new AppError("Company context is required.", 403);
    }
    return { companyId };
};

/** Merge companyId into create payload (never trust client companyId). */
const stampCompany = (payload, companyId) => {
    if (!companyId) {
        throw new AppError("Company context is required.", 403);
    }
    const data = { ...(payload || {}) };
    delete data.companyId;
    data.companyId = companyId;
    return data;
};

module.exports = {
    companyFilter,
    stampCompany,
};
