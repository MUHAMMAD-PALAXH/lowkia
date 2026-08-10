const express = require("express");
const asyncHandler = require("express-async-handler");
const router = express.Router();
const dotenv = require("dotenv");
dotenv.config();

const { protect } = require("../middleware/auth");

/**
 * Legacy storefront payment helpers — DISABLED for security.
 * Use authenticated /api/customer-payments/checkout instead.
 * Creating Stripe PaymentIntents without auth / SO binding is forbidden.
 */
router.post(
    "/stripe",
    protect,
    asyncHandler(async (_req, res) => {
        return res.status(410).json({
            success: false,
            error: true,
            message:
                "Legacy /payment/stripe is retired. Use POST /api/customer-payments/checkout with a sales order.",
            data: null,
        });
    })
);

router.post(
    "/razorpay",
    protect,
    asyncHandler(async (_req, res) => {
        return res.status(410).json({
            success: false,
            error: true,
            message:
                "Legacy /payment/razorpay is retired. Configure provider via customer-payments.",
            data: null,
        });
    })
);

module.exports = router;
