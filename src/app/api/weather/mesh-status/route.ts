import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backend = (process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  try {
    const res = await fetch(`${backend}/api/weather/mesh-status`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'MESH_STATUS_UNAVAILABLE', message: String(e) },
      { status: 503 }
    );
  }
}
