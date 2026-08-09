/**
 * Simple in-memory rate limiter for attendance punch endpoints.
 * Keyed by userId + route. Not shared across instances — good enough for V1.
 * For multi-instance production, swap to Redis later.
 */
const buckets = new Map();

const prune = (key, windowMs) => {
    const now = Date.now();
    const arr = buckets.get(key) || [];
    const fresh = arr.filter((t) => now - t < windowMs);
    buckets.set(key, fresh);
    return fresh;
};

const rateLimit = ({
    windowMs = 60 * 1000,
    max = 20,
    keyPrefix = "rl",
    message = "Too many requests. Please try again shortly."
} = {}) => {
    return (req, res, next) => {
        const userKey = req.user?._id ? String(req.user._id) : req.ip || "anon";
        const key = `${keyPrefix}:${req.path}:${userKey}`;
        const hits = prune(key, windowMs);
        if (hits.length >= max) {
            return res.status(429).json({
                success: false,
                message,
                data: null,
                errors: { retryAfterMs: windowMs }
            });
        }
        hits.push(Date.now());
        buckets.set(key, hits);
        next();
    };
};

/** Punch actions: check-in/out/break — tighter limit */
const punchRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyPrefix: "punch",
    message: "Too many attendance punch attempts. Wait a minute and retry."
});

module.exports = { rateLimit, punchRateLimit };
