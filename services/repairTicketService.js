const RepairTicket = require("../model/repairTicket");
const ItemTrack = require("../model/itemTrack");
const Branch = require("../model/branch");
const { generateRepairTicketCode } = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");

const NOT_DELETED = { isDeleted: { $ne: true } };

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

const createRepairTicket = async (payload = {}, actorId = null) => {
    const branchId = toObjectId(payload.branchId);
    if (!branchId) {
        const err = new Error("Branch is required.");
        err.status = 400;
        throw err;
    }

    const branch = await Branch.findOne({ _id: branchId, ...NOT_DELETED });
    if (!branch) {
        const err = new Error("Branch not found.");
        err.status = 404;
        throw err;
    }

    const customerName = String(payload.customerName || "").trim();
    const phone = String(payload.phone || "").trim();
    if (!customerName || !phone) {
        const err = new Error("Customer name and phone are required.");
        err.status = 400;
        throw err;
    }

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
        const track = await ItemTrack.findOne({
            imei: device.imei1,
            isDeleted: { $ne: true }
        });
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

    const doc = await RepairTicket.create({
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
        customerId: toObjectId(payload.customerId),
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
        ...amounts,
        createdBy
    });

    return populateTicket(RepairTicket.findById(doc._id)).lean();
};

const getRepairTickets = async (query = {}) => {
    const filter = { ...NOT_DELETED };
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
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
            { "device.imei1": { $regex: search, $options: "i" } }
        ];
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        populateTicket(
            RepairTicket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        ).lean(),
        RepairTicket.countDocuments(filter)
    ]);

    return { items, total, page, limit };
};

const getRepairTicketById = async (id) => {
    const doc = await populateTicket(
        RepairTicket.findOne({ _id: id, ...NOT_DELETED })
    ).lean();
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    return doc;
};

const updateRepairTicket = async (id, payload = {}, actorId = null) => {
    const doc = await RepairTicket.findOne({ _id: id, ...NOT_DELETED });
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
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
    return getRepairTicketById(doc._id);
};

const updateRepairTicketStatus = async (id, status, actorId = null) => {
    const doc = await RepairTicket.findOne({ _id: id, ...NOT_DELETED });
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }

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
    return getRepairTicketById(doc._id);
};

const completeRepairTicket = async (id, actorId = null) =>
    updateRepairTicketStatus(id, "Completed", actorId);

const deleteRepairTicket = async (id, actorId = null) => {
    const doc = await RepairTicket.findOne({ _id: id, ...NOT_DELETED });
    if (!doc) {
        const err = new Error("Repair ticket not found.");
        err.status = 404;
        throw err;
    }
    doc.isDeleted = true;
    doc.updatedBy = toObjectId(actorId);
    await doc.save();
    return { id: String(doc._id) };
};

const getRepairTicketStats = async (query = {}) => {
    const match = { ...NOT_DELETED };
    if (query.branchId) match.branchId = toObjectId(query.branchId);

    const [rows] = await RepairTicket.aggregate([
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
    ]);

    return (
        rows || {
            total: 0,
            pending: 0,
            repairing: 0,
            completed: 0,
            unpaid: 0,
            totalValue: 0
        }
    );
};

/**
 * Warranty / lifecycle lookup for repair tickets (existing sold products).
 * Same auth pattern as other repair-ticket routes (no JWT protect).
 */
const lookupImeiWarranty = async (imei) => {
    const raw = String(imei || "").trim();
    if (!raw) {
        const err = new Error("IMEI is required.");
        err.status = 400;
        throw err;
    }

    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const item = await ItemTrack.findOne({
        imei: { $regex: `^${escaped}$`, $options: "i" },
        isDeleted: { $ne: true }
    })
        .populate("productId", "name description warrantyType warrantyPeriod")
        .populate("variantId", "sku combinationString attributes barcode")
        .lean();

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

module.exports = {
    createRepairTicket,
    getRepairTickets,
    getRepairTicketById,
    updateRepairTicket,
    updateRepairTicketStatus,
    completeRepairTicket,
    deleteRepairTicket,
    getRepairTicketStats,
    lookupImeiWarranty
};
