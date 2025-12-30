import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Fetch from the local Python backend
        const res = await fetch('http://127.0.0.1:8000/windborne', {
            cache: 'no-store',
            next: { revalidate: 0 }
        });

        if (!res.ok) {
            throw new Error(`Python backend error: ${res.status}`);
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Failed to fetch from Python backend:", error);
        return NextResponse.json(
            { error: 'Failed to fetch data from Python backend. Make sure the backend is running on port 8000.' },
            { status: 500 }
        );
    }
}
