import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendBase = (process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  try {
    const res = await fetch(`${backendBase}/api/openweather/status`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Frontend may still enable layers via NEXT_PUBLIC_OPENWEATHER_KEY
    const hasPublic = Boolean(process.env.NEXT_PUBLIC_OPENWEATHER_KEY?.trim());
    return NextResponse.json({
      enabled: hasPublic,
      rpm_limit: Number(process.env.OPENWEATHER_RPM_LIMIT || 50),
      proxy: 'unreachable',
    });
  }
}
