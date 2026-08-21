const assert = require("assert");
const { _test } = require("../../services/subscriptionService");

exports.monthly_interval_adds_one_month = () => {
    const start = new Date("2026-01-15T12:00:00.000Z");
    const end = _test.addInterval(start, "monthly");
    assert.strictEqual(end.getUTCMonth(), 1); // Feb
    assert.strictEqual(end.getUTCFullYear(), 2026);
};

exports.yearly_interval_adds_one_year = () => {
    const start = new Date("2026-01-15T12:00:00.000Z");
    const end = _test.addInterval(start, "yearly");
    assert.strictEqual(end.getUTCFullYear(), 2027);
};

exports.trial_days = () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = _test.addDays(start, 14);
    assert.strictEqual(end.toISOString().slice(0, 10), "2026-01-15");
};
