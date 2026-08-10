const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const employeePaymentService = require("../services/employeePaymentService");

const meta = (req) => ({
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    note: req.body?.note || req.body?.approvalNote || "",
    reason: req.body?.reason || req.body?.reversalReason || "",
    providerTransactionId: req.body?.providerTransactionId,
});

exports.create = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.createEmployeePayment(
        req.body || {},
        req.user,
        meta(req)
    );
    return success(res, "Employee payment created.", doc, 201);
});

exports.list = asyncHandler(async (req, res) => {
    const result = await employeePaymentService.listEmployeePayments(
        req.companyId,
        req.query,
        req.user
    );
    return success(res, "Employee payments retrieved.", result);
});

exports.getById = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.getEmployeePaymentById(
        req.params.id,
        req.companyId,
        req.user
    );
    return success(res, "Employee payment retrieved.", doc);
});

exports.approve = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.approveEmployeePayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Employee payment approved.", doc);
});

exports.complete = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.completeEmployeePayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Employee payment completed.", doc);
});

exports.cancel = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.cancelEmployeePayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Employee payment cancelled.", doc);
});

exports.reverse = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.reverseEmployeePayment(
        req.params.id,
        req.user,
        meta(req)
    );
    return success(res, "Employee payment reversed.", doc);
});

exports.receipt = asyncHandler(async (req, res) => {
    const doc = await employeePaymentService.getEmployeePaymentReceipt(
        req.params.id,
        req.companyId,
        req.user
    );
    return success(res, "Employee payment receipt.", doc);
});
