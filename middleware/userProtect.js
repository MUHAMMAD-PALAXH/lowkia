// middleware/userProtect.js — marketplace consumer (User) JWT auth

const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../model/user");

const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Not authorized - no token provided",
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select("-password");

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Not authorized - user not found",
            });
        }

        next();
    } catch (error) {
        console.error("User token verification error:", error.message);
        return res.status(401).json({
            success: false,
            message: "Not authorized - invalid token",
        });
    }
});

/** Optional auth — attaches user when token present, continues as guest otherwise. */
const optionalProtect = asyncHandler(async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }
    if (!token) {
        req.user = null;
        return next();
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select("-password");
    } catch {
        req.user = null;
    }
    next();
});

module.exports = { protect, optionalProtect };
