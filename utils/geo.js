/** Haversine distance in meters between two WGS84 points. */
const distanceMeters = (lat1, lon1, lat2, lon2) => {
    const toRad = (d) => (Number(d) * Math.PI) / 180;
    const R = 6371000;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(Number(lat2) - Number(lat1));
    const Δλ = toRad(Number(lon2) - Number(lon1));
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const assertWithinGeofence = ({
    latitude,
    longitude,
    branch,
    required
}) => {
    if (!required) return { ok: true };
    if (latitude == null || longitude == null) {
        return {
            ok: false,
            message: "Location is required for attendance at this company."
        };
    }
    const bLat = branch?.attendanceLatitude;
    const bLng = branch?.attendanceLongitude;
    const radius = Number(branch?.attendanceRadiusMeters);
    if (bLat == null || bLng == null || !Number.isFinite(radius) || radius <= 0) {
        // Policy requires location but branch fence not configured — allow with audit note
        return { ok: true, warning: "Branch geofence not configured." };
    }
    const d = distanceMeters(latitude, longitude, bLat, bLng);
    if (d > radius) {
        return {
            ok: false,
            message: `Attendance not allowed. You are outside the allowed attendance location (${Math.round(d)}m away, limit ${radius}m).`,
            distanceMeters: Math.round(d)
        };
    }
    return { ok: true, distanceMeters: Math.round(d) };
};

// Measure a punch against the branch fence. Never blocks — the caller
// records the result so reports can flag out-of-range punches.
const evaluateGeofence = ({ latitude, longitude, branch } = {}) => {
    const bLat = Number(branch?.attendanceLatitude);
    const bLng = Number(branch?.attendanceLongitude);
    const radius = Number(branch?.attendanceRadiusMeters);
    if (!Number.isFinite(bLat) || !Number.isFinite(bLng)) {
        return {
            configured: false,
            inRange: null,
            distanceMeters: null,
            radiusMeters: null
        };
    }
    const limit = Number.isFinite(radius) && radius > 0 ? radius : 100;
    if (latitude == null || longitude == null) {
        return {
            configured: true,
            inRange: false,
            distanceMeters: null,
            radiusMeters: limit
        };
    }
    const d = Math.round(distanceMeters(latitude, longitude, bLat, bLng));
    return {
        configured: true,
        inRange: d <= limit,
        distanceMeters: d,
        radiusMeters: limit
    };
};

module.exports = { distanceMeters, assertWithinGeofence, evaluateGeofence };
