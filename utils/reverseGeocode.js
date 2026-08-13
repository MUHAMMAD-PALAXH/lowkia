const uniqueParts = (parts) => {
    const out = [];
    for (const p of parts) {
        const cleaned = cleanPart(p);
        if (!cleaned) continue;
        if (out.every((e) => e.toLowerCase() !== cleaned.toLowerCase())) {
            out.push(cleaned);
        }
    }
    return out;
};

const cleanPart = (value) => {
    let s = String(value || "").trim().replace(/\s+/g, " ");
    if (!s) return "";
    s = s.replace(/\s+(District|Upazila|Division|Sadar|Zila|Zilla)$/i, "");
    if (s.toLowerCase() === "chattogram") return "Chittagong";
    return s;
};

const stripCoords = (value) =>
    String(value || "")
        .replace(/\s*[·•]\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/g, "")
        .replace(/^\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/, "")
        .trim();

const pick = (address, keys) => {
    for (const key of keys) {
        const v = String(address?.[key] || "").trim();
        if (v) return v;
    }
    return "";
};

const fromNominatimAddress = (address) => {
    if (!address || typeof address !== "object") return "";
    const settlement = pick(address, [
        "village",
        "hamlet",
        "suburb",
        "neighbourhood",
        "neighborhood",
        "isolated_dwelling",
        "locality",
        "quarter",
        "city_district"
    ]);
    // Do not use `city` here — OSM often snaps to the nearest city (e.g. Cumilla).
    const upazila = pick(address, ["municipality", "county", "town"]);
    const district = pick(address, ["state_district", "district", "region"]);
    const division = pick(address, ["state", "province"]);
    const country = pick(address, ["country"]);

    if (!settlement && !upazila) {
        return uniqueParts([
            pick(address, ["city"]),
            district,
            division,
            country
        ]).join(", ");
    }

    return uniqueParts([
        settlement,
        upazila,
        district,
        division,
        country
    ]).join(", ");
};

const fromBigDataAdmin = (data) => {
    const admin = data?.localityInfo?.administrative;
    if (!Array.isArray(admin) || !admin.length) return "";
    const byLevel = new Map();
    for (const item of admin) {
        const name = String(item?.name || "").trim();
        const level = Number(item?.adminLevel) || 0;
        if (!name || level <= 0 || byLevel.has(level)) continue;
        byLevel.set(level, name);
    }
    if (!byLevel.size) return "";
    const levels = [...byLevel.keys()].sort((a, b) => b - a);
    return uniqueParts(levels.slice(0, 5).map((level) => byLevel.get(level))).join(
        ", "
    );
};

const reverseNominatim = async (latitude, longitude) => {
    const url =
        "https://nominatim.openstreetmap.org/reverse" +
        `?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": "LOWKIA-Admin/1.0 (attendance)"
        },
        signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return "";
    const data = await res.json();
    return fromNominatimAddress(data?.address);
};

const reverseBigDataCloud = async (latitude, longitude) => {
    const url =
        "https://api.bigdatacloud.net/data/reverse-geocode-client" +
        `?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
    const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return "";
    const data = await res.json();
    const fromAdmin = fromBigDataAdmin(data);
    if (fromAdmin) return fromAdmin;
    return uniqueParts([
        data.locality,
        data.city,
        data.principalSubdivision,
        data.countryName
    ]).join(", ");
};

const reverseGeocode = async (lat, lng) => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

    try {
        const nominatim = await reverseNominatim(latitude, longitude);
        if (nominatim) return nominatim;
    } catch (_) {
        /* fall through */
    }

    try {
        return await reverseBigDataCloud(latitude, longitude);
    } catch (_) {
        return "";
    }
};

const formatPunchLocation = (name) => stripCoords(name);

module.exports = { reverseGeocode, formatPunchLocation, stripCoords };
