import { NextResponse } from 'next/server';
import { Balloon } from '@/services/windborne';

// Reuse the logic, but run it on server
// We'll duplicate some logic here to keep the service file clean for Types
// or we can import the helper if we refactor. 
// For speed, let's implement the fetching logic directly here.

export const dynamic = 'force-dynamic'; // Check for updates on every request

const COLORS = [
    '#00ffea', '#ff0055', '#ccff00', '#bf00ff', '#00ccff', '#ffaa00'
]; // Updated to Neon colors

export async function GET() {
    try {
        const hours = Array.from({ length: 24 }, (_, i) => i);

        // Server-side fetch (Node.js) usually bypasses CORS issues from external APIs
        // unless they explicitly block non-browser agents, which we can fake if needed.

        const fetchedData = await Promise.all(
            hours.map(async (h) => {
                const id = h.toString().padStart(2, '0');
                const url = `https://a.windbornesystems.com/treasure/${id}.json`;
                try {
                    const res = await fetch(url, { next: { revalidate: 60 } });
                    if (!res.ok) return null;
                    return res.json();
                } catch (e) {
                    console.error(`Fetch failed for ${url}`, e);
                    return null;
                }
            })
        );

        const balloons: Record<string, Balloon> = {};
        const now = Date.now();

        fetchedData.forEach((hourData: any, hourIndex) => {
            if (!hourData || !Array.isArray(hourData)) return;

            // User Spec:
            // 00.json = Current (Now)
            // 01.json = 1 hour ago
            // ...
            // 23.json = 23 hours ago

            // hourIndex matches the file number (0 to 23)
            const hoursAgo = hourIndex;
            const timestamp = now - (hoursAgo * 60 * 60 * 1000);

            hourData.forEach((point: any, balloonIndex) => {
                if (!Array.isArray(point) || point.length < 3) return;
                const [lat, lon, alt] = point;

                // Robustness: Validate coordinates
                if (typeof lat !== 'number' || !Number.isFinite(lat)) return;
                if (typeof lon !== 'number' || !Number.isFinite(lon)) return;
                // Alt might be missing or null, defaulting to 0 if invalid is safer than skipping? 
                // Let's skip if critical position is bad. Alt is critical-ish.
                const validAlt = (typeof alt === 'number' && Number.isFinite(alt)) ? alt : 0;

                const balloonId = `WB-${balloonIndex + 1}`;

                if (!balloons[balloonId]) {
                    balloons[balloonId] = {
                        id: balloonId,
                        path: [],
                        color: COLORS[balloonIndex % COLORS.length]
                    };
                }

                balloons[balloonId].path.push({
                    lat,
                    lon,
                    alt: validAlt,
                    time: timestamp
                });
            });
        });

        const result = Object.values(balloons)
            .map(b => {
                b.path.sort((p1, p2) => p1.time - p2.time);
                return b;
            })
            .filter(b => b.path.length > 0)
            // Add some random variety to altitude if it's identical to make it look nicer? 
            // No, stick to data.
            ;

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }
}
