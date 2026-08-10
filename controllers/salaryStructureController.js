const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const salaryStructureService = require("../services/salaryStructureService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
});

exports.create = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.createStructure(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Salary structure created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await salaryStructureService.listStructures(
        req.companyId,
        req.query
    );
    return success(res, "Salary structures retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.getStructureById(
        req.params.id,
        req.companyId
    );
    return success(res, "Salary structure retrieved.", doc);
});

exports.update = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.updateStructure(
        req.params.id,
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Salary structure updated.", doc);
});

exports.assign = asyncHandler(async (req, res) => {
    const result = await salaryStructureService.assignToEmployee(
        req.params.id,
        req.body.employeeId,
        req.user,
        meta(req)
    );
    return success(res, "Salary structure assigned to employee.", result);
});

exports.preview = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.preview(
        req.params.id,
        req.companyId,
        req.body || req.query || {}
    );
    return success(res, "Salary structure preview.", doc);
});

exports.archive = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.archiveStructure(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Salary structure archived.", doc);
});

exports.getForEmployee = asyncHandler(async (req, res) => {
    const doc = await salaryStructureService.getEmployeeStructure(
        req.params.employeeId,
        req.companyId
    );
    return success(res, "Employee salary structure retrieved.", doc);
});
