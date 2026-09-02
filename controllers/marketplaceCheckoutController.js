const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../model/user");
const { success } = require("../utils/apiResponse");
const checkoutService = require("../services/marketplace/checkoutService");

exports.previewCheckout = asyncHandler(async (req, res) => {
    const data = await checkoutService.previewCheckout(req.user._id, req.body);
    return success(res, "Checkout preview calculated.", data);
});

exports.placeCheckout = asyncHandler(async (req, res) => {
    const data = await checkoutService.placeCheckout(req.user._id, req.body);
    return success(res, "Order placed successfully.", data, 201);
});

exports.guestPlaceCheckout = asyncHandler(async (req, res) => {
    const data = await checkoutService.guestPlaceCheckout(req.body);
    const email = String(req.body?.guest?.email || "").trim().toLowerCase();
    const user = email ? await User.findOne({ email }) : null;
    const token =
        user && process.env.JWT_SECRET
            ? jwt.sign(
                  { id: user._id, email: user.email },
                  process.env.JWT_SECRET,
                  { expiresIn: "7d" }
              )
            : null;

    return res.status(201).json({
        success: true,
        message: "Guest order placed successfully.",
        data,
        token,
        errors: null,
    });
});
