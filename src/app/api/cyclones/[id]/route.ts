import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const backend = (process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const qs = request.nextUrl.searchParams.toString();
  const url = `${backend}/api/cyclones/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'CYCLONE_PROXY_UNAVAILABLE', message: String(e) },
      { status: 503 }
    );
  }
}
