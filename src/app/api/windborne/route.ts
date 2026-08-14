import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COLORS = ['#00ffea', '#ff0055', '#ccff00', '#bf00ff', '#00ccff', '#ffaa00'];

async function fetchDirectWindBorneData() {
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const fetched = await Promise.all(
        hours.map(async (h) => {
            try {
                const res = await fetch(`https://a.windbornesystems.com/treasure/${h}.json`, { cache: 'no-store' });
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        })
    );

    const balloons: Record<string, { id: string; path: any[]; color: string }> = {};
    const now = Date.now();

    fetched.forEach((hourData, hourIndex) => {
        if (!Array.isArray(hourData)) return;
        const timestamp = now - hourIndex * 60 * 60 * 1000;

        hourData.forEach((point: any, balloonIndex: number) => {
            if (!Array.isArray(point) || point.length < 3) return;
            const [lat, lon, alt] = point;
            if (typeof lat !== 'number' || typeof lon !== 'number') return;
            const validAlt = typeof alt === 'number' ? alt : 0.0;
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

    return Object.values(balloons)
        .map((b) => {
            b.path.sort((a, b) => a.time - b.time);
            return b;
        })
        .filter((b) => b.path.length > 0);
}

export async function GET() {
    try {
        const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
        const res = await fetch(`${backendBase.replace(/\/$/, '')}/windborne`, {
            cache: 'no-store',
            next: { revalidate: 0 }
        });

        if (res.ok) {
            const data = await res.json();
            return NextResponse.json(data);
        }
        throw new Error(`Python backend error: ${res.status}`);
    } catch (error) {
        console.warn("Python backend offline or failed, using fallback direct fetch:", error);
        try {
            const fallbackData = await fetchDirectWindBorneData();
            return NextResponse.json(fallbackData);
        } catch (fallbackErr) {
            console.error("Direct fetch fallback failed:", fallbackErr);
            return NextResponse.json(
                { error: 'Failed to fetch Windborne balloon data from both backend and direct API.' },
                { status: 500 }
            );
        }
    }
}

