import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const LAYERS = new Set(['clouds', 'temp', 'wind']);

type RouteParams = { params: Promise<{ layer: string; z: string; x: string; y: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { layer, z, x, y } = await params;
  const cleanY = y.replace(/\.png$/i, '');

  if (!LAYERS.has(layer)) {
    return NextResponse.json({ error: 'Unsupported layer' }, { status: 400 });
  }

  const backendBase = (process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const upstream = `${backendBase}/api/openweather/tiles/${encodeURIComponent(layer)}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(cleanY)}.png`;

  try {
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json(
        { error: 'OPENWEATHER_TILE_ERROR', detail: detail.slice(0, 300) },
        { status: res.status }
      );
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=300',
        'X-OWM-RPM-Limit': res.headers.get('X-OWM-RPM-Limit') || '50',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'OPENWEATHER_PROXY_UNAVAILABLE', message: String(err) },
      { status: 503 }
    );
  }
}
