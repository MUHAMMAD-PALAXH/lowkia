const UA = "LOWKIA-Admin/1.0 (attendance)";

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
    s = s.replace(
        /\s+(District|Upazila|Division|Sadar|Zila|Zilla|County|Borough|Municipality|Province|Prefecture|Region|Tehsil|Taluk|Union|Parish)$/i,
        ""
    );
    if (s.toLowerCase() === "chattogram") return "Chittagong";
    if (s.toLowerCase() === "comilla") return "Cumilla";
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
        "city_district",
        "town"
    ]);
    const localAdmin = pick(address, [
        "municipality",
        "county",
        "borough",
        "city"
    ]);
    const district = pick(address, ["state_district", "district", "region"]);
    const region = pick(address, ["state", "province"]);
    const country = pick(address, ["country"]);

    return uniqueParts([
        settlement,
        localAdmin,
        district,
        region,
        country
    ]).join(", ");
};

const mergePlaceNames = (contained, nominatim) =>
    uniqueParts([
        ...String(nominatim || "").split(","),
        ...String(contained || "").split(",")
    ]).join(", ");

const metersBetween = (lat1, lon1, lat2, lon2) => {
    const r = 6371000;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const reverseOverpass = async (latitude, longitude) => {
    const query =
        `[out:json][timeout:15];is_in(${latitude},${longitude})->.a;` +
        `(` +
        `rel(pivot.a)["boundary"="administrative"];` +
        `node["place"~"village|hamlet|locality|neighbourhood|suburb"](around:2000,${latitude},${longitude});` +
        `);out tags center;`;
    const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ];
    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "text/plain; charset=utf-8",
                    "User-Agent": UA
                },
                body: query,
                signal: AbortSignal.timeout(16000)
            });
            if (!res.ok) continue;
            const data = await res.json();
            const elements = Array.isArray(data?.elements) ? data.elements : [];
            const byLevel = new Map();
            let nearest = "";
            let nearestMeters = 2000;
            for (const el of elements) {
                const tags = el?.tags || {};
                const name = String(tags["name:en"] || tags.name || "").trim();
                if (!name) continue;
                if (el.type === "node" || tags.place) {
                    const plat = Number(el.lat ?? el.center?.lat);
                    const plng = Number(el.lon ?? el.center?.lon);
                    if (Number.isFinite(plat) && Number.isFinite(plng)) {
                        const m = metersBetween(latitude, longitude, plat, plng);
                        if (m <= nearestMeters) {
                            nearestMeters = m;
                            nearest = name;
                        }
                    }
                }
                const level = Number(tags.admin_level) || 0;
                if (level > 0 && !byLevel.has(level)) byLevel.set(level, name);
            }
            const levels = [...byLevel.keys()].sort((a, b) => b - a);
            const label = uniqueParts([
                nearest,
                ...levels.slice(0, 5).map((level) => byLevel.get(level))
            ]).join(", ");
            if (label) return label;
        } catch (_) {
            /* try next endpoint */
        }
    }
    return "";
};

const reverseNominatim = async (latitude, longitude) => {
    const url =
        "https://nominatim.openstreetmap.org/reverse" +
        `?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": UA
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
    const admin = data?.localityInfo?.administrative;
    if (Array.isArray(admin) && admin.length) {
        const byLevel = new Map();
        for (const item of admin) {
            const name = String(item?.name || "").trim();
            const level = Number(item?.adminLevel) || 0;
            if (!name || level <= 0 || byLevel.has(level)) continue;
            byLevel.set(level, name);
        }
        if (byLevel.size) {
            const levels = [...byLevel.keys()].sort((a, b) => b - a);
            return uniqueParts(
                levels.slice(0, 5).map((level) => byLevel.get(level))
            ).join(", ");
        }
    }
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

    let contained = "";
    let nominatim = "";
    try {
        contained = await reverseOverpass(latitude, longitude);
    } catch (_) {
        contained = "";
    }
    try {
        nominatim = await reverseNominatim(latitude, longitude);
    } catch (_) {
        nominatim = "";
    }
    const merged = mergePlaceNames(contained, nominatim);
    if (merged) return merged;

    try {
        return await reverseBigDataCloud(latitude, longitude);
    } catch (_) {
        return "";
    }
};

const ipCoordinates = async (ipAddress) => {
    const ip = String(ipAddress || "")
        .split(",")[0]
        .trim()
        .replace(/^::ffff:/, "");
    const urls = ip
        ? [
              `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon`,
              `https://ipwho.is/${encodeURIComponent(ip)}`
          ]
        : [
              "http://ip-api.com/json/?fields=status,lat,lon",
              "https://ipwho.is/"
          ];
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(3000)
            });
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.status === "fail" || data?.success === false) continue;
            const lat = Number(data.lat ?? data.latitude);
            const lng = Number(data.lon ?? data.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            return { latitude: lat, longitude: lng };
        } catch (_) {
            /* try next */
        }
    }
    return null;
};

const resolvePunchLocation = async ({
    latitude,
    longitude,
    locationName,
    ipAddress
} = {}) => {
    let name = stripCoords(locationName);
    let lat = Number(latitude);
    let lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const fromIp = await ipCoordinates(ipAddress);
        lat = fromIp?.latitude;
        lng = fromIp?.longitude;
    }
    if (!name && Number.isFinite(lat) && Number.isFinite(lng)) {
        name = await reverseGeocode(lat, lng);
    }
    return {
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        locationName: name || ""
    };
};

const formatPunchLocation = (name) => uniqueParts(stripCoords(name).split(",")).join(", ");

module.exports = {
    reverseGeocode,
    resolvePunchLocation,
    formatPunchLocation,
    stripCoords
};
