const {
    formatWorkDate,
    startOfWorkDay
} = require("../utils/timezone");

/**
 * Inclusive list of YYYY-MM-DD work dates between two Date/ISO values.
 */
const eachWorkDate = (startInput, endInput, timezone = "Asia/Dhaka") => {
    const startKey = formatWorkDate(new Date(startInput), timezone);
    const endKey = formatWorkDate(new Date(endInput), timezone);
    if (!startKey || !endKey || startKey > endKey) {
        return startKey ? [startKey] : [];
    }

    const dates = [];
    let cursor = startKey;
    let guard = 0;
    while (cursor <= endKey && guard < 400) {
        dates.push(cursor);
        const nextUtc = new Date(
            startOfWorkDay(cursor, timezone).getTime() + 24 * 60 * 60 * 1000
        );
        cursor = formatWorkDate(nextUtc, timezone);
        guard += 1;
    }
    return dates;
};

module.exports = { eachWorkDate };
