import { FeatureCollection } from 'geojson';

export interface SunPosition {
    lat: number;
    lon: number;
}

/**
 * Calculates the subsolar point (lat, lon) for a given timestamp.
 * Adapted from NOAA Solar Position Algorithms.
 */
export function getSunPosition(timeMs: number): SunPosition {
    // Days since Jan 1.5, 2000 (Julian Date 2451545.0)
    const julianDate = (timeMs / 86400000) + 2440587.5;
    const d = julianDate - 2451545.0;

    // Mean anomaly of the Sun
    const g = (357.529 + 0.98560028 * d) % 360;
    const gRad = g * Math.PI / 180;

    // Mean longitude of the Sun
    const q = (280.459 + 0.98564736 * d) % 360;

    // Geocentric apparent longitude of the Sun (ecliptic longitude)
    const L = (q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)) % 360;
    const LRad = L * Math.PI / 180;

    // Obliquity of the ecliptic
    const e = (23.439 - 0.00000036 * d) % 360;
    const eRad = e * Math.PI / 180;

    // Right ascension (RA) and Declination (Dec)
    let RA = Math.atan2(Math.cos(eRad) * Math.sin(LRad), Math.cos(LRad)) * 180 / Math.PI;
    if (RA < 0) RA += 360;
    const Dec = Math.asin(Math.sin(eRad) * Math.sin(LRad)) * 180 / Math.PI; // Declination of the sun in degrees

    // Greenwich Mean Sidereal Time (GMST) in degrees
    const GMST = (280.46061837 + 360.98564736629 * d) % 360;

    // Greenwich Hour Angle (GHA) of the sun
    const GHA = (GMST - RA + 360) % 360;
    
    // Subsolar point
    const lat = Dec;
    let lon = -GHA;
    while (lon < -180) lon += 360;
    while (lon > 180) lon -= 360;

    return { lat, lon };
}

/**
 * Generates a GeoJSON polygon representing the night shadow.
 * The polygon is a circular cap of angular radius 90 degrees centered opposite to the subsolar point.
 */
export function getTerminatorGeoJSON(timeMs: number): FeatureCollection {
    const sun = getSunPosition(timeMs);
    
    // Night pole (antipode of subsolar point)
    const lat0 = -sun.lat * Math.PI / 180;
    let lon0Deg = sun.lon + 180;
    if (lon0Deg > 180) lon0Deg -= 360;
    const lon0 = lon0Deg * Math.PI / 180;

    const coordinates: [number, number][] = [];
    const steps = 64;

    for (let i = 0; i <= steps; i++) {
        const theta = (i * 360 / steps) * Math.PI / 180;

        const lat = Math.asin(Math.cos(lat0) * Math.cos(theta));
        const dLon = Math.atan2(Math.sin(theta), -Math.sin(lat0) * Math.sin(lat));
        let lon = lon0 + dLon;

        // Normalize longitude to -PI to PI
        while (lon < -Math.PI) lon += 2 * Math.PI;
        while (lon > Math.PI) lon -= 2 * Math.PI;

        coordinates.push([lon * 180 / Math.PI, lat * 180 / Math.PI]);
    }

    // Close the polygon
    coordinates.push(coordinates[0]);

    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            }
        ]
    };
}
