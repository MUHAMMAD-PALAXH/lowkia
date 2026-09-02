const MarketplaceCart = require("../../model/marketplace/cart");
const MarketplaceCartItem = require("../../model/marketplace/cartItem");
const AppError = require("../../utils/appError");
const { MARKETPLACE_LIMITS, NOT_DELETED } = require("../../constants/marketplace");
const {
    resolveMarketplaceLine,
    evaluateAvailability,
} = require("./marketplaceProductService");

const activeCartFilter = (userId) => ({
    userId,
    status: "active",
    ...NOT_DELETED,
});

const getOrCreateCart = async (userId) => {
    let cart = await MarketplaceCart.findOne(activeCartFilter(userId));
    if (cart) return cart;

    const checkedOut = await MarketplaceCart.findOne({
        userId,
        status: "checked_out",
        ...NOT_DELETED,
    });

    if (checkedOut) {
        checkedOut.status = "active";
        checkedOut.checkedOutAt = null;
        checkedOut.itemCount = 0;
        await checkedOut.save();
        return checkedOut;
    }

    return MarketplaceCart.create({ userId, status: "active" });
};

const syncCartItemCount = async (cartId) => {
    const itemCount = await MarketplaceCartItem.countDocuments({
        cartId,
        ...NOT_DELETED,
    });

    await MarketplaceCart.updateOne(
        { _id: cartId },
        { $set: { itemCount } }
    );

    return itemCount;
};

const refreshLineAvailability = async (item) => {
    const productId = item.product?.productId;
    const variantId = item.product?.productVariantId;

    const resolved = await resolveMarketplaceLine({
        productId,
        productVariantId: variantId,
        quantity: item.quantity,
    }).catch(() => null);

    if (!resolved) {
        item.isAvailable = false;
        item.unavailableReason = "Product is no longer available";
        await item.save();
        return {
            ...item.toObject(),
            availableStock: 0,
        };
    }

    item.companyId = resolved.companyId;
    item.seller = resolved.seller;
    item.product = resolved.product;
    item.lineKey = resolved.lineKey;
    item.lineSubtotal = resolved.product.unitPrice * item.quantity;
    item.isAvailable = resolved.isAvailable;
    item.unavailableReason = resolved.unavailableReason;
    await item.save();

    return {
        ...item.toObject(),
        availableStock: resolved.availableStock,
    };
};

const formatCartResponse = async (cart, items = []) => {
    const subtotal = items.reduce(
        (sum, item) => sum + (Number(item.lineSubtotal) || 0),
        0
    );

    const groupMap = new Map();
    for (const item of items) {
        const key = String(item.companyId);
        if (!groupMap.has(key)) {
            groupMap.set(key, {
                companyId: item.companyId,
                seller: item.seller,
                items: [],
                subtotal: 0,
            });
        }
        const group = groupMap.get(key);
        group.items.push(item);
        group.subtotal += Number(item.lineSubtotal) || 0;
    }

    return {
        cart: {
            id: cart._id,
            status: cart.status,
            currency: cart.currency,
            itemCount: cart.itemCount,
            subtotal,
        },
        items,
        groups: [...groupMap.values()],
    };
};

const getCart = async (userId) => {
    const cart = await getOrCreateCart(userId);

    const rawItems = await MarketplaceCartItem.find({
        cartId: cart._id,
        ...NOT_DELETED,
    }).sort({ createdAt: 1 });

    const items = [];
    for (const line of rawItems) {
        items.push(await refreshLineAvailability(line));
    }

    cart.itemCount = items.length;
    return formatCartResponse(cart, items);
};

const addCartItem = async (userId, { productId, productVariantId = null, quantity = 1 }) => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
        throw new AppError("Quantity must be at least 1.", 400);
    }
    if (qty > MARKETPLACE_LIMITS.cartMaxQtyPerLine) {
        throw new AppError(
            `Maximum ${MARKETPLACE_LIMITS.cartMaxQtyPerLine} units per line.`,
            400
        );
    }

    const resolved = await resolveMarketplaceLine({
        productId,
        productVariantId,
        quantity: qty,
    });

    if (!resolved.isAvailable) {
        throw new AppError(resolved.unavailableReason || "Product unavailable.", 400);
    }

    const cart = await getOrCreateCart(userId);

    let existing = await MarketplaceCartItem.findOne({
        cartId: cart._id,
        lineKey: resolved.lineKey,
        ...NOT_DELETED,
    });

    if (!existing) {
        const deleted = await MarketplaceCartItem.findOne({
            cartId: cart._id,
            lineKey: resolved.lineKey,
            isDeleted: true,
        });

        if (deleted) {
            existing = deleted;
            existing.isDeleted = false;
        }
    }

    if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > MARKETPLACE_LIMITS.cartMaxQtyPerLine) {
            throw new AppError(
                `Maximum ${MARKETPLACE_LIMITS.cartMaxQtyPerLine} units per line.`,
                400
            );
        }

        const stockCheck = evaluateAvailability(
            { allowBackorder: resolved.allowBackorder },
            resolved.availableStock,
            newQty
        );
        if (!stockCheck.isAvailable) {
            throw new AppError(stockCheck.reason || "Insufficient stock.", 400);
        }

        existing.quantity = newQty;
        existing.companyId = resolved.companyId;
        existing.seller = resolved.seller;
        existing.product = resolved.product;
        existing.lineSubtotal = resolved.product.unitPrice * newQty;
        existing.isAvailable = true;
        existing.unavailableReason = "";
        await existing.save();
    } else {
        const lineCount = await MarketplaceCartItem.countDocuments({
            cartId: cart._id,
            ...NOT_DELETED,
        });

        if (lineCount >= MARKETPLACE_LIMITS.cartMaxItems) {
            throw new AppError(
                `Cart cannot exceed ${MARKETPLACE_LIMITS.cartMaxItems} items.`,
                400
            );
        }

        await MarketplaceCartItem.create({
            cartId: cart._id,
            userId,
            companyId: resolved.companyId,
            seller: resolved.seller,
            product: resolved.product,
            quantity: qty,
            lineSubtotal: resolved.product.unitPrice * qty,
            lineKey: resolved.lineKey,
            isAvailable: true,
            unavailableReason: "",
        });
    }

    await syncCartItemCount(cart._id);
    return getCart(userId);
};

const updateCartItem = async (userId, itemId, { quantity }) => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
        throw new AppError("Quantity must be at least 1.", 400);
    }
    if (qty > MARKETPLACE_LIMITS.cartMaxQtyPerLine) {
        throw new AppError(
            `Maximum ${MARKETPLACE_LIMITS.cartMaxQtyPerLine} units per line.`,
            400
        );
    }

    const cart = await getOrCreateCart(userId);
    const item = await MarketplaceCartItem.findOne({
        _id: itemId,
        cartId: cart._id,
        userId,
        ...NOT_DELETED,
    });

    if (!item) throw new AppError("Cart item not found.", 404);

    const resolved = await resolveMarketplaceLine({
        productId: item.product.productId,
        productVariantId: item.product.productVariantId,
        quantity: qty,
    });

    if (!resolved.isAvailable) {
        throw new AppError(resolved.unavailableReason || "Product unavailable.", 400);
    }

    item.quantity = qty;
    item.companyId = resolved.companyId;
    item.seller = resolved.seller;
    item.product = resolved.product;
    item.lineSubtotal = resolved.product.unitPrice * qty;
    item.isAvailable = true;
    item.unavailableReason = "";
    await item.save();

    return getCart(userId);
};

const removeCartItem = async (userId, itemId) => {
    const cart = await getOrCreateCart(userId);
    const item = await MarketplaceCartItem.findOne({
        _id: itemId,
        cartId: cart._id,
        userId,
        ...NOT_DELETED,
    });

    if (!item) throw new AppError("Cart item not found.", 404);

    item.isDeleted = true;
    await item.save();
    await syncCartItemCount(cart._id);

    return getCart(userId);
};

const clearCart = async (userId) => {
    const cart = await getOrCreateCart(userId);

    await MarketplaceCartItem.updateMany(
        { cartId: cart._id, ...NOT_DELETED },
        { $set: { isDeleted: true } }
    );

    await syncCartItemCount(cart._id);
    return getCart(userId);
};

module.exports = {
    getOrCreateCart,
    getCart,
    addCartItem,
    updateCartItem,
    removeCartItem,
    clearCart,
};
