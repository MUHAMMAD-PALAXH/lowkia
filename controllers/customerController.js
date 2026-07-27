const asyncHandler = require("express-async-handler");
const customerService = require("../services/customerService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.updatedBy || null;

exports.createCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.createCustomer(
        req.body,
        getActorId(req)
    );
    return success(res, "Customer created successfully.", customer, 201);
});

exports.getCustomers = asyncHandler(async (req, res) => {
    const result = await customerService.getCustomers(req.query);
    return success(res, "Customers retrieved successfully.", result);
});

exports.getActiveCustomers = asyncHandler(async (req, res) => {
    const customers = await customerService.getActiveCustomers();
    return success(res, "Active customers retrieved successfully.", customers);
});

exports.getDueReport = asyncHandler(async (req, res) => {
    const report = await customerService.getDueReport();
    return success(res, "Customer due report retrieved successfully.", report);
});

exports.getCustomerById = asyncHandler(async (req, res) => {
    const customer = await customerService.getCustomerById(req.params.id);
    return success(res, "Customer retrieved successfully.", customer);
});

exports.updateCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.updateCustomer(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Customer updated successfully.", customer);
});

exports.deleteCustomer = asyncHandler(async (req, res) => {
    await customerService.deleteCustomer(req.params.id, getActorId(req));
    return success(res, "Customer deleted successfully.", null);
});

exports.blockCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.blockCustomer(req.params.id);
    return success(res, "Customer blocked successfully.", customer);
});

exports.activateCustomer = asyncHandler(async (req, res) => {
    const customer = await customerService.activateCustomer(req.params.id);
    return success(res, "Customer activated successfully.", customer);
});
