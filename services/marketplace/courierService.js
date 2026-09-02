const mongoose = require("mongoose");
const Courier = require("../../model/marketplace/courier");
const AppError = require("../../utils/appError");
const { NOT_DELETED, COURIER_TYPES } = require("../../constants/marketplace");
const { companyFilter } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../companyService");
const { generateMarketplaceCourierCode } = require("../codeGenerator");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const listCouriers = async (companyId, query = {}) => {
    const tenantId = toObjectId(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {
        isDeleted: { $ne: true },
        $or: [{ companyId: null }, { companyId: tenantId }],
    };

    if (query.isActive !== undefined) {
        filter.isActive = query.isActive === "true" || query.isActive === true;
    }
    if (query.courierType) filter.courierType = query.courierType;

    const [data, total] = await Promise.all([
        Courier.find(filter)
            .sort({ companyId: 1, name: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Courier.countDocuments(filter),
    ]);

    return {
        data,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 0,
        },
    };
};

const getCourierById = async (courierId, companyId) => {
    const courier = await Courier.findOne({
        _id: toObjectId(courierId),
        isDeleted: { $ne: true },
        $or: [{ companyId: null }, { companyId: toObjectId(companyId) }],
    }).lean();

    if (!courier) throw new AppError("Courier not found.", 404);
    if (courier.companyId) {
        assertDocumentCompany(courier, companyId, "Courier");
    }

    return courier;
};

const createCourier = async (payload = {}, actorId = null, companyId = null) => {
    companyFilter(companyId);

    const name = String(payload.name || "").trim();
    if (!name) throw new AppError("Courier name is required.", 400);

    const courierType = payload.courierType || "other";
    if (!COURIER_TYPES.includes(courierType)) {
        throw new AppError("Invalid courier type.", 400);
    }

    const code =
        String(payload.code || "").trim().toUpperCase() ||
        (await generateMarketplaceCourierCode());

    const doc = await Courier.create({
        companyId: toObjectId(companyId),
        code,
        name,
        courierType,
        trackingUrlTemplate: String(payload.trackingUrlTemplate || "").trim(),
        isActive: payload.isActive !== false,
        metadata: payload.metadata || null,
        createdBy: actorId,
        updatedBy: actorId,
    });

    return doc.toObject();
};

const updateCourier = async (courierId, payload = {}, actorId = null, companyId = null) => {
    const courier = await Courier.findOne({
        _id: toObjectId(courierId),
        companyId: toObjectId(companyId),
        isDeleted: { $ne: true },
    });

    if (!courier) throw new AppError("Courier not found.", 404);
    assertDocumentCompany(courier, companyId, "Courier");

    if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!name) throw new AppError("Courier name cannot be empty.", 400);
        courier.name = name;
    }
    if (payload.courierType !== undefined) {
        if (!COURIER_TYPES.includes(payload.courierType)) {
            throw new AppError("Invalid courier type.", 400);
        }
        courier.courierType = payload.courierType;
    }
    if (payload.trackingUrlTemplate !== undefined) {
        courier.trackingUrlTemplate = String(
            payload.trackingUrlTemplate || ""
        ).trim();
    }
    if (payload.isActive !== undefined) {
        courier.isActive = Boolean(payload.isActive);
    }
    if (payload.metadata !== undefined) {
        courier.metadata = payload.metadata;
    }

    courier.updatedBy = actorId;
    await courier.save();
    return courier.toObject();
};

const deleteCourier = async (courierId, actorId = null, companyId = null) => {
    const courier = await Courier.findOne({
        _id: toObjectId(courierId),
        companyId: toObjectId(companyId),
        isDeleted: { $ne: true },
    });

    if (!courier) throw new AppError("Courier not found.", 404);
    assertDocumentCompany(courier, companyId, "Courier");

    courier.isDeleted = true;
    courier.deletedAt = new Date();
    courier.deletedBy = actorId;
    courier.isActive = false;
    courier.updatedBy = actorId;
    await courier.save();

    return courier.toObject();
};

module.exports = {
    listCouriers,
    getCourierById,
    createCourier,
    updateCourier,
    deleteCourier,
};
