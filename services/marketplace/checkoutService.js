const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../../model/user");
const CustomerAddress = require("../../model/marketplace/customerAddress");
const MarketplaceCart = require("../../model/marketplace/cart");
const MarketplaceCartItem = require("../../model/marketplace/cartItem");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const AppError = require("../../utils/appError");
const { MARKETPLACE_LIMITS, NOT_DELETED } = require("../../constants/marketplace");
const {
    generateMasterOrderCode,
    generateCompanyOrderCode,
} = require("../codeGenerator");
const cartService = require("./cartService");
const {
    calculateShippingFee,
    resolveShippingRule,
} = require("./shippingRuleService");
const { notifyOrderPlaced } = require("./marketplaceNotificationService");
const { getCustomerOrderDetail } = require("./marketplaceOrderService");
const { auditMarketplaceAction } = require("./marketplaceAuditService");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const snapshotFromAddress = (address = {}) => ({
    recipientName: String(address.recipientName || "").trim(),
    phone: String(address.phone || "").trim(),
    addressLine: String(address.addressLine || "").trim(),
    area: String(address.area || "").trim(),
    city: String(address.city || "").trim(),
    district: String(address.district || "").trim(),
    postalCode: String(address.postalCode || "").trim(),
    country: String(address.country || "BD")
        .trim()
        .toUpperCase(),
    deliveryInstructions: String(address.deliveryInstructions || "").trim(),
});

const validateShippingAddress = (address = {}) => {
    const snapshot = snapshotFromAddress(address);

    if (!snapshot.recipientName) {
        throw new AppError("Recipient name is required.", 400);
    }
    if (!snapshot.phone) {
        throw new AppError("Phone number is required.", 400);
    }
    if (!snapshot.addressLine) {
        throw new AppError("Address line is required.", 400);
    }
    if (snapshot.addressLine.length > MARKETPLACE_LIMITS.addressLineMax) {
        throw new AppError("Address line is too long.", 400);
    }
    if (!snapshot.city) {
        throw new AppError("City is required.", 400);
    }
    if (snapshot.deliveryInstructions.length > MARKETPLACE_LIMITS.deliveryInstructionsMax) {
        throw new AppError("Delivery instructions are too long.", 400);
    }

    return snapshot;
};

const resolveShippingAddress = async (userId, payload = {}) => {
    const addressId = toObjectId(payload.customerAddressId);
    if (addressId) {
        const saved = await CustomerAddress.findOne({
            _id: addressId,
            userId,
            ...NOT_DELETED,
        }).lean();

        if (!saved) {
            throw new AppError("Saved address not found.", 404);
        }

        return snapshotFromAddress(saved);
    }

    if (!payload.shippingAddress) {
        throw new AppError("shippingAddress or customerAddressId is required.", 400);
    }

    return validateShippingAddress(payload.shippingAddress);
};

const formatCheckoutLine = (item) => ({
    cartItemId: item._id,
    companyId: item.companyId,
    seller: item.seller,
    product: item.product,
    quantity: item.quantity,
    unitPrice: item.product?.unitPrice || 0,
    lineSubtotal: item.lineSubtotal,
    isAvailable: item.isAvailable,
    unavailableReason: item.unavailableReason || "",
    availableStock: item.availableStock ?? null,
});

const buildTotals = (subtotal, discount = 0, shippingFee = 0, tax = 0) => {
    const safeSubtotal = Math.max(Number(subtotal) || 0, 0);
    const safeDiscount = Math.max(Number(discount) || 0, 0);
    const safeShipping = Math.max(Number(shippingFee) || 0, 0);
    const safeTax = Math.max(Number(tax) || 0, 0);

    return {
        subtotal: safeSubtotal,
        discount: safeDiscount,
        shippingFee: safeShipping,
        tax: safeTax,
        total: safeSubtotal - safeDiscount + safeShipping + safeTax,
    };
};

const addEstimatedDeliveryAt = (days) => {
    const offset = Math.max(Number(days) || 0, 0);
    if (!offset) return null;
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date;
};

const buildCheckoutContext = async (userId, payload = {}) => {
    const shippingAddress = await resolveShippingAddress(userId, payload);
    const cartData = await cartService.getCart(userId);

    if (!cartData.items?.length) {
        throw new AppError("Cart is empty.", 400);
    }

    const unavailableItems = cartData.items.filter((item) => !item.isAvailable);
    if (unavailableItems.length) {
        throw new AppError("Some cart items are unavailable.", 400, {
            unavailableItems: unavailableItems.map((item) => ({
                cartItemId: item._id,
                productName: item.product?.productName,
                reason: item.unavailableReason || "Unavailable",
            })),
        });
    }

    const customerNote = String(payload.customerNote || "").trim();
    if (customerNote.length > MARKETPLACE_LIMITS.noteMax) {
        throw new AppError("Customer note is too long.", 400);
    }

    const addressForShipping = {
        city: shippingAddress.city,
        district: shippingAddress.district,
    };

    const companyOrders = [];
    let merchandiseSubtotal = 0;
    let totalShipping = 0;

    for (const group of cartData.groups) {
        const rule = await resolveShippingRule(group.companyId);
        const shipping = calculateShippingFee(
            rule,
            group.subtotal,
            addressForShipping
        );

        merchandiseSubtotal += group.subtotal;
        totalShipping += shipping.fee;

        companyOrders.push({
            companyId: group.companyId,
            seller: group.seller,
            itemCount: group.items.length,
            items: group.items.map(formatCheckoutLine),
            shippingRuleId: shipping.ruleId,
            shippingRuleName: shipping.ruleName,
            ruleType: shipping.ruleType,
            estimatedDeliveryDays: shipping.estimatedDeliveryDays,
            freeShippingApplied: shipping.freeShippingApplied || false,
            matchedZone: shipping.matchedZone,
            totals: buildTotals(group.subtotal, 0, shipping.fee, 0),
        });
    }

    const totals = buildTotals(merchandiseSubtotal, 0, totalShipping, 0);

    return {
        cartData,
        shippingAddress,
        customerNote,
        companyOrders,
        totals,
    };
};

const formatPlacedOrderResponse = async (masterOrderId, userId) =>
    getCustomerOrderDetail(masterOrderId, userId);

/**
 * Checkout preview — groups cart by company, applies shipping, no persistence.
 */
const previewCheckout = async (userId, payload = {}) => {
    const context = await buildCheckoutContext(userId, payload);

    return {
        cartId: context.cartData.cart.id,
        currency: context.cartData.cart.currency,
        shippingAddress: context.shippingAddress,
        customerNote: context.customerNote,
        companyOrderCount: context.companyOrders.length,
        companyOrders: context.companyOrders,
        totals: context.totals,
        canCheckout: true,
    };
};

/**
 * Place checkout — persists MasterOrder, CompanyOrders, and line items in a transaction.
 */
const placeCheckout = async (userId, payload = {}) => {
    const idempotencyKey = String(payload.idempotencyKey || "").trim();

    if (idempotencyKey) {
        const existing = await MasterOrder.findOne({
            userId,
            idempotencyKey,
            ...NOT_DELETED,
        }).lean();

        if (existing) {
            return formatPlacedOrderResponse(existing._id, userId);
        }
    }

    const context = await buildCheckoutContext(userId, payload);
    const { cartData, shippingAddress, customerNote, companyOrders, totals } =
        context;

    const activeCart = await MarketplaceCart.findOne({
        _id: cartData.cart.id,
        userId,
        status: "active",
        ...NOT_DELETED,
    });

    if (!activeCart) {
        throw new AppError("No active cart available for checkout.", 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const orderNumber = await generateMasterOrderCode({ session });
        const placedAt = new Date();

        const [masterOrder] = await MasterOrder.create(
            [
                {
                    orderNumber,
                    userId,
                    status: "pending",
                    paymentStatus: "pending",
                    currency: cartData.cart.currency || "BDT",
                    totals,
                    companyOrderCount: companyOrders.length,
                    shippingAddress,
                    customerNote,
                    placedAt,
                    ...(idempotencyKey ? { idempotencyKey } : {}),
                },
            ],
            { session }
        );

        const createdCompanyOrders = [];

        for (const preview of companyOrders) {
            const companyOrderNumber = await generateCompanyOrderCode({ session });
            const estimatedDeliveryAt = addEstimatedDeliveryAt(
                preview.estimatedDeliveryDays
            );

            const [companyOrder] = await CompanyOrder.create(
                [
                    {
                        orderNumber: companyOrderNumber,
                        masterOrderId: masterOrder._id,
                        userId,
                        companyId: preview.companyId,
                        seller: preview.seller,
                        status: "pending",
                        currency: cartData.cart.currency || "BDT",
                        totals: preview.totals,
                        itemCount: preview.itemCount,
                        shippingAddress,
                        shippingRuleId: preview.shippingRuleId || null,
                        estimatedDeliveryAt,
                    },
                ],
                { session }
            );

            const lineDocs = preview.items.map((line) => ({
                masterOrderId: masterOrder._id,
                companyOrderId: companyOrder._id,
                userId,
                companyId: preview.companyId,
                seller: preview.seller,
                product: line.product,
                quantity: line.quantity,
                lineSubtotal: line.lineSubtotal,
                discountAmount: 0,
            }));

            if (lineDocs.length) {
                await MarketplaceOrderItem.insertMany(lineDocs, { session });
            }

            createdCompanyOrders.push({
                id: companyOrder._id,
                orderNumber: companyOrder.orderNumber,
                companyId: companyOrder.companyId,
                seller: companyOrder.seller,
                status: companyOrder.status,
                totals: companyOrder.totals,
                itemCount: companyOrder.itemCount,
                shippingRuleId: companyOrder.shippingRuleId,
                estimatedDeliveryAt: companyOrder.estimatedDeliveryAt,
                items: lineDocs,
            });
        }

        activeCart.status = "checked_out";
        activeCart.checkedOutAt = placedAt;
        activeCart.itemCount = 0;
        await activeCart.save({ session });

        await MarketplaceCartItem.updateMany(
            { cartId: activeCart._id, ...NOT_DELETED },
            { $set: { isDeleted: true } },
            { session }
        );

        await session.commitTransaction();

        void notifyOrderPlaced({
            userId,
            masterOrder,
            companyOrderCount: companyOrders.length,
        });
        void auditMarketplaceAction({
            actor: { _id: userId, role: "customer" },
            activityType: "Create",
            subModule: "Checkout",
            description: `Marketplace order ${masterOrder.orderNumber} placed.`,
            referenceType: "MasterOrder",
            referenceId: masterOrder._id,
            newData: {
                orderNumber: masterOrder.orderNumber,
                companyOrderCount: companyOrders.length,
                grandTotal: masterOrder.totals?.grandTotal,
            },
            securityLevel: "High",
        });

        return {
            masterOrder: {
                id: masterOrder._id,
                orderNumber: masterOrder.orderNumber,
                status: masterOrder.status,
                paymentStatus: masterOrder.paymentStatus,
                currency: masterOrder.currency,
                totals: masterOrder.totals,
                shippingAddress: masterOrder.shippingAddress,
                customerNote: masterOrder.customerNote,
                companyOrderCount: masterOrder.companyOrderCount,
                placedAt: masterOrder.placedAt,
                createdAt: masterOrder.createdAt,
            },
            companyOrders: createdCompanyOrders,
        };
    } catch (error) {
        await session.abortTransaction();

        if (error?.code === 11000 && idempotencyKey) {
            const existing = await MasterOrder.findOne({
                userId,
                idempotencyKey,
                ...NOT_DELETED,
            }).lean();
            if (existing) {
                return formatPlacedOrderResponse(existing._id, userId);
            }
        }

        throw error;
    } finally {
        session.endSession();
    }
};

const resolveGuestUser = async (guest = {}) => {
    const email = String(guest.email || "").trim().toLowerCase();
    if (!email) {
        throw new AppError("Guest email is required.", 400);
    }

    let user = await User.findOne({ email });
    if (!user) {
        user = await User.create({
            firstName: String(guest.firstName || "Guest").trim(),
            lastName: String(guest.lastName || "Customer").trim(),
            email,
            password: crypto.randomBytes(24).toString("hex"),
            isVerified: true,
        });
    }

    return user;
};

const guestPlaceCheckout = async (payload = {}) => {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
        throw new AppError("At least one checkout item is required.", 400);
    }

    const user = await resolveGuestUser(payload.guest || {});
    await cartService.clearCart(user._id);

    for (const item of items) {
        await cartService.addCartItem(user._id, {
            productId: item.productId,
            productVariantId: item.productVariantId || null,
            quantity: Number(item.quantity) || 1,
        });
    }

    return placeCheckout(user._id, {
        shippingAddress: payload.shippingAddress,
        customerNote: payload.customerNote,
        idempotencyKey: payload.idempotencyKey,
    });
};

module.exports = {
    snapshotFromAddress,
    validateShippingAddress,
    resolveShippingAddress,
    buildTotals,
    previewCheckout,
    placeCheckout,
    guestPlaceCheckout,
    formatPlacedOrderResponse,
};
