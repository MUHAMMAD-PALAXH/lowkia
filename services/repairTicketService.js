const RepairTicket = require("../model/repairTicket");
const ItemTrack = require("../model/itemTrack");
const Branch = require("../model/branch");
const Customer = require("../model/customer");
const { generateRepairTicketCode, generateCustomerCode } = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");
const { companyFilter, stampCompany } = require("../utils/tenantScope");
const { assertDocumentCompany } = require("./companyService");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");
const { writeActivityLog } = require("./activityLogService");
const {
    buildRepairTicketWorkbook,
    buildExportFilename,
    MAX_EXPORT_REPAIR_TICKETS
} = require("./export/repairTicketExcelExporter");
const {
    assertCanEditContent,
    assertCanTrash,
    assertCanManageTrashItem,
    applyOwnTrashFilter,
} = require("../utils/recordOwnership");

const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };

const trash = createTrashOps(RepairTicket, {
    label: "Repair Ticket",
    nameField: "ticketNumber",
    statusField: "status",
    restoreStatus: null,
    scopeStatusMap: {
        pending: "Pending",
        diagnosing: "Diagnosing",
        waitingforapproval: "Waiting For Approval",
        waitingforparts: "Waiting For Parts",
        repairing: "Repairing",
        qualitycheck: "Quality Check",
        readyforpickup: "Ready For Pickup",
        completed: "Completed",
        delivered: "Delivered",
        cancelled: "Cancelled"
    }
});

const toObjectId = (value) => {
    if (!value) return null;
    const s = String(value).trim();
    return s && s !== "null" && s !== "undefined" ? s : null;
};

const money = (value) => Math.max(Number(value) || 0, 0);

const resolvePaymentMethod = (value) => {
    const allowed = ["Advance", "Partial", "CashOnDelivery", "Bank"];
    const v = String(value || "Advance").trim();
    return allowed.includes(v) ? v : "Advance";
};

const resolveTicketSource = (value) =>
    String(value || "").trim() === "ExistingProduct"
        ? "ExistingProduct"
        : "NewRepair";

const resolveTrackingType = (value) =>
    String(value || "").toUpperCase().includes("IMEI") &&
    !String(value || "").toUpperCase().includes("NON")
        ? "IMEI"
        : "Non-IMEI";

const resolveRepairWarrantyUnit = (value) => {
    const v = String(value || "Day").trim();
    return ["Day", "Week", "Month", "Year"].includes(v) ? v : "Day";
};

/**
 * Link an existing customer or create one from repair walk-in details
 * so the Customer screen stays in sync.
 */
const resolveRepairCustomerId = async ({
    customerId,
    customerName,
    phone,
    email = "",
    address = "",
    actorId = null,
    companyId = null,
}) => {
    const tenant = companyFilter(companyId);
    const existingId = toObjectId(customerId);
    if (existingId) {
        const existing = await Customer.findOne({
            _id: existingId,
            isDeleted: { $ne: true },
            ...tenant,
        });
        if (existing) return existing._id;
    }

    const byPhone = await Customer.findOne({
        phone,
        isDeleted: { $ne: true },
        ...tenant,
    });
    if (byPhone) {
        if (!byPhone.source) {
            byPhone.source = "RepairTicket";
            await byPhone.save();
        }
        return byPhone._id;
    }

    const customerCode = await generateCustomerCode();
    const created = await Customer.create(
        stampCompany(
            {
                name: customerName,
                phone,
                email: String(email || "").trim(),
                address: String(address || "").trim(),
                customerCode,
                customerId: customerCode,
                customerType: "Retail",
                paymentTerms: "Cash",
                status: "Active",
                isApproved: true,
                approvedAt: new Date(),
                source: "RepairTicket",
                note: "Created from repair ticket",
                createdBy: toObjectId(actorId),
            },
            companyId
        )
    );
    return created._id;
};

const resolveStatus = (value) => {
    const allowed = [
        "Pending",
        "Diagnosing",
        "Waiting For Approval",
        "Waiting For Parts",
        "Repairing",
        "Quality Check",
        "Ready For Pickup",
        "Completed",
        "Delivered",
        "Cancelled"
    ];
    const v = String(value || "Pending").trim();
    return allowed.includes(v) ? v : "Pending";
};

const calcAmounts = (payload = {}) => {
    const diagnosisCharge = money(payload.diagnosisCharge);
    const serviceCharge = money(payload.serviceCharge ?? payload.price);
    const partsCost = money(payload.partsCost);
    const laborCost = money(payload.laborCost);
    const discount = money(payload.discount);
    const tax = money(payload.tax);
    const otherCharges = money(payload.otherCharges);
    const totalAmount = Math.max(
        diagnosisCharge +
            serviceCharge +
            partsCost +
            laborCost +
            tax +
            otherCharges -
            discount,
        0
    );
    const paidAmount = money(payload.paidAmount);
    const dueAmount = Math.max(totalAmount - paidAmount, 0);

    let paymentStatus = "Unpaid";
    if (paidAmount <= 0) paymentStatus = "Unpaid";
    else if (paidAmount + 0.0001 >= totalAmount) paymentStatus = "Paid";
    else paymentStatus = "Partial";

    return {
        diagnosisCharge,
        serviceCharge,
        partsCost,
        laborCost,
        discount,
        tax,
        otherCharges,
        totalAmount,
        paidAmount,
        dueAmount,
        paymentStatus
    };
};

const normalizeDevice = (raw = {}, fallbackName = "Repair Device") => {
    const productName =
        String(raw.productName || raw.model || fallbackName).trim() ||
        fallbackName;
    return {
        productId: toObjectId(raw.productId),
        productVariantId: toObjectId(raw.productVariantId),
        productName,
        brand: String(raw.brand || "").trim(),
        model: String(raw.model || productName).trim(),
        category: String(raw.category || "").trim(),
        serialNumber: String(raw.serialNumber || "").trim().toUpperCase(),
        imei1: String(raw.imei1 || raw.imei || "").trim().toUpperCase(),
        imei2: String(raw.imei2 || "").trim().toUpperCase(),
        color: String(raw.color || "").trim(),
        accessories: Array.isArray(raw.accessories)
            ? raw.accessories.map((a) => String(a).trim()).filter(Boolean)
            : [],
        problemDescription:
            String(raw.problemDescription || raw.serviceDetails || "Repair")
                .trim() || "Repair",
        technicianRemark: String(raw.technicianRemark || "").trim()
    };
};

const shortRepairCode = (ticketNumber = "") => {
    const digits = String(ticketNumber).replace(/\D/g, "");
    if (digits.length >= 6) return digits.slice(-6);
    return digits.padStart(6, "0");
};

const populateTicket = (query) =>
    query
        .populate("branchId", "name code branchCode")
        .populate("customerId", "name phone email")
        .populate("assignedTechnician", "name email")
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email");

const createRepairTicket = async (
    payload = {},
    actorId = null,
    companyId = null
) => {
    const tenant = companyFilter(companyId);
    const branchId = toObjectId(payload.branchId);
    if (branchId) {
        const branch = await Branch.findOne({
            _id: branchId,
            ...NOT_DELETED,
            ...tenant
        });
        if (!branch) {
            const err = new Error("Branch not found.");
            err.status = 404;
            throw err;
        }
        assertDocumentCompany(branch, companyId, "Branch");
    }

    const customerName = String(payload.customerName || "").trim();
    const phone = String(payload.phone || "").trim();
    if (!customerName || !phone) {
        const err = new Error("Customer name and phone are required.");
        err.status = 400;
        throw err;
    }

    const resolvedCustomerId = await resolveRepairCustomerId({
        customerId: payload.customerId,
        customerName,
        phone,
        email: payload.email,
        address: payload.address,
        actorId,
        companyId,
    });

    const ticketSource = resolveTicketSource(payload.ticketSource);
    const trackingType = resolveTrackingType(payload.trackingType);
    const serviceDetails = String(
        payload.serviceDetails ||
            payload.device?.problemDescription ||
            payload.problemDescription ||
            ""
    ).trim();

    if (!serviceDetails) {
        const err = new Error("Service details are required.");
        err.status = 400;
        throw err;
    }

    const amounts = calcAmounts(payload);
    const ticketNumber = await generateRepairTicketCode();
    const repairCode =
        String(payload.repairCode || "").trim() || shortRepairCode(ticketNumber);
    const barcode =
        String(payload.barcode || "").trim() || (await generateProductBarcode());

    const device = normalizeDevice(
        {
            ...(payload.device || {}),
            productName:
                payload.device?.productName ||
                payload.productName ||
                payload.deviceModel ||
                "Repair Device",
            model: payload.device?.model || payload.deviceModel || "",
            brand: payload.device?.brand || payload.brand || "",
            imei1: payload.device?.imei1 || payload.imei || "",
            problemDescription: serviceDetails
        },
        "Repair Device"
    );

    let warrantyChecked = !!payload.warrantyChecked;
    let isWarranty = !!payload.isWarranty;
    let warrantyType = payload.warrantyType || "No Warranty";
    let warrantyExpiry = payload.warrantyExpiry || null;
    let itemTrackId = toObjectId(payload.itemTrackId);

    if (ticketSource === "NewRepair") {
        warrantyChecked = false;
        isWarranty = false;
        warrantyType = "No Warranty";
        warrantyExpiry = null;
        itemTrackId = null;
    } else if (trackingType === "IMEI" && device.imei1) {
        let track = await ItemTrack.findOne({
            imei: device.imei1,
            isDeleted: { $ne: true },
            ...tenant
        });
        // Transition: unstamped track owned by this company's product.
        if (!track) {
            track = await ItemTrack.findOne({
                imei: device.imei1,
                isDeleted: { $ne: true },
                $or: [{ companyId: null }, { companyId: { $exists: false } }]
            }).populate("productId", "companyId");
            const productCompany = track?.productId?.companyId;
            if (
                !track ||
                !productCompany ||
                String(productCompany) !== String(companyId)
            ) {
                track = null;
            } else {
                track.companyId = companyId;
            }
        }
        if (track) {
            itemTrackId = track._id;
            warrantyChecked = true;
            if (track.warrantyExpiry) {
                warrantyExpiry = track.warrantyExpiry;
                isWarranty = new Date(track.warrantyExpiry) >= new Date();
                warrantyType = isWarranty ? "Shop" : "No Warranty";
            }
            track.status = "repairing";
            track.history = track.history || [];
            track.history.push({
                status: "repairing",
                updatedBy: actorId || null,
                notes: `Repair ticket ${ticketNumber}`
            });
            await track.save();
        }
    }

    const createdBy = toObjectId(actorId || payload.createdBy || payload.actorId);
    if (!createdBy) {
        const err = new Error("createdBy / actorId is required.");
        err.status = 400;
        throw err;
    }

    const doc = await RepairTicket.create(
        stampCompany(
            {
        branchId,
        ticketNumber,
        repairCode,
        barcode,
        ticketSource,
        trackingType,
        serviceDetails,
        paymentMethod: resolvePaymentMethod(payload.paymentMethod),
        receivedDate: payload.repairDate || payload.receivedDate || new Date(),
        expectedDeliveryDate:
            payload.expectedDeliveryDate || payload.pickupDate || null,
        pickupDate: payload.pickupDate || null,
        customerId: resolvedCustomerId,
        customerName,
        phone,
        alternatePhone: String(payload.alternatePhone || "").trim(),
        email: String(payload.email || "").trim(),
        address: String(payload.address || "").trim(),
        device,
        warrantyChecked,
        isWarranty,
        warrantyType,
        warrantyExpiry,
        itemTrackId,
        sourceSalesOrderId: toObjectId(payload.sourceSalesOrderId),
        serviceType: payload.serviceType || "General Service",
        priority: payload.priority || "Normal",
        status: resolveStatus(payload.status),
        assignedTechnician: toObjectId(payload.assignedTechnician),
        diagnosis: String(payload.diagnosis || "").trim(),
        repairSolution: String(payload.repairSolution || "").trim(),
        internalNote: String(payload.internalNote || "").trim(),
        repairedBy: String(payload.repairedBy || "").trim(),
        repairWarrantyPeriod: Math.max(
            Number(payload.repairWarrantyPeriod) || 0,
            0
        ),
        repairWarrantyUnit: resolveRepairWarrantyUnit(
            payload.repairWarrantyUnit
        ),
        ...amounts,
        createdBy
            },
            companyId
        )
    );

    return populateTicket(RepairTicket.findById(doc._id)).lean();
};

const getRepairTickets = async (query = {}, companyId = null, actor = null) => {
    const trashMode = isTrashQuery(query);
    const tenant = companyFilter(companyId);
    let filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };
    if (trashMode && actor) {
        filter = applyOwnTrashFilter(filter, actor);
    }
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.customerId && toObjectId(query.customerId)) {
        filter.customerId = toObjectId(query.customerId);
    }
    if (query.status) filter.status = String(query.status).trim();
    if (query.ticketSource) filter.ticketSource = resolveTicketSource(query.ticketSource);
    if (query.paymentMethod) {
        filter.paymentMethod = resolvePaymentMethod(query.paymentMethod);
    }
    if (query.trackingType) {
        filter.trackingType = resolveTrackingType(query.trackingType);
    }

    const search = String(query.search || "").trim();
    if (search) {
        filter.$or = [
            { ticketNumber: { $regex: search, $options: "i" } },
            { repairCode: { $regex: search, $options: "i" } },
            { barcode: { $regex: search, $options: "i" } },
            { customerName: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { serviceDetails: { $regex: search, $options: "i" } },
            { "device.productName": { $regex: search, $options: "i" } },
            { "device.imei1": { $regex: search, $options: "i" } },
            { repairedBy: { $regex: search, $options: "i" } }
        ];
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;
    const sort = trash.resolveEntitySort(query);

    const [items, total] = await Promise.all([
        populateTicket(
            RepairTicket.find(filter).sort(sort).skip(skip).limit(limit)
        ).lean(),
        RepairTicket.countDocuments(filter)
    ]);

    return { items, total, page, limit, trash: trashMode };
};

const getRepairTicketById = async (
    id,
    companyId = null,
    { includeDeleted = false } = {},
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const filter = { _id: id, ...tenant };
    if (!includeDeleted) Object.assign(filter, NOT_DELETED);
    const doc = await populateTicket(RepairTicket.findOne(filter)).lean();
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(doc, companyId, "Repair ticket");
    if (includeDeleted && doc.isDeleted && actor) {
        assertCanManageTrashItem(doc, actor, "Repair ticket");
    }
    return doc;
};

const updateRepairTicket = async (
    id,
    payload = {},
    actorId = null,
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const doc = await RepairTicket.findOne({ _id: id, ...NOT_DELETED, ...tenant });
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(doc, companyId, "Repair ticket");
    assertCanEditContent(doc, actor || { _id: actorId }, "Repair ticket");

    if (payload.branchId !== undefined) {
        const nextBranchId = toObjectId(payload.branchId);
        if (nextBranchId) {
            const branch = await Branch.findOne({
                _id: nextBranchId,
                ...NOT_DELETED,
                ...tenant
            });
            if (!branch) {
                const err = new Error("Branch not found.");
                err.status = 404;
                throw err;
            }
            assertDocumentCompany(branch, companyId, "Branch");
            doc.branchId = nextBranchId;
        } else {
            doc.branchId = null;
        }
    }
    if (payload.customerName != null) {
        doc.customerName = String(payload.customerName).trim();
    }
    if (payload.phone != null) doc.phone = String(payload.phone).trim();
    if (payload.alternatePhone != null) {
        doc.alternatePhone = String(payload.alternatePhone).trim();
    }
    if (payload.email != null) doc.email = String(payload.email).trim();
    if (payload.address != null) doc.address = String(payload.address).trim();
    if (payload.serviceDetails != null) {
        doc.serviceDetails = String(payload.serviceDetails).trim();
        if (doc.device) {
            doc.device.problemDescription = doc.serviceDetails || doc.device.problemDescription;
        }
    }
    if (payload.paymentMethod != null) {
        doc.paymentMethod = resolvePaymentMethod(payload.paymentMethod);
    }
    if (payload.trackingType != null) {
        doc.trackingType = resolveTrackingType(payload.trackingType);
    }
    if (payload.priority != null) doc.priority = payload.priority;
    if (payload.serviceType != null) doc.serviceType = payload.serviceType;
    if (payload.diagnosis != null) doc.diagnosis = String(payload.diagnosis).trim();
    if (payload.repairSolution != null) {
        doc.repairSolution = String(payload.repairSolution).trim();
    }
    if (payload.internalNote != null) {
        doc.internalNote = String(payload.internalNote).trim();
    }
    if (payload.repairedBy != null) {
        doc.repairedBy = String(payload.repairedBy).trim();
    }
    if (payload.repairWarrantyPeriod != null) {
        doc.repairWarrantyPeriod = Math.max(
            Number(payload.repairWarrantyPeriod) || 0,
            0
        );
    }
    if (payload.repairWarrantyUnit != null) {
        doc.repairWarrantyUnit = resolveRepairWarrantyUnit(
            payload.repairWarrantyUnit
        );
    }
    if (payload.repairDate || payload.receivedDate) {
        doc.receivedDate = payload.repairDate || payload.receivedDate;
    }
    if (payload.pickupDate !== undefined) {
        doc.pickupDate = payload.pickupDate || null;
    }
    if (payload.expectedDeliveryDate !== undefined) {
        doc.expectedDeliveryDate = payload.expectedDeliveryDate || null;
    }
    if (payload.device) {
        doc.device = normalizeDevice(
            { ...doc.device?.toObject?.() || doc.device || {}, ...payload.device },
            doc.device?.productName || "Repair Device"
        );
        doc.markModified("device");
    }

    // Keep / create customer master when name+phone are present.
    const nextName = String(payload.customerName ?? doc.customerName ?? "").trim();
    const nextPhone = String(payload.phone ?? doc.phone ?? "").trim();
    if (nextName && nextPhone) {
        doc.customerId = await resolveRepairCustomerId({
            customerId: payload.customerId ?? doc.customerId,
            customerName: nextName,
            phone: nextPhone,
            email: payload.email ?? doc.email,
            address: payload.address ?? doc.address,
            actorId,
            companyId,
        });
    }

    const amounts = calcAmounts({
        diagnosisCharge: payload.diagnosisCharge ?? doc.diagnosisCharge,
        serviceCharge: payload.serviceCharge ?? payload.price ?? doc.serviceCharge,
        partsCost: payload.partsCost ?? doc.partsCost,
        laborCost: payload.laborCost ?? doc.laborCost,
        discount: payload.discount ?? doc.discount,
        tax: payload.tax ?? doc.tax,
        otherCharges: payload.otherCharges ?? doc.otherCharges,
        paidAmount: payload.paidAmount ?? doc.paidAmount
    });
    Object.assign(doc, amounts);

    doc.updatedBy = toObjectId(actorId || payload.updatedBy || payload.actorId);
    await doc.save();
    return getRepairTicketById(doc._id, companyId);
};

const updateRepairTicketStatus = async (
    id,
    status,
    actorId = null,
    companyId = null
) => {
    const tenant = companyFilter(companyId);
    const doc = await RepairTicket.findOne({ _id: id, ...NOT_DELETED, ...tenant });
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(doc, companyId, "Repair ticket");

    const next = resolveStatus(status);
    doc.status = next;
    if (next === "Completed" || next === "Ready For Pickup") {
        doc.completedDate = doc.completedDate || new Date();
    }
    if (next === "Delivered") {
        doc.pickupDate = doc.pickupDate || new Date();
        doc.completedDate = doc.completedDate || new Date();
    }
    doc.updatedBy = toObjectId(actorId);
    await doc.save();
    return getRepairTicketById(doc._id, companyId);
};

const completeRepairTicket = async (id, actorId = null, companyId = null) =>
    updateRepairTicketStatus(id, "Completed", actorId, companyId);

const deleteRepairTicket = async (
    id,
    actorId = null,
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const existing = await RepairTicket.findOne({
        _id: id,
        ...NOT_DELETED,
        ...tenant
    });
    if (!existing) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(existing, companyId, "Repair ticket");
    assertCanTrash(existing, actor || { _id: actorId }, "Repair ticket");
    const doc = await trash.softDelete(
        id,
        actorId,
        companyId,
        actor || { _id: actorId }
    );
    return { id: String(doc._id) };
};

const restoreRepairTicket = async (
    id,
    actorId = null,
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const existing = await RepairTicket.findOne({
        _id: id,
        isDeleted: true,
        ...tenant
    });
    if (!existing) {
        const err = new Error("Trash repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(existing, companyId, "Repair ticket");
    assertCanManageTrashItem(
        existing,
        actor || { _id: actorId },
        "Repair ticket"
    );
    await trash.restore(id, actorId, companyId, actor || { _id: actorId });
    return getRepairTicketById(id, companyId);
};

const permanentDeleteRepairTicket = async (
    id,
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const existing = await RepairTicket.findOne({
        _id: id,
        isDeleted: true,
        ...tenant
    });
    if (!existing) {
        const err = new Error("Trash repair ticket not found.");
        err.status = 404;
        throw err;
    }
    assertDocumentCompany(existing, companyId, "Repair ticket");
    assertCanManageTrashItem(existing, actor, "Repair ticket");
    return trash.permanentDelete(id, companyId, actor);
};

const bulkDeleteRepairTickets = (
    payload,
    actorId,
    companyId = null,
    actor = null
) =>
    trash.bulkSoftDelete(
        payload,
        actorId,
        companyId,
        actor || { _id: actorId }
    );
const bulkRestoreRepairTickets = (
    payload,
    actorId,
    companyId = null,
    actor = null
) =>
    trash.bulkRestore(
        payload,
        actorId,
        companyId,
        actor || { _id: actorId }
    );
const bulkPermanentDeleteRepairTickets = (
    payload,
    companyId = null,
    actor = null
) => trash.bulkPermanentDelete(payload, companyId, actor);

const getRepairTicketStats = async (
    query = {},
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const match = { ...NOT_DELETED, ...tenant };
    if (query.branchId) match.branchId = toObjectId(query.branchId);
    let trashFilter = { isDeleted: true, ...tenant };
    if (actor) trashFilter = applyOwnTrashFilter(trashFilter, actor);

    const [[rows], trashCount] = await Promise.all([
        RepairTicket.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    pending: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Pending"] }, 1, 0]
                        }
                    },
                    repairing: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Repairing"] }, 1, 0]
                        }
                    },
                    completed: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Completed", "Ready For Pickup", "Delivered"]
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    unpaid: {
                        $sum: {
                            $cond: [{ $eq: ["$paymentStatus", "Unpaid"] }, 1, 0]
                        }
                    },
                    totalValue: { $sum: "$totalAmount" }
                }
            }
        ]),
        RepairTicket.countDocuments(trashFilter)
    ]);

    return {
        ...(rows || {
            total: 0,
            pending: 0,
            repairing: 0,
            completed: 0,
            unpaid: 0,
            totalValue: 0
        }),
        trashCount
    };
};

/**
 * Warranty / lifecycle lookup for repair tickets (existing sold products).
 * Same auth pattern as other repair-ticket routes (no JWT protect).
 */
const lookupImeiWarranty = async (imei, companyId = null) => {
    const raw = String(imei || "").trim();
    if (!raw) {
        const err = new Error("IMEI is required.");
        err.status = 400;
        throw err;
    }

    const tenant = companyFilter(companyId);
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imeiMatch = {
        imei: { $regex: `^${escaped}$`, $options: "i" },
        isDeleted: { $ne: true }
    };

    let item = await ItemTrack.findOne({ ...imeiMatch, ...tenant })
        .populate(
            "productId",
            "name description warrantyType warrantyPeriod companyId"
        )
        .populate("variantId", "sku combinationString attributes barcode")
        .lean();

    // Transition: unstamped tracks owned by this company's product.
    if (!item) {
        item = await ItemTrack.findOne({
            ...imeiMatch,
            $or: [{ companyId: null }, { companyId: { $exists: false } }]
        })
            .populate(
                "productId",
                "name description warrantyType warrantyPeriod companyId"
            )
            .populate("variantId", "sku combinationString attributes barcode")
            .lean();
        const productCompany = item?.productId?.companyId;
        if (
            !item ||
            !productCompany ||
            String(productCompany) !== String(companyId)
        ) {
            const err = new Error("IMEI record not found.");
            err.status = 404;
            throw err;
        }
        await ItemTrack.updateOne(
            { _id: item._id },
            { $set: { companyId } }
        );
        item = { ...item, companyId };
    }

    if (!item) {
        const err = new Error("IMEI record not found.");
        err.status = 404;
        throw err;
    }

    const product = item.productId || {};
    const productWarrantyType = product.warrantyType || "No Warranty";
    const productWarrantyPeriod = Number(product.warrantyPeriod) || 0;
    const now = new Date();
    const isLifetime =
        productWarrantyType === "Lifetime" ||
        (item.warrantyExpiry &&
            new Date(item.warrantyExpiry).getFullYear() >= 9999);

    let isWarrantyValid = false;
    let daysRemaining = 0;
    let warrantyStatus = "None";

    if (isLifetime) {
        isWarrantyValid =
            item.status === "sold" ||
            item.status === "repairing" ||
            !!item.saleInfo?.soldDate;
        daysRemaining = null;
        warrantyStatus = "Lifetime";
    } else if (item.warrantyExpiry) {
        const expiry = new Date(item.warrantyExpiry);
        isWarrantyValid = expiry > now;
        daysRemaining = Math.max(
            0,
            Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))
        );
        warrantyStatus = isWarrantyValid ? "Active" : "Expired";
    } else if (productWarrantyType === "No Warranty") {
        warrantyStatus = "None";
    }

    return {
        itemTrackId: item._id,
        imei: item.imei,
        status: item.status,
        productId: product._id || item.productId,
        productName: product.name || "",
        product: {
            _id: product._id,
            name: product.name || "",
            warrantyType: productWarrantyType,
            warrantyPeriod: productWarrantyPeriod
        },
        variantId: item.variantId?._id || item.variantId || null,
        variantSpecs:
            item.variantId?.combinationString ||
            item.variantId?.attributes ||
            "",
        customerPhone: item.saleInfo?.customerPhone || "",
        soldDate: item.saleInfo?.soldDate || null,
        salesOrderId: item.saleInfo?.orderId || null,
        warrantyType: productWarrantyType,
        warrantyPeriod: productWarrantyPeriod,
        warrantyExpiry: isLifetime ? null : item.warrantyExpiry || null,
        isWarrantyValid,
        daysRemaining,
        warrantyStatus
    };
};

/**
 * Full filtered Repair Ticket Excel export (all matching rows).
 */
const exportRepairTicketsExcel = async (
    query = {},
    companyId = null,
    actor = null
) => {
    const trashMode = isTrashQuery(query);
    const tenant = companyFilter(companyId);
    const filter = trashMode
        ? { isDeleted: true, ...tenant }
        : { ...NOT_DELETED, ...tenant };

    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.customerId && toObjectId(query.customerId)) {
        filter.customerId = toObjectId(query.customerId);
    }
    if (query.status) filter.status = String(query.status).trim();
    if (query.ticketSource) {
        filter.ticketSource = resolveTicketSource(query.ticketSource);
    }
    if (query.paymentMethod) {
        filter.paymentMethod = resolvePaymentMethod(query.paymentMethod);
    }
    if (query.trackingType) {
        filter.trackingType = resolveTrackingType(query.trackingType);
    }

    const search = String(query.search || "").trim();
    if (search) {
        filter.$or = [
            { ticketNumber: { $regex: search, $options: "i" } },
            { repairCode: { $regex: search, $options: "i" } },
            { barcode: { $regex: search, $options: "i" } },
            { customerName: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { serviceDetails: { $regex: search, $options: "i" } },
            { "device.productName": { $regex: search, $options: "i" } },
            { "device.imei1": { $regex: search, $options: "i" } },
            { repairedBy: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const total = await RepairTicket.countDocuments(filter);
    if (total > MAX_EXPORT_REPAIR_TICKETS) {
        throw new AppError(
            `Too many matching repair tickets (${total}). Narrow filters (max ${MAX_EXPORT_REPAIR_TICKETS}).`,
            400
        );
    }

    const tickets =
        total === 0
            ? []
            : await populateTicket(
                  RepairTicket.find(filter).sort(sort)
              ).lean();

    const filename = buildExportFilename(query);
    const buffer = await buildRepairTicketWorkbook({
        tickets,
        meta: {
            exportedAt: new Date(),
            exportedBy:
                [actor?.firstName, actor?.lastName].filter(Boolean).join(" ") ||
                actor?.name ||
                actor?.email ||
                actor?.username ||
                "",
            companyId: companyId ? String(companyId) : "",
            filters: {
                trash: trashMode,
                search: query.search || "",
                status: query.status || "",
                sort: query.sort || "newest"
            }
        }
    });

    await writeActivityLog({
        user: actor,
        companyId,
        activityType: "Export",
        module: "Inventory",
        subModule: "Repair",
        description: `Exported ${tickets.length} repair ticket(s) to Excel (${filename}).`,
        shortDescription: `Repair Excel export (${tickets.length})`,
        referenceType: "System",
        referenceId: null,
        newData: {
            filename,
            ticketCount: tickets.length,
            filters: {
                search: query.search || "",
                status: query.status || "",
                trash: trashMode
            }
        },
        securityLevel: "Medium"
    });

    return { buffer, filename, ticketCount: tickets.length };
};

/**
 * Apply a verified customer payment to a repair ticket (ledger already posted).
 * Additive paidAmount only — never decreases.
 */
const applyPaymentToRepairTicket = async (
    ticketId,
    addPaidMajor,
    companyId,
    actorId = null,
    paymentMethodHint = null
) => {
    const tenant = companyFilter(companyId);
    const doc = await RepairTicket.findOne({
        _id: ticketId,
        ...NOT_DELETED,
        ...tenant,
    });
    if (!doc) {
        throw new AppError("Repair ticket not found.", 404);
    }
    assertDocumentCompany(doc, companyId, "Repair ticket");

    const add = money(addPaidMajor);
    if (add <= 0) {
        throw new AppError("Payment amount must be positive.", 400);
    }

    const nextPaid = money((Number(doc.paidAmount) || 0) + add);
    const total = money(doc.totalAmount);
    if (nextPaid > total + 0.009) {
        throw new AppError("Payment would overpay the repair ticket.", 400);
    }

    const amounts = calcAmounts({
        diagnosisCharge: doc.diagnosisCharge,
        serviceCharge: doc.serviceCharge,
        partsCost: doc.partsCost,
        laborCost: doc.laborCost,
        discount: doc.discount,
        tax: doc.tax,
        otherCharges: doc.otherCharges,
        paidAmount: nextPaid,
    });
    Object.assign(doc, amounts);
    if (paymentMethodHint) {
        doc.paymentMethod = String(paymentMethodHint).trim() || doc.paymentMethod;
    }
    doc.updatedBy = toObjectId(actorId);
    await doc.save();
    return getRepairTicketById(doc._id, companyId);
};

module.exports = {
    createRepairTicket,
    getRepairTickets,
    getRepairTicketById,
    updateRepairTicket,
    updateRepairTicketStatus,
    completeRepairTicket,
    deleteRepairTicket,
    restoreRepairTicket,
    permanentDeleteRepairTicket,
    bulkDeleteRepairTickets,
    bulkRestoreRepairTickets,
    bulkPermanentDeleteRepairTickets,
    getRepairTicketStats,
    lookupImeiWarranty,
    exportRepairTicketsExcel,
    applyPaymentToRepairTicket,
};
