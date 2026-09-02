const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const cartService = require("../services/marketplace/cartService");

exports.getCart = asyncHandler(async (req, res) => {
    const data = await cartService.getCart(req.user._id);
    return success(res, "Cart retrieved", data);
});

exports.addCartItem = asyncHandler(async (req, res) => {
    const data = await cartService.addCartItem(req.user._id, req.body);
    return success(res, "Item added to cart", data, 201);
});

exports.updateCartItem = asyncHandler(async (req, res) => {
    const data = await cartService.updateCartItem(
        req.user._id,
        req.params.itemId,
        req.body
    );
    return success(res, "Cart item updated", data);
});

exports.removeCartItem = asyncHandler(async (req, res) => {
    const data = await cartService.removeCartItem(
        req.user._id,
        req.params.itemId
    );
    return success(res, "Cart item removed", data);
});

exports.clearCart = asyncHandler(async (req, res) => {
    const data = await cartService.clearCart(req.user._id);
    return success(res, "Cart cleared", data);
});
