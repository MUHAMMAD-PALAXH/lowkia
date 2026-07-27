const mongoose = require("mongoose");
const Customer = require("../model/customer");
const { generateCustomerCode } = require("./codeGenerator");
const AppError = require("../utils/appError");

const PROTECTED_FIELDS = [
    "customerId",
    "customerCode",
    "totalSalesAmount",
    "totalPaidAmount",
    "totalDueAmount",
    "currentBalance",
    "rating",
    "ratingCount",
    "ledgerAccountId",
    "customerLedgerId",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "approvedBy",
    "approvedAt",
    "isApproved",
    "createdBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };
    delete data.customerId;
    PROTECTED_FIELDS.forEach((field) => {
        delete data[field];
    });
    return data;
};

const findActiveCustomerOrFail = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid customer id.", 400);
    }

    const customer = await Customer.findOne({
        _id: id,
        isDeleted: false
    });

    if (!customer) {
        throw new AppError("Customer not found.", 404);
    }

    return customer;
};

const createCustomer = async (payload, actorId = null) => {
    const name = payload.name?.trim();
    if (!name) {
        throw new AppError("Customer name is required.", 400);
    }

    const duplicate = await Customer.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        isDeleted: false
    });
    if (duplicate) {
        throw new AppError("Customer with this name already exists.", 409);
    }

    if (payload.email) {
        const emailExists = await Customer.findOne({
            email: payload.email.toLowerCase().trim(),
            isDeleted: false
        });
        if (emailExists) {
            throw new AppError("Customer with this email already exists.", 409);
        }
    }

    if (payload.phone) {
        const phoneExists = await Customer.findOne({
            phone: payload.phone.trim(),
            isDeleted: false
        });
        if (phoneExists) {
            throw new AppError("Customer with this phone already exists.", 409);
        }
    }

    const customerCode = await generateCustomerCode();
    const data = pickUpdatableFields(payload);

    return Customer.create({
        ...data,
        name,
        customerCode,
        customerId: customerCode,
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
        isApproved: true,
        approvedAt: new Date(),
        createdBy: actorId || null
    });
};

const getCustomers = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };

    if (query.status) filter.status = query.status;
    if (query.customerType) filter.customerType = query.customerType;

    if (query.search) {
        const search = query.search.trim();
        filter.$or = [
            { name: { $regex: escapeRegex(search), $options: "i" } },
            { companyName: { $regex: escapeRegex(search), $options: "i" } },
            { customerCode: { $regex: escapeRegex(search), $options: "i" } },
            { phone: { $regex: escapeRegex(search), $options: "i" } },
            { email: { $regex: escapeRegex(search), $options: "i" } }
        ];
    }

    const [items, total] = await Promise.all([
        Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Customer.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
};

const getActiveCustomers = () => Customer.getActiveCustomers().sort({ name: 1 });

const getCustomerById = async (id) => findActiveCustomerOrFail(id);

const updateCustomer = async (id, payload, actorId = null) => {
    const customer = await findActiveCustomerOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const duplicate = await Customer.findOne({
            _id: { $ne: customer._id },
            name: { $regex: `^${escapeRegex(data.name.trim())}$`, $options: "i" },
            isDeleted: false
        });
        if (duplicate) {
            throw new AppError("Customer with this name already exists.", 409);
        }
        data.name = data.name.trim();
    }

    Object.assign(customer, data);
    customer.updatedBy = actorId || null;
    await customer.save();
    return customer;
};

const deleteCustomer = async (id, actorId = null) => {
    const customer = await findActiveCustomerOrFail(id);
    customer.isDeleted = true;
    customer.deletedAt = new Date();
    customer.deletedBy = actorId || null;
    customer.status = "Inactive";
    await customer.save();
    return customer;
};

const blockCustomer = async (id) => {
    const customer = await findActiveCustomerOrFail(id);
    return customer.block();
};

const activateCustomer = async (id) => {
    const customer = await findActiveCustomerOrFail(id);
    return customer.activate();
};

const getDueReport = () => Customer.getDueReport();

module.exports = {
    createCustomer,
    getCustomers,
    getActiveCustomers,
    getCustomerById,
    updateCustomer,
    deleteCustomer,
    blockCustomer,
    activateCustomer,
    getDueReport
};
