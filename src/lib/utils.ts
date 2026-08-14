import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatTime(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) return '--:--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatUTCTime(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) return '--:-- UTC';
    const date = new Date(timestamp);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds} UTC`;
}

export function formatRelativeTime(timestamp: number | Date | null): string {
    if (!timestamp) return 'No data';
    const timeMs = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
    const diffSec = Math.floor((Date.now() - timeMs) / 1000);

    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ${diffMin % 60}m ago`;
    return `${Math.floor(diffHour / 24)}d ago`;
}

export function formatCoordinates(lat?: number, lon?: number): string {
    if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) {
        return '--.----°, --.----°';
    }
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

export function formatAltitude(altMeters?: number): { meters: string; feet: string; rawMeters: number } {
    if (altMeters === undefined || isNaN(altMeters)) {
        return { meters: '-- m', feet: '-- ft', rawMeters: 0 };
    }
    const feet = altMeters * 3.28084;
    return {
        meters: `${Math.round(altMeters).toLocaleString()} m`,
        feet: `${Math.round(feet).toLocaleString()} ft`,
        rawMeters: altMeters
    };
}

export function formatSpeed(speedKmh?: number): { kmh: string; knots: string; rawKmh: number } {
    if (speedKmh === undefined || isNaN(speedKmh)) {
        return { kmh: '-- km/h', knots: '-- kts', rawKmh: 0 };
    }
    const knots = speedKmh * 0.539957;
    return {
        kmh: `${speedKmh.toFixed(1)} km/h`,
        knots: `${knots.toFixed(1)} kts`,
        rawKmh: speedKmh
    };
}

export function formatHeading(deg?: number): string {
    if (deg === undefined || isNaN(deg)) return 'N/A';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const normalized = (deg % 360 + 360) % 360;
    const index = Math.round(normalized / 22.5) % 16;
    return `${directions[index]} (${Math.round(normalized)}°)`;
}
