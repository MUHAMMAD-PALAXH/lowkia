const formatCoords = (lat, lng) =>
    `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

const uniqueParts = (parts) => {
    const out = [];
    for (const p of parts) {
        const s = String(p || "").trim();
        if (!s) continue;
        if (out.every((e) => e.toLowerCase() !== s.toLowerCase())) out.push(s);
    }
    return out;
};

const reverseGeocode = async (lat, lng) => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

    try {
        const url =
            "https://api.bigdatacloud.net/data/reverse-geocode-client" +
            `?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
            const data = await res.json();
            const label = uniqueParts([
                data.locality,
                data.city,
                data.principalSubdivision,
                data.countryName,
            ]).join(", ");
            if (label) return `${label}  ·  ${formatCoords(latitude, longitude)}`;
        }
    } catch (_) {
        /* fall through */
    }

    return formatCoords(latitude, longitude);
};

const formatPunchLocation = (name, lat, lng) => {
    const label = String(name || "").trim();
    if (label) return label;
    if (lat == null || lng == null) return "";
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return "";
    return formatCoords(lat, lng);
};

module.exports = { reverseGeocode, formatPunchLocation, formatCoords };
