const mongoose = require("mongoose");
const ShippingRule = require("../../model/marketplace/shippingRule");
const AppError = require("../../utils/appError");
const { NOT_DELETED, SHIPPING_RULE_TYPES } = require("../../constants/marketplace");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");
const { assertDocumentCompany } = require("../companyService");
const cartService = require("./cartService");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const normalizeLocation = (value = "") => String(value).trim().toLowerCase();

const matchZone = (zones = [], district = "", city = "") => {
    const d = normalizeLocation(district);
    const c = normalizeLocation(city);

    if (d && c) {
        const exact = zones.find(
            (zone) =>
                normalizeLocation(zone.district) === d &&
                normalizeLocation(zone.city) === c
        );
        if (exact) return exact;
    }

    if (d) {
        const byDistrict = zones.find(
            (zone) =>
                normalizeLocation(zone.district) === d &&
                !normalizeLocation(zone.city)
        );
        if (byDistrict) return byDistrict;
    }

    if (c) {
        const byCity = zones.find(
            (zone) =>
                !normalizeLocation(zone.district) &&
                normalizeLocation(zone.city) === c
        );
        if (byCity) return byCity;
    }

    return (
        zones.find(
            (zone) =>
                !normalizeLocation(zone.district) && !normalizeLocation(zone.city)
        ) || null
    );
};

const validateRulePayload = (payload = {}, isUpdate = false) => {
    const ruleType = payload.ruleType;
    if (!isUpdate && !ruleType) {
        throw new AppError("ruleType is required.", 400);
    }
    if (ruleType && !SHIPPING_RULE_TYPES.includes(ruleType)) {
        throw new AppError("Invalid ruleType.", 400);
    }

    if (ruleType === "free_threshold") {
        const threshold = Number(payload.freeShippingThreshold);
        if (!Number.isFinite(threshold) || threshold < 0) {
            throw new AppError(
                "freeShippingThreshold is required for free_threshold rules.",
                400
            );
        }
    }

    if (ruleType === "zone") {
        const zones = Array.isArray(payload.zones) ? payload.zones : null;
        if (!zones?.length) {
            throw new AppError("At least one zone is required for zone rules.", 400);
        }
        for (const zone of zones) {
            const fee = Number(zone.fee);
            if (!Number.isFinite(fee) || fee < 0) {
                throw new AppError("Each zone must have a valid fee.", 400);
            }
        }
    }
};

const calculateShippingFee = (rule, subtotal = 0, address = {}) => {
    if (!rule) {
        return {
            fee: 0,
            estimatedDeliveryDays: null,
            ruleId: null,
            ruleName: null,
            ruleType: null,
            matchedZone: null,
            freeShippingApplied: false,
        };
    }

    const amount = Math.max(Number(subtotal) || 0, 0);
    const base = {
        ruleId: rule._id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedZone: null,
        freeShippingApplied: false,
    };

    switch (rule.ruleType) {
        case "flat":
            return {
                ...base,
                fee: Math.max(Number(rule.flatFee) || 0, 0),
                estimatedDeliveryDays: rule.estimatedDeliveryDays,
            };

        case "free_threshold": {
            const threshold = Number(rule.freeShippingThreshold) || 0;
            const belowThresholdFee = Math.max(Number(rule.flatFee) || 0, 0);
            const isFree = amount >= threshold;
            return {
                ...base,
                fee: isFree ? 0 : belowThresholdFee,
                estimatedDeliveryDays: rule.estimatedDeliveryDays,
                freeShippingApplied: isFree,
                freeShippingThreshold: threshold,
            };
        }

        case "zone": {
            const zone = matchZone(rule.zones, address.district, address.city);
            const fee = zone
                ? Math.max(Number(zone.fee) || 0, 0)
                : Math.max(Number(rule.flatFee) || 0, 0);
            return {
                ...base,
                fee,
                estimatedDeliveryDays:
                    zone?.estimatedDays ?? rule.estimatedDeliveryDays,
                matchedZone: zone
                    ? {
                          district: zone.district || "",
                          city: zone.city || "",
                          fee: zone.fee,
                          estimatedDays: zone.estimatedDays,
                      }
                    : null,
            };
        }

        default:
            return {
                ...base,
                fee: 0,
                estimatedDeliveryDays: rule.estimatedDeliveryDays,
            };
    }
};

const resolveShippingRule = async (companyId, ruleId = null) => {
    const tenant = companyFilter(companyId);
    const baseFilter = {
        ...tenant,
        isActive: true,
        ...NOT_DELETED,
    };

    if (ruleId) {
        const rule = await ShippingRule.findOne({
            _id: toObjectId(ruleId),
            ...baseFilter,
        }).lean();
        if (!rule) {
            throw new AppError("Shipping rule not found.", 404);
        }
        return rule;
    }

    let rule = await ShippingRule.findOne({
        ...baseFilter,
        isDefault: true,
    })
        .sort({ priority: -1, createdAt: -1 })
        .lean();

    if (!rule) {
        rule = await ShippingRule.findOne(baseFilter)
            .sort({ priority: -1, createdAt: -1 })
            .lean();
    }

    return rule;
};

const previewCartShipping = async (userId, address = {}) => {
    const cartData = await cartService.getCart(userId);

    if (!cartData.groups?.length) {
        return {
            cartId: cartData.cart.id,
            currency: cartData.cart.currency,
            address: {
                city: address.city || "",
                district: address.district || "",
            },
            subtotal: 0,
            totalShipping: 0,
            grandTotal: 0,
            companies: [],
        };
    }

    const companies = [];
    let totalShipping = 0;

    for (const group of cartData.groups) {
        const rule = await resolveShippingRule(group.companyId);
        const calc = calculateShippingFee(rule, group.subtotal, address);

        totalShipping += calc.fee;
        companies.push({
            companyId: group.companyId,
            seller: group.seller,
            itemCount: group.items.length,
            subtotal: group.subtotal,
            shippingFee: calc.fee,
            shippingRuleId: calc.ruleId,
            shippingRuleName: calc.ruleName,
            ruleType: calc.ruleType,
            estimatedDeliveryDays: calc.estimatedDeliveryDays,
            freeShippingApplied: calc.freeShippingApplied || false,
            freeShippingThreshold: calc.freeShippingThreshold ?? null,
            matchedZone: calc.matchedZone,
        });
    }

    const subtotal = cartData.cart.subtotal || 0;

    return {
        cartId: cartData.cart.id,
        currency: cartData.cart.currency,
        address: {
            city: address.city || "",
            district: address.district || "",
        },
        subtotal,
        totalShipping,
        grandTotal: subtotal + totalShipping,
        companies,
    };
};

const listShippingRules = async (query = {}, companyId = null) => {
    const tenant = companyFilter(companyId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { ...tenant, ...NOT_DELETED };
    if (query.isActive !== undefined) {
        filter.isActive = query.isActive === "true" || query.isActive === true;
    }
    if (query.ruleType) filter.ruleType = query.ruleType;

    const [data, total] = await Promise.all([
        ShippingRule.find(filter)
            .sort({ isDefault: -1, priority: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ShippingRule.countDocuments(filter),
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

const getShippingRuleById = async (id, companyId = null) => {
    const tenant = companyFilter(companyId);
    const rule = await ShippingRule.findOne({
        _id: toObjectId(id),
        ...tenant,
        ...NOT_DELETED,
    }).lean();

    if (!rule) throw new AppError("Shipping rule not found.", 404);
    assertDocumentCompany(rule, companyId, "Shipping rule");
    return rule;
};

const unsetOtherDefaults = async (companyId, exceptId = null) => {
    const filter = {
        ...companyFilter(companyId),
        isDefault: true,
        ...NOT_DELETED,
    };
    if (exceptId) filter._id = { $ne: exceptId };
    await ShippingRule.updateMany(filter, { $set: { isDefault: false } });
};

const createShippingRule = async (payload = {}, actorId = null, companyId = null) => {
    companyFilter(companyId);
    validateRulePayload(payload, false);

    const name = String(payload.name || "").trim();
    if (!name) throw new AppError("Rule name is required.", 400);

    if (payload.isDefault) {
        await unsetOtherDefaults(companyId);
    }

    const doc = await ShippingRule.create(
        stampCompany(
            {
                name,
                ruleType: payload.ruleType || "flat",
                currency: payload.currency || "BDT",
                flatFee: Math.max(Number(payload.flatFee) || 0, 0),
                freeShippingThreshold:
                    payload.freeShippingThreshold === null ||
                    payload.freeShippingThreshold === undefined
                        ? null
                        : Math.max(Number(payload.freeShippingThreshold) || 0, 0),
                zones: Array.isArray(payload.zones) ? payload.zones : [],
                estimatedDeliveryDays: Math.max(
                    Number(payload.estimatedDeliveryDays) || 3,
                    0
                ),
                isDefault: Boolean(payload.isDefault),
                isActive: payload.isActive !== false,
                priority: Number(payload.priority) || 0,
                createdBy: actorId,
                updatedBy: actorId,
            },
            companyId
        )
    );

    return doc.toObject();
};

const updateShippingRule = async (
    id,
    payload = {},
    actorId = null,
    companyId = null
) => {
    const tenant = companyFilter(companyId);
    const rule = await ShippingRule.findOne({
        _id: toObjectId(id),
        ...tenant,
        ...NOT_DELETED,
    });

    if (!rule) throw new AppError("Shipping rule not found.", 404);
    assertDocumentCompany(rule, companyId, "Shipping rule");

    const nextType = payload.ruleType || rule.ruleType;
    validateRulePayload({ ...rule.toObject(), ...payload, ruleType: nextType }, true);

    if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!name) throw new AppError("Rule name cannot be empty.", 400);
        rule.name = name;
    }
    if (payload.ruleType !== undefined) rule.ruleType = payload.ruleType;
    if (payload.currency !== undefined) rule.currency = payload.currency;
    if (payload.flatFee !== undefined) {
        rule.flatFee = Math.max(Number(payload.flatFee) || 0, 0);
    }
    if (payload.freeShippingThreshold !== undefined) {
        rule.freeShippingThreshold =
            payload.freeShippingThreshold === null
                ? null
                : Math.max(Number(payload.freeShippingThreshold) || 0, 0);
    }
    if (payload.zones !== undefined) {
        rule.zones = Array.isArray(payload.zones) ? payload.zones : [];
    }
    if (payload.estimatedDeliveryDays !== undefined) {
        rule.estimatedDeliveryDays = Math.max(
            Number(payload.estimatedDeliveryDays) || 0,
            0
        );
    }
    if (payload.isActive !== undefined) rule.isActive = Boolean(payload.isActive);
    if (payload.priority !== undefined) {
        rule.priority = Number(payload.priority) || 0;
    }
    if (payload.isDefault !== undefined) {
        rule.isDefault = Boolean(payload.isDefault);
        if (rule.isDefault) {
            await unsetOtherDefaults(companyId, rule._id);
        }
    }

    rule.updatedBy = actorId;
    await rule.save();
    return rule.toObject();
};

const deleteShippingRule = async (id, actorId = null, companyId = null) => {
    const tenant = companyFilter(companyId);
    const rule = await ShippingRule.findOne({
        _id: toObjectId(id),
        ...tenant,
        ...NOT_DELETED,
    });

    if (!rule) throw new AppError("Shipping rule not found.", 404);
    assertDocumentCompany(rule, companyId, "Shipping rule");

    rule.isDeleted = true;
    rule.deletedAt = new Date();
    rule.deletedBy = actorId;
    rule.isActive = false;
    rule.isDefault = false;
    rule.updatedBy = actorId;
    await rule.save();

    return rule.toObject();
};

module.exports = {
    normalizeLocation,
    matchZone,
    calculateShippingFee,
    resolveShippingRule,
    previewCartShipping,
    listShippingRules,
    getShippingRuleById,
    createShippingRule,
    updateShippingRule,
    deleteShippingRule,
};
