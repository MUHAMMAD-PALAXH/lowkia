const asyncHandler = require("express-async-handler");
const employeeService = require("../services/employeeService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) => req.user?._id || null;

exports.createEmployee = asyncHandler(async (req, res) => {
    const doc = await employeeService.createEmployee(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Employee created.", doc, 201);
});

exports.getEmployees = asyncHandler(async (req, res) => {
    const result = await employeeService.getEmployees(req.query, req.companyId);
    return success(res, "Employees retrieved.", result);
});

exports.getAvailableUsers = asyncHandler(async (req, res) => {
    const users = await employeeService.getAvailableUsers(req.companyId);
    return success(res, "Available users retrieved.", { items: users });
});

exports.getEmployeeById = asyncHandler(async (req, res) => {
    const doc = await employeeService.getEmployeeById(
        req.params.id,
        req.companyId
    );
    return success(res, "Employee retrieved.", doc);
});

exports.updateEmployee = asyncHandler(async (req, res) => {
    const doc = await employeeService.updateEmployee(
        req.params.id,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Employee updated.", doc);
});

exports.assignShift = asyncHandler(async (req, res) => {
    const doc = await employeeService.assignShift(
        req.params.id,
        req.body.shiftId,
        getActorId(req),
        req.companyId
    );
    return success(res, "Shift assigned to employee.", doc);
});

exports.deleteEmployee = asyncHandler(async (req, res) => {
    const doc = await employeeService.deleteEmployee(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Employee moved to trash.", doc);
});

exports.restoreEmployee = asyncHandler(async (req, res) => {
    const doc = await employeeService.restoreEmployee(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Employee restored.", doc);
});

exports.permanentDeleteEmployee = asyncHandler(async (req, res) => {
    const result = await employeeService.permanentDeleteEmployee(
        req.params.id,
        req.companyId
    );
    return success(res, "Employee permanently deleted.", result);
});
