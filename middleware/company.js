const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const Company = require("../model/company");

// =====================================================
// Load Company Context
// Header:
// x-company-id: 686xxxxxxxxxxxxxxxxxxxxx
// =====================================================

const companyContext = asyncHandler(async (req, res, next) => {

    const companyId = req.headers["x-company-id"];

    if (!companyId) {
        return res.status(400).json({
            success: false,
            message: "Company id is required."
        });
    }

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid company id."
        });
    }

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false,
        isActive: true
    });

    if (!company) {
        return res.status(404).json({
            success: false,
            message: "Company not found."
        });
    }

    const membership = req.user.companies.find(
        item => item.companyId.toString() === companyId
    );

    if (!membership && req.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "You don't have access to this company."
        });
    }

    req.company = company;
    req.companyRole = membership?.companyRole || "Owner";

    next();

});

module.exports = {
    companyContext
};