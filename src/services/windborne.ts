export interface BalloonPoint {
    lat: number;
    lon: number;
    alt: number; // in km presumably, or meters? API inspect showed ~20. It's likely km.
    time: number; // calculated from file index (00-23)
}

export interface Balloon {
    id: string; // balloon index
    path: BalloonPoint[];
    color: string;
}

export async function fetchWindBorneData(): Promise<Balloon[]> {
    try {
        const res = await fetch('/api/windborne', {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!res.ok) {
            throw new Error(`API fetch failed: ${res.status} ${res.statusText}`);
        }
        return res.json();
    } catch (e) {
        console.error("Client fetch failed", e);
        return [];
    }
}
