import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const startTime = Date.now();
    const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';

    try {
        const res = await fetch(`${backendBase.replace(/\/$/, '')}/health`, {
            cache: 'no-store',
            next: { revalidate: 0 },
            signal: AbortSignal.timeout(3000)
        });

        const latency = Date.now() - startTime;

        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            return NextResponse.json({
                status: 'ONLINE',
                backend: 'FastAPI',
                latencyMs: latency,
                directMode: false,
                details: data
            });
        }

        return NextResponse.json({
            status: 'DEGRADED',
            backend: 'FastAPI',
            latencyMs: latency,
            directMode: true,
            message: `Backend returned status ${res.status}`
        });

    } catch (error: any) {
        const latency = Date.now() - startTime;
        return NextResponse.json({
            status: 'OFFLINE',
            backend: 'Direct Telemetry Fallback',
            latencyMs: latency,
            directMode: true,
            message: error?.message || 'Backend service unreachable'
        });
    }
}
