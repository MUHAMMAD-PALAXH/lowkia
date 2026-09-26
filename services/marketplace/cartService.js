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

/**
 * One MarketplaceCart document per user (userId unique). After checkout the
 * same row is marked checked_out — never insert a second cart (that throws
 * E11000 and surfaces as "A record with this code already exists").
 * Re-open the existing cart with all prior lines soft-deleted / qty 0.
 */
const getOrCreateCart = async (userId) => {
    let cart = await MarketplaceCart.findOne(activeCartFilter(userId));
    if (cart) return cart;

    const existing = await MarketplaceCart.findOne({ userId });
    if (existing) {
        // Ensure no stale active lines survive from a prior checkout race.
        await MarketplaceCartItem.updateMany(
            { cartId: existing._id, isDeleted: { $ne: true } },
            { $set: { isDeleted: true, quantity: 0, lineSubtotal: 0 } }
        );
        existing.status = "active";
        existing.checkedOutAt = null;
        existing.itemCount = 0;
        existing.isDeleted = false;
        existing.deletedAt = null;
        await existing.save();
        return existing;
    }

    try {
        return await MarketplaceCart.create({ userId, status: "active" });
    } catch (err) {
        // Parallel first-add race on unique userId — load the winner.
        if (err && (err.code === 11000 || err.code === "E11000")) {
            cart = await MarketplaceCart.findOne(activeCartFilter(userId));
            if (cart) return cart;
            cart = await MarketplaceCart.findOne({ userId });
            if (cart) {
                cart.status = "active";
                cart.isDeleted = false;
                await cart.save();
                return cart;
            }
        }
        throw err;
    }
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
    const requestedQty = Math.max(Number(item.quantity) || 1, 1);

    const resolved = await resolveMarketplaceLine({
        productId,
        productVariantId: variantId,
        quantity: 1,
        // Never swap variants on refresh — that rewrote lineKey/product and
        // made carts look like a different item was added.
        allowVariantFallback: false,
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

    let qty = requestedQty;
    const stock = Number(resolved.availableStock) || 0;
    if (!resolved.allowBackorder && stock > 0 && qty > stock) {
        // Heal carts inflated by soft-delete restore / duplicate adds.
        qty = stock;
        item.quantity = qty;
    }

    const availability = evaluateAvailability(
        { allowBackorder: resolved.allowBackorder },
        stock,
        qty
    );

    item.companyId = resolved.companyId;
    item.seller = resolved.seller;
    item.product = resolved.product;
    // Keep the stored lineKey unless empty — do not rewrite identity on refresh.
    if (!item.lineKey) item.lineKey = resolved.lineKey;
    item.lineSubtotal = resolved.product.unitPrice * qty;
    item.isAvailable = availability.isAvailable;
    item.unavailableReason = availability.reason;
    await item.save();

    return {
        ...item.toObject(),
        availableStock: stock,
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

/** Fast cart snapshot without per-line stock re-resolve (for mutations). */
const getCartSnapshot = async (userId) => {
    const cart = await getOrCreateCart(userId);
    const items = await MarketplaceCartItem.find({
        cartId: cart._id,
        ...NOT_DELETED,
    })
        .sort({ createdAt: 1 })
        .lean();

    cart.itemCount = items.length;
    return formatCartResponse(cart, items);
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

    // Never auto-swap to another variant on add — that made carts look like
    // "a different product was added" when the requested option was OOS.
    const resolved = await resolveMarketplaceLine({
        productId,
        productVariantId,
        quantity: qty,
        allowVariantFallback: false,
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

    let restoredFromDeleted = false;
    if (!existing) {
        const deleted = await MarketplaceCartItem.findOne({
            cartId: cart._id,
            lineKey: resolved.lineKey,
            isDeleted: true,
        }).sort({ updatedAt: -1 });

        if (deleted) {
            existing = deleted;
            existing.isDeleted = false;
            // Soft-delete leaves the old quantity on the row. Treating a
            // restore as additive (oldQty + qty) inflated carts and blocked
            // adds when stock was 1 ("Only 1 left in stock").
            restoredFromDeleted = true;
        }
    }

    if (existing) {
        const newQty = restoredFromDeleted
            ? qty
            : Number(existing.quantity) + qty;
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
        existing.lineKey = resolved.lineKey;
        existing.lineSubtotal = resolved.product.unitPrice * newQty;
        existing.isAvailable = true;
        existing.unavailableReason = "";
        existing.isDeleted = false;
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

        try {
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
        } catch (err) {
            // Parallel add of the same lineKey — fold into the winner row.
            if (!(err && (err.code === 11000 || err.code === "E11000"))) {
                throw err;
            }
            const raced = await MarketplaceCartItem.findOne({
                cartId: cart._id,
                lineKey: resolved.lineKey,
                ...NOT_DELETED,
            });
            if (!raced) throw err;

            const racedQty = Number(raced.quantity) + qty;
            const stockCheck = evaluateAvailability(
                { allowBackorder: resolved.allowBackorder },
                resolved.availableStock,
                racedQty
            );
            if (!stockCheck.isAvailable) {
                throw new AppError(
                    stockCheck.reason || "Insufficient stock.",
                    400
                );
            }
            raced.quantity = racedQty;
            raced.lineSubtotal = resolved.product.unitPrice * racedQty;
            raced.companyId = resolved.companyId;
            raced.seller = resolved.seller;
            raced.product = resolved.product;
            raced.isAvailable = true;
            raced.unavailableReason = "";
            await raced.save();
        }
    }

    await syncCartItemCount(cart._id);
    return getCartSnapshot(userId);
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
        allowVariantFallback: false,
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

    return getCartSnapshot(userId);
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
    item.quantity = 0;
    item.lineSubtotal = 0;
    await item.save();
    await syncCartItemCount(cart._id);

    return getCartSnapshot(userId);
};

const clearCart = async (userId) => {
    const cart = await getOrCreateCart(userId);

    // Soft-delete AND zero quantity so a later restore cannot revive stale qty.
    await MarketplaceCartItem.updateMany(
        { cartId: cart._id, ...NOT_DELETED },
        { $set: { isDeleted: true, quantity: 0, lineSubtotal: 0 } }
    );

    await syncCartItemCount(cart._id);
    return getCartSnapshot(userId);
};

module.exports = {
    getOrCreateCart,
    getCart,
    addCartItem,
    updateCartItem,
    removeCartItem,
    clearCart,
};
