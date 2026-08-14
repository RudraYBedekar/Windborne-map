export interface BalloonPoint {
    lat: number;
    lon: number;
    alt: number; // Meters
    time: number; // Milliseconds Unix epoch
}

export interface Balloon {
    id: string;
    path: BalloonPoint[];
    color: string;
    // Computed client fields
    latestPoint?: BalloonPoint;
    currentSpeedKmh?: number;
    headingDeg?: number;
    flightDurationHours?: number;
    status?: 'active' | 'stale' | 'high_altitude';
}

export interface BackendHealthStatus {
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    backend: string;
    latencyMs: number;
    directMode: boolean;
    message?: string;
}

/** Haversine formula to compute distance in km between two lat/lon points */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/** Compute bearing in degrees (0-360) from point 1 to point 2 */
export function calculateBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const radLat1 = lat1 * (Math.PI / 180);
    const radLat2 = lat2 * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);

    const y = Math.sin(dLon) * Math.cos(radLat2);
    const x = Math.cos(radLat1) * Math.sin(radLat2) -
              Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * (180 / Math.PI);
    return (brng + 360) % 360;
}

/** Decorate raw balloons with derived operational metrics */
export function processBalloonMetrics(rawBalloons: Balloon[]): Balloon[] {
    return rawBalloons.map(balloon => {
        if (!balloon.path || balloon.path.length === 0) return balloon;

        const sortedPath = [...balloon.path].sort((a, b) => a.time - b.time);
        const latestPoint = sortedPath[sortedPath.length - 1];

        // Ensure altitude in meters (if raw alt is in km e.g. 18.5, convert to meters)
        sortedPath.forEach(pt => {
            if (pt.alt < 100) {
                pt.alt = pt.alt * 1000;
            }
        });

        let currentSpeedKmh = 0;
        let headingDeg = 0;

        if (sortedPath.length >= 2) {
            const prevPoint = sortedPath[sortedPath.length - 2];
            const distKm = calculateDistanceKm(prevPoint.lat, prevPoint.lon, latestPoint.lat, latestPoint.lon);
            const timeHours = Math.max((latestPoint.time - prevPoint.time) / (1000 * 3600), 0.01);
            currentSpeedKmh = Math.min(distKm / timeHours, 350); // Cap at realistic stratospheric wind speeds
            headingDeg = calculateBearingDeg(prevPoint.lat, prevPoint.lon, latestPoint.lat, latestPoint.lon);
        }

        const firstPoint = sortedPath[0];
        const flightDurationHours = Math.max(Math.round((latestPoint.time - firstPoint.time) / (1000 * 3600)), 1);

        const isStale = (Date.now() - latestPoint.time) > (2 * 3600 * 1000);
        const isHighAlt = latestPoint.alt >= 18000;
        const status: 'active' | 'stale' | 'high_altitude' = isStale ? 'stale' : (isHighAlt ? 'high_altitude' : 'active');

        return {
            ...balloon,
            path: sortedPath,
            latestPoint,
            currentSpeedKmh,
            headingDeg,
            flightDurationHours,
            status
        };
    });
}

export async function fetchWindBorneData(signal?: AbortSignal): Promise<Balloon[]> {
    try {
        const res = await fetch('/api/windborne', {
            signal,
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        });
        if (!res.ok) {
            throw new Error(`API fetch failed: ${res.status} ${res.statusText}`);
        }
        const data: Balloon[] = await res.json();
        return processBalloonMetrics(data);
    } catch (e: any) {
        if (e.name === 'AbortError') return [];
        console.error("Client fetch failed", e);
        return [];
    }
}

export async function checkBackendHealth(signal?: AbortSignal): Promise<BackendHealthStatus> {
    try {
        const res = await fetch('/api/health', { signal, cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
        return {
            status: 'DEGRADED',
            backend: 'FastAPI Proxy',
            latencyMs: 0,
            directMode: true,
            message: `Health returned status ${res.status}`
        };
    } catch (error: any) {
        return {
            status: 'OFFLINE',
            backend: 'Direct Telemetry Fallback',
            latencyMs: 0,
            directMode: true,
            message: error?.message || 'Backend service unreachable'
        };
    }
}
