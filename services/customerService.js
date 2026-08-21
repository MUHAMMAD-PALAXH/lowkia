const mongoose = require("mongoose");
const Customer = require("../model/customer");
const { generateCustomerCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");

const trash = createTrashOps(Customer, {
    label: "Customer",
    nameField: "name",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
    },
    restoreStatus: "Active",
    scopeStatusMap: {
        active: "Active",
        inactive: "Inactive",
        blocked: "Blocked"
    }
});

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
    "updatedAt",
    "companyId"
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

const findActiveCustomerOrFail = async (id, companyId) => {
    const customer = await trash.findActiveOrFail(id);
    assertDocumentCompany(customer, companyId, "Customer");
    return customer;
};

const createCustomer = async (payload, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const name = payload.name?.trim();
    if (!name) {
        throw new AppError("Customer name is required.", 400);
    }

    const duplicate = await Customer.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        isDeleted: false,
        ...tenant
    });
    if (duplicate) {
        throw new AppError("Customer with this name already exists.", 409);
    }

    if (payload.email) {
        const emailExists = await Customer.findOne({
            email: payload.email.toLowerCase().trim(),
            isDeleted: false,
            ...tenant
        });
        if (emailExists) {
            throw new AppError("Customer with this email already exists.", 409);
        }
    }

    if (payload.phone) {
        const phoneExists = await Customer.findOne({
            phone: payload.phone.trim(),
            isDeleted: false,
            ...tenant
        });
        if (phoneExists) {
            throw new AppError("Customer with this phone already exists.", 409);
        }
    }

    const customerCode = await generateCustomerCode();
    const data = pickUpdatableFields(payload);

    return Customer.create(
        stampCompany(
            {
                ...data,
                name,
                customerCode,
                customerId: customerCode,
                openingBalance: data.openingBalance || 0,
                currentBalance: data.openingBalance || 0,
                isApproved: true,
                approvedAt: new Date(),
                createdBy: actorId || null
            },
            companyId
        )
    );
};

const getCustomers = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { isDeleted: { $ne: true }, ...tenant };

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

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        Customer.find(filter).sort(sort).skip(skip).limit(limit),
        Customer.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        },
        trash: trashMode
    };
};

const getActiveCustomers = async (companyId = null) => {
    const tenant = companyFilter(companyId);
    return Customer.find({
        status: "Active",
        isDeleted: { $ne: true },
        ...tenant
    }).sort({ name: 1 });
};

const getCustomerById = async (
    id,
    companyId = null,
    { includeDeleted = false } = {}
) => {
    companyFilter(companyId);
    if (includeDeleted) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError("Invalid customer id.", 400);
        }
        const customer = await Customer.findById(id);
        if (!customer) throw new AppError("Customer not found.", 404);
        assertDocumentCompany(customer, companyId, "Customer");
        return customer;
    }
    return findActiveCustomerOrFail(id, companyId);
};

const updateCustomer = async (id, payload, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const customer = await findActiveCustomerOrFail(id, companyId);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const duplicate = await Customer.findOne({
            _id: { $ne: customer._id },
            name: { $regex: `^${escapeRegex(data.name.trim())}$`, $options: "i" },
            isDeleted: false,
            ...tenant
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

const deleteCustomer = async (id, actorId = null, companyId = null) => {
    await findActiveCustomerOrFail(id, companyId);
    return trash.softDelete(id, actorId);
};

const restoreCustomer = async (id, actorId = null, companyId = null) => {
    companyFilter(companyId);
    const customer = await trash.findTrashOrFail(id);
    assertDocumentCompany(customer, companyId, "Customer");
    return trash.restore(id, actorId);
};

const permanentDeleteCustomer = async (id, companyId = null) => {
    companyFilter(companyId);
    const customer = await trash.findTrashOrFail(id);
    assertDocumentCompany(customer, companyId, "Customer");
    return trash.permanentDelete(id);
};

const bulkDeleteCustomers = async (payload, actorId, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkSoftDelete(payload, actorId);
};

const bulkRestoreCustomers = async (payload, actorId, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkRestore(payload, actorId);
};

const bulkPermanentDeleteCustomers = async (payload, companyId = null) => {
    companyFilter(companyId);
    return trash.bulkPermanentDelete(payload);
};

const getCustomerStats = async (companyId = null) => {
    const tenant = companyFilter(companyId);
    const [[rows], trashCount] = await Promise.all([
        Customer.aggregate([
            { $match: { isDeleted: { $ne: true }, ...tenant } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                        $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] }
                    },
                    blocked: {
                        $sum: { $cond: [{ $eq: ["$status", "Blocked"] }, 1, 0] }
                    },
                    inactive: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0]
                        }
                    },
                    dueAmount: { $sum: "$totalDueAmount" }
                }
            }
        ]),
        Customer.countDocuments({ isDeleted: true, ...tenant })
    ]);

    return {
        ...(rows || {
            total: 0,
            active: 0,
            blocked: 0,
            inactive: 0,
            dueAmount: 0
        }),
        trashCount
    };
};

const blockCustomer = async (id, companyId = null) => {
    const customer = await findActiveCustomerOrFail(id, companyId);
    return customer.block();
};

const activateCustomer = async (id, companyId = null) => {
    const customer = await findActiveCustomerOrFail(id, companyId);
    return customer.activate();
};

const getDueReport = async (companyId = null) => {
    const tenant = companyFilter(companyId);
    return Customer.find({
        isDeleted: { $ne: true },
        totalDueAmount: { $gt: 0 },
        ...tenant
    }).sort({ totalDueAmount: -1 });
};

module.exports = {
    createCustomer,
    getCustomers,
    getActiveCustomers,
    getCustomerById,
    updateCustomer,
    deleteCustomer,
    restoreCustomer,
    permanentDeleteCustomer,
    bulkDeleteCustomers,
    bulkRestoreCustomers,
    bulkPermanentDeleteCustomers,
    getCustomerStats,
    blockCustomer,
    activateCustomer,
    getDueReport
};
