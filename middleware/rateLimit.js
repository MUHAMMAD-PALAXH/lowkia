const rateBuckets = new Map();

/**
 * Simple in-memory rate limit (per IP + route key).
 * Good enough for single-node ERP; replace with Redis if you scale out.
 */
const rateLimit = ({
    windowMs = 60_000,
    max = 60,
    keyPrefix = "rl",
} = {}) => {
    return (req, res, next) => {
        const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
        const key = `${keyPrefix}:${ip}:${req.baseUrl}${req.path}`;
        const now = Date.now();
        let bucket = rateBuckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            rateBuckets.set(key, bucket);
        }
        bucket.count += 1;
        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader(
            "X-RateLimit-Remaining",
            String(Math.max(0, max - bucket.count))
        );
        if (bucket.count > max) {
            return res.status(429).json({
                success: false,
                message: "Too many requests. Slow down and try again.",
                data: null,
                errors: null,
            });
        }
        next();
    };
};

// Opportunistic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets.entries()) {
        if (now > bucket.resetAt) rateBuckets.delete(key);
    }
}, 120_000).unref?.();

module.exports = { rateLimit };
