import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');

    if (!lat || !lon) {
        return NextResponse.json(
            { error: 'Missing lat or lon parameter' },
            { status: 400 }
        );
    }

    const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
    const backendUrl = `${backendBase.replace(/\/$/, '')}/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;

    try {
        const res = await fetch(backendUrl, {
            cache: 'no-store',
            next: { revalidate: 0 }
        });

        let data: any = null;
        try {
            data = await res.json();
        } catch {
            throw new Error(`Backend returned non-JSON (status ${res.status})`);
        }

        if (res.ok && data && !data.error && !data.detail) {
            return NextResponse.json(data, { status: 200 });
        }

        const status = res.status >= 400 ? res.status : 502;
        return NextResponse.json(
            data || { error: 'BACKEND_WEATHER_ERROR', message: 'FastAPI weather request failed.' },
            { status }
        );
    } catch (error) {
        console.warn('[Weather API] FastAPI unreachable:', error);
        return NextResponse.json(
            { error: 'WEATHER_PROVIDER_UNAVAILABLE', message: 'Weather data is temporarily unavailable.' },
            { status: 503 }
        );
    }
}
