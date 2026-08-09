/**
 * Company-timezone helpers for attendance day boundaries.
 * Timestamps are stored in UTC; business "today" uses Settings.timezone.
 */

const { DateTime } = (() => {
    try {
        return require("luxon");
    } catch (_) {
        return { DateTime: null };
    }
})();

/**
 * Fallback without luxon: approximate using Intl parts.
 * Prefer installing luxon for production night-shift math (Phase 2).
 */
const getZonedParts = (date, timeZone) => {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "long"
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const p of parts) {
        if (p.type !== "literal") map[p.type] = p.value;
    }
    // hour12:false can still yield "24" in some engines
    let hour = Number(map.hour);
    if (hour === 24) hour = 0;
    return {
        year: Number(map.year),
        month: Number(map.month),
        day: Number(map.day),
        hour,
        minute: Number(map.minute),
        second: Number(map.second),
        weekday: map.weekday
    };
};

const pad = (n) => String(n).padStart(2, "0");

/** YYYY-MM-DD in company timezone */
const formatWorkDate = (date = new Date(), timeZone = "Asia/Dhaka") => {
    if (DateTime) {
        return DateTime.fromJSDate(date, { zone: "utc" })
            .setZone(timeZone)
            .toFormat("yyyy-MM-dd");
    }
    const p = getZonedParts(date, timeZone);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** Long weekday name in company timezone (e.g. Friday) */
const formatWeekday = (date = new Date(), timeZone = "Asia/Dhaka") => {
    if (DateTime) {
        return DateTime.fromJSDate(date, { zone: "utc" })
            .setZone(timeZone)
            .toFormat("cccc");
    }
    return getZonedParts(date, timeZone).weekday;
};

/**
 * Start of workday (00:00:00.000) in company TZ, returned as UTC Date.
 */
const startOfWorkDay = (workDateStr, timeZone = "Asia/Dhaka") => {
    if (DateTime) {
        return DateTime.fromISO(`${workDateStr}T00:00:00`, {
            zone: timeZone
        })
            .toUTC()
            .toJSDate();
    }
    // Approximate: treat workDate as local components then use Date.UTC offset via formatter inverse
    const [y, m, d] = workDateStr.split("-").map(Number);
    // Build a UTC guess then adjust — for Asia/Dhaka (UTC+6) midnight local = 18:00 previous UTC
    // Without luxon this is imperfect for DST zones; Phase 2 should depend on luxon.
    const probe = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const p = getZonedParts(probe, timeZone);
    const desired = `${y}-${pad(m)}-${pad(d)}`;
    const got = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    let ms = probe.getTime();
    // nudge until local date matches
    for (let i = 0; i < 48 && got !== desired; i++) {
        const deltaDays =
            Date.UTC(y, m - 1, d) -
            Date.UTC(p.year, p.month - 1, p.day);
        ms += deltaDays;
        const np = getZonedParts(new Date(ms), timeZone);
        Object.assign(p, np);
        if (
            `${np.year}-${pad(np.month)}-${pad(np.day)}` === desired &&
            np.hour === 0 &&
            np.minute === 0
        ) {
            break;
        }
        // fine-tune hours
        ms -= (np.hour * 3600 + np.minute * 60 + np.second) * 1000;
    }
    return new Date(ms);
};

/**
 * Combine work date + "HH:mm" shift time into a UTC Date in company TZ.
 * For night shifts, end may be next calendar day (caller sets nextDay=true).
 */
const combineWorkDateAndTime = (
    workDateStr,
    hhmm,
    timeZone = "Asia/Dhaka",
    { nextDay = false } = {}
) => {
    const [hh, mm] = String(hhmm || "00:00")
        .split(":")
        .map((x) => Number(x) || 0);
    if (DateTime) {
        let dt = DateTime.fromISO(
            `${workDateStr}T${pad(hh)}:${pad(mm)}:00`,
            { zone: timeZone }
        );
        if (nextDay) dt = dt.plus({ days: 1 });
        return dt.toUTC().toJSDate();
    }
    const base = startOfWorkDay(workDateStr, timeZone);
    let ms = base.getTime() + (hh * 60 + mm) * 60 * 1000;
    if (nextDay) ms += 24 * 60 * 60 * 1000;
    return new Date(ms);
};

const isNightShiftTimes = (startTime, endTime) => {
    const toMin = (t) => {
        const [h, m] = String(t || "00:00").split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    return toMin(endTime) <= toMin(startTime);
};

module.exports = {
    formatWorkDate,
    formatWeekday,
    startOfWorkDay,
    combineWorkDateAndTime,
    isNightShiftTimes,
    getZonedParts
};
