const Company = require("../model/company");
const AdminUser = require("../model/adminUser");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");
const { DEFAULT_CURRENCY } = require("../config/finance");

/**
 * Ensure a default Company exists for current single-tenant → SaaS migration.
 */
const ensureDefaultCompany = async (actorId = null) => {
    let company = await Company.findOne({
        isDefault: true,
        isDeleted: { $ne: true },
    });

    if (company) return company;

    company = await Company.findOne({ isDeleted: { $ne: true } }).sort({
        createdAt: 1,
    });

    if (company) {
        if (!company.isDefault) {
            company.isDefault = true;
            company.updatedBy = actorId || company.updatedBy;
            await company.save();
        }
        return company;
    }

    const companyCode = await generateCode("company");
    company = await Company.create({
        companyCode,
        legalName: "Lowkia",
        tradeName: "Lowkia",
        defaultCurrency: DEFAULT_CURRENCY,
        countryCode: "US",
        timezone: "America/New_York",
        status: "Active",
        isDefault: true,
        createdBy: actorId || null,
    });

    return company;
};

/**
 * Attach companyId to AdminUser if missing (backfill).
 * Returns ObjectId of the user's company.
 */
const ensureUserCompany = async (user) => {
    if (!user?._id) {
        throw new AppError("Authenticated user required.", 401);
    }

    if (user.companyId) {
        return user.companyId;
    }

    const company = await ensureDefaultCompany(user._id);

    await AdminUser.updateOne(
        { _id: user._id, $or: [{ companyId: null }, { companyId: { $exists: false } }] },
        { $set: { companyId: company._id } }
    );

    user.companyId = company._id;
    return company._id;
};

const getCompanyById = async (companyId) => {
    const company = await Company.findOne({
        _id: companyId,
        isDeleted: { $ne: true },
    });
    if (!company) {
        throw new AppError("Company not found.", 404);
    }
    if (company.status !== "Active") {
        throw new AppError(`Company is ${company.status}.`, 403);
    }
    return company;
};

/**
 * Assert a document belongs to the caller's company.
 * Never trust client-supplied companyId as authority.
 */
const assertDocumentCompany = (doc, companyId, label = "Record") => {
    if (!doc) {
        throw new AppError(`${label} not found.`, 404);
    }
    const docCompany = doc.companyId?.toString?.() || String(doc.companyId || "");
    const tenant = companyId?.toString?.() || String(companyId || "");
    if (!docCompany || !tenant || docCompany !== tenant) {
        throw new AppError(`${label} not found.`, 404);
    }
    return doc;
};

module.exports = {
    ensureDefaultCompany,
    ensureUserCompany,
    getCompanyById,
    assertDocumentCompany,
};
