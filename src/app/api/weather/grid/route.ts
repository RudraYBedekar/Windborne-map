import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const backend = (process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const format = request.nextUrl.searchParams.get('format') || 'json';
  const qs = request.nextUrl.searchParams.toString();
  const url = `${backend}/api/weather/grid${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (format === 'png') {
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return NextResponse.json(
          { error: 'GRID_UNAVAILABLE', detail: detail.slice(0, 300) },
          { status: res.status }
        );
      }
      const buf = await res.arrayBuffer();
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': res.headers.get('Cache-Control') || 'public, max-age=300',
        },
      });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'GRID_PROXY_UNAVAILABLE', message: 'WeatherMesh forecast layer unavailable.' },
      { status: 503 }
    );
  }
}
