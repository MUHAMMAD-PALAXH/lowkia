const mongoose = require("mongoose");
const RecordDeleteRequest = require("../model/recordDeleteRequest");
const AppError = require("../utils/appError");
const { companyFilter } = require("../utils/tenantScope");
const { isCompanyOwner } = require("../utils/roleAccess");
const {
    createdByIdOf,
    assertCanRequestPeerDelete,
    actorIdOf,
} = require("../utils/recordOwnership");
const { emitNotification } = require("./notificationCenterService");
const { ROLES } = require("../constants/roles");

const Customer = require("../model/customer");
const SalesOrder = require("../model/salesOrder");
const RepairTicket = require("../model/repairTicket");
const Product = require("../model/product");
const PurchaseOrder = require("../model/purchaseOrder");
const Grn = require("../model/grn");
const SalesReturn = require("../model/salesReturn");
const Branch = require("../model/branch");
const Warehouse = require("../model/warehouse");
const Supplier = require("../model/supplier");

const ENTITY_REGISTRY = {
    customer: {
        Model: Customer,
        labelFields: ["name", "customerCode"],
        screen: "Customers",
        buildSnapshot: (doc) => ({
            name: doc.name,
            customerCode: doc.customerCode,
            phone: doc.phone,
            email: doc.email,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    sales_order: {
        Model: SalesOrder,
        labelFields: ["orderNumber", "invoiceNumber"],
        screen: "SalesOrders",
        buildSnapshot: (doc) => ({
            orderNumber: doc.orderNumber,
            status: doc.status,
            paymentStatus: doc.paymentStatus,
            grandTotal: doc.grandTotal,
            orderDate: doc.orderDate,
            createdAt: doc.createdAt,
        }),
    },
    repair_ticket: {
        Model: RepairTicket,
        labelFields: ["ticketNumber", "ticketCode"],
        screen: "RepairTickets",
        buildSnapshot: (doc) => ({
            ticketNumber: doc.ticketNumber || doc.ticketCode,
            status: doc.status,
            device: doc.deviceModel || doc.deviceName,
            customerName: doc.customerName,
            totalAmount: doc.totalAmount,
            createdAt: doc.createdAt,
        }),
    },
    product: {
        Model: Product,
        labelFields: ["name", "sku", "productCode"],
        screen: "Products",
        buildSnapshot: (doc) => ({
            name: doc.name,
            sku: doc.sku || doc.productCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    purchase_order: {
        Model: PurchaseOrder,
        labelFields: ["poNumber", "orderNumber"],
        screen: "PurchaseOrders",
        buildSnapshot: (doc) => ({
            poNumber: doc.poNumber || doc.orderNumber,
            status: doc.status,
            grandTotal: doc.grandTotal || doc.totalAmount,
            createdAt: doc.createdAt,
        }),
    },
    grn: {
        Model: Grn,
        labelFields: ["grnNumber", "grnCode"],
        screen: "GRN",
        buildSnapshot: (doc) => ({
            grnNumber: doc.grnNumber || doc.grnCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    sales_return: {
        Model: SalesReturn,
        labelFields: ["returnNumber", "returnCode"],
        screen: "SalesReturns",
        buildSnapshot: (doc) => ({
            returnNumber: doc.returnNumber || doc.returnCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    branch: {
        Model: Branch,
        labelFields: ["name", "branchCode"],
        screen: "Branches",
        buildSnapshot: (doc) => ({
            name: doc.name,
            branchCode: doc.branchCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    warehouse: {
        Model: Warehouse,
        labelFields: ["name", "warehouseCode"],
        screen: "Warehouse",
        buildSnapshot: (doc) => ({
            name: doc.name,
            warehouseCode: doc.warehouseCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
    supplier: {
        Model: Supplier,
        labelFields: ["name", "supplierCode"],
        screen: "Supplier",
        buildSnapshot: (doc) => ({
            name: doc.name,
            supplierCode: doc.supplierCode,
            status: doc.status,
            createdAt: doc.createdAt,
        }),
    },
};

const resolveEntityMeta = (entityType) => {
    const key = String(entityType || "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_");
    const meta = ENTITY_REGISTRY[key];
    if (!meta) {
        throw new AppError(`Unsupported entity type: ${entityType}`, 400);
    }
    return { key, ...meta };
};

const labelFromDoc = (doc, fields = []) => {
    for (const field of fields) {
        const value = doc?.[field];
        if (value != null && String(value).trim()) return String(value).trim();
    }
    return String(doc?._id || "");
};

const actorDisplayName = (user) => {
    const first = String(user?.firstName || "").trim();
    const last = String(user?.lastName || "").trim();
    const full = `${first} ${last}`.trim();
    return full || user?.email || "User";
};

const loadEntityOrFail = async (entityType, entityId, companyId) => {
    const meta = resolveEntityMeta(entityType);
    if (!mongoose.Types.ObjectId.isValid(entityId)) {
        throw new AppError("Invalid entity id.", 400);
    }
    const doc = await meta.Model.findOne({
        _id: entityId,
        ...companyFilter(companyId),
    });
    if (!doc) {
        throw new AppError(`${meta.key} not found.`, 404);
    }
    return { doc, meta };
};

const createRequest = async ({ entityType, entityId, reason }, actor, companyId) => {
    if (!actor || !isCompanyOwner(actor.role)) {
        throw new AppError(
            "Only the company super admin can request peer record deletion.",
            403
        );
    }
    const { doc, meta } = await loadEntityOrFail(entityType, entityId, companyId);
    assertCanRequestPeerDelete(doc, actor, meta.key);

    const existing = await RecordDeleteRequest.findOne({
        companyId,
        entityType: meta.key,
        entityId: doc._id,
        status: "pending",
    });
    if (existing) {
        throw new AppError("A pending delete request already exists for this record.", 409);
    }

    const snapshot = meta.buildSnapshot(doc);
    const request = await RecordDeleteRequest.create({
        companyId,
        entityType: meta.key,
        entityId: doc._id,
        entityLabel: labelFromDoc(doc, meta.labelFields),
        screen: meta.screen,
        snapshot,
        reason: String(reason || "").trim(),
        recordOwnerId: doc.createdBy,
        requestedBy: actor._id,
        status: "pending",
    });

    await emitNotification({
        companyId,
        recipientId: doc.createdBy,
        audienceRoles: [ROLES.EMPLOYEE, ROLES.BRANCH_MANAGER, ROLES.COMPANY_SUPER_ADMIN, ROLES.ADMIN],
        category: "record_delete",
        eventType: "delete_requested",
        priority: "high",
        title: `Delete request: ${request.entityLabel}`,
        message: `${actorDisplayName(actor)} requested permanent deletion of your ${meta.key.replace(/_/g, " ")} "${request.entityLabel}".`,
        entityType: "RecordDeleteRequest",
        entityId: String(request._id),
        entityLabel: request.entityLabel,
        screen: "RecordDeleteRequests",
        tab: "inbound",
        actor: {
            userId: actor._id,
            name: actorDisplayName(actor),
            role: actor.role || "",
        },
        metadata: {
            requestId: String(request._id),
            targetEntityType: meta.key,
            targetEntityId: String(doc._id),
            reason: request.reason,
            snapshot,
        },
        source: "record_delete",
    });

    return request;
};

const listRequests = async (query = {}, actor, companyId) => {
    const tenant = companyFilter(companyId);
    const filter = { ...tenant };
    const scope = String(query.scope || "inbox").toLowerCase();
    const userId = actorIdOf(actor);

    if (scope === "outbound") {
        filter.requestedBy = userId;
    } else if (scope === "all" && isCompanyOwner(actor.role)) {
        filter.$or = [{ recordOwnerId: userId }, { requestedBy: userId }];
    } else {
        filter.recordOwnerId = userId;
    }

    if (query.status && query.status !== "all") {
        filter.status = String(query.status).toLowerCase();
    }

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        RecordDeleteRequest.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("requestedBy", "firstName lastName email role")
            .populate("recordOwnerId", "firstName lastName email role")
            .lean(),
        RecordDeleteRequest.countDocuments(filter),
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1,
        },
    };
};

const findRequestOrFail = async (id, companyId) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid request id.", 400);
    }
    const doc = await RecordDeleteRequest.findOne({
        _id: id,
        ...companyFilter(companyId),
    });
    if (!doc) throw new AppError("Delete request not found.", 404);
    return doc;
};

const approveRequest = async (id, actor, companyId, note = "") => {
    const request = await findRequestOrFail(id, companyId);
    if (String(request.recordOwnerId) !== actorIdOf(actor)) {
        throw new AppError("Only the record creator can approve this delete request.", 403);
    }
    if (request.status !== "pending") {
        throw new AppError("Only pending requests can be approved.", 400);
    }

    const { doc, meta } = await loadEntityOrFail(
        request.entityType,
        request.entityId,
        companyId
    );

    // Permanent wipe (approved peer delete) — bypass own-trash rule.
    await meta.Model.deleteOne({
        _id: doc._id,
        ...companyFilter(companyId),
    });

    request.status = "completed";
    request.decidedAt = new Date();
    request.decidedBy = actor._id;
    request.decisionNote = String(note || "").trim();
    request.completedAt = new Date();
    await request.save();

    const snapshot = request.snapshot || {};
    await emitNotification({
        companyId,
        recipientId: request.recordOwnerId,
        audienceRoles: [ROLES.EMPLOYEE, ROLES.BRANCH_MANAGER, ROLES.COMPANY_SUPER_ADMIN, ROLES.ADMIN],
        category: "record_delete",
        eventType: "delete_completed",
        priority: "critical",
        title: `Record permanently deleted: ${request.entityLabel}`,
        message: `Your ${request.entityType.replace(/_/g, " ")} "${request.entityLabel}" was permanently deleted after you approved the company super admin request.`,
        entityType: "RecordDeleteRequest",
        entityId: String(request._id),
        entityLabel: request.entityLabel,
        screen: "RecordDeleteRequests",
        tab: "completed",
        actor: {
            userId: actor._id,
            name: actorDisplayName(actor),
            role: actor.role || "",
        },
        metadata: {
            requestId: String(request._id),
            targetEntityType: request.entityType,
            targetEntityId: String(request.entityId),
            reason: request.reason,
            decisionNote: request.decisionNote,
            snapshot,
            deletedAt: request.completedAt,
        },
        source: "record_delete",
    });

    await emitNotification({
        companyId,
        recipientId: request.requestedBy,
        audienceRoles: [ROLES.COMPANY_SUPER_ADMIN, ROLES.ADMIN],
        category: "record_delete",
        eventType: "delete_approved",
        priority: "high",
        title: `Delete approved: ${request.entityLabel}`,
        message: `${actorDisplayName(actor)} approved permanent deletion of "${request.entityLabel}".`,
        entityType: "RecordDeleteRequest",
        entityId: String(request._id),
        entityLabel: request.entityLabel,
        screen: "RecordDeleteRequests",
        actor: {
            userId: actor._id,
            name: actorDisplayName(actor),
            role: actor.role || "",
        },
        metadata: {
            requestId: String(request._id),
            snapshot,
        },
        source: "record_delete",
    });

    return request;
};

const rejectRequest = async (id, actor, companyId, note = "") => {
    const request = await findRequestOrFail(id, companyId);
    if (String(request.recordOwnerId) !== actorIdOf(actor)) {
        throw new AppError("Only the record creator can reject this delete request.", 403);
    }
    if (request.status !== "pending") {
        throw new AppError("Only pending requests can be rejected.", 400);
    }

    request.status = "rejected";
    request.decidedAt = new Date();
    request.decidedBy = actor._id;
    request.decisionNote = String(note || "").trim();
    await request.save();

    await emitNotification({
        companyId,
        recipientId: request.requestedBy,
        audienceRoles: [ROLES.COMPANY_SUPER_ADMIN, ROLES.ADMIN],
        category: "record_delete",
        eventType: "delete_rejected",
        priority: "high",
        title: `Delete rejected: ${request.entityLabel}`,
        message: `${actorDisplayName(actor)} rejected permanent deletion of "${request.entityLabel}".`,
        entityType: "RecordDeleteRequest",
        entityId: String(request._id),
        entityLabel: request.entityLabel,
        screen: "RecordDeleteRequests",
        actor: {
            userId: actor._id,
            name: actorDisplayName(actor),
            role: actor.role || "",
        },
        metadata: {
            requestId: String(request._id),
            decisionNote: request.decisionNote,
            snapshot: request.snapshot || {},
        },
        source: "record_delete",
    });

    return request;
};

const cancelRequest = async (id, actor, companyId) => {
    const request = await findRequestOrFail(id, companyId);
    if (String(request.requestedBy) !== actorIdOf(actor)) {
        throw new AppError("Only the requester can cancel this delete request.", 403);
    }
    if (request.status !== "pending") {
        throw new AppError("Only pending requests can be cancelled.", 400);
    }
    request.status = "cancelled";
    request.decidedAt = new Date();
    request.decidedBy = actor._id;
    await request.save();
    return request;
};

const getRequestById = async (id, actor, companyId) => {
    const request = await RecordDeleteRequest.findOne({
        _id: id,
        ...companyFilter(companyId),
    })
        .populate("requestedBy", "firstName lastName email role")
        .populate("recordOwnerId", "firstName lastName email role")
        .lean();
    if (!request) throw new AppError("Delete request not found.", 404);
    const uid = actorIdOf(actor);
    const allowed =
        String(request.recordOwnerId?._id || request.recordOwnerId) === uid ||
        String(request.requestedBy?._id || request.requestedBy) === uid;
    if (!allowed) {
        throw new AppError("You cannot view this delete request.", 403);
    }
    return request;
};

module.exports = {
    ENTITY_REGISTRY,
    createRequest,
    listRequests,
    getRequestById,
    approveRequest,
    rejectRequest,
    cancelRequest,
    createdByIdOf,
};
