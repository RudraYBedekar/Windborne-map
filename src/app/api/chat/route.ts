import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Proxies Vicky-AI chat to FastAPI / Amazon Bedrock.
 * Does NOT invent operational answers when the backend is down.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { messages, fleet_context, selected_balloon, weather_context } = body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json(
                { error: 'Messages array is required' },
                { status: 400 }
            );
        }

        const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
        const backendUrl = `${backendBase.replace(/\/$/, '')}/api/chat`;

        try {
            const res = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages,
                    fleet_context,
                    selected_balloon,
                    weather_context,
                }),
                cache: 'no-store',
            });

            const data = await res.json().catch(() => null);
            if (res.ok && data) {
                return NextResponse.json(data);
            }

            return NextResponse.json(
                {
                    reply:
                        '⚠️ **AI service unavailable.** FastAPI/Bedrock did not return a grounded answer. ' +
                        'Fleet telemetry and WeatherMesh may still be available on the dashboard.',
                    provider: 'Amazon Bedrock',
                    model: null,
                    model_display_name: null,
                    is_fallback: false,
                    ai_unavailable: true,
                    sources: [],
                    toolCalls: [],
                    actions: [],
                    timestamp: new Date().toISOString(),
                },
                { status: 200 }
            );
        } catch (fastApiErr) {
            console.warn('[Vicky-AI Chat] FastAPI unreachable:', fastApiErr);
            return NextResponse.json({
                reply:
                    '⚠️ **AI service unavailable.** The FastAPI backend is offline, so I cannot verify mission data. ' +
                    'I will not invent balloon counts or weather values.',
                provider: 'Amazon Bedrock',
                model: null,
                model_display_name: null,
                is_fallback: false,
                ai_unavailable: true,
                sources: [],
                toolCalls: [],
                actions: [],
                timestamp: new Date().toISOString(),
            });
        }
    } catch (err) {
        console.error('[Vicky-AI Chat Route Error]:', err);
        return NextResponse.json(
            { error: 'CHAT_REQUEST_FAILED', message: 'Unable to process chat request' },
            { status: 500 }
        );
    }
}

export async function GET() {
    const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
    try {
        const res = await fetch(`${backendBase.replace(/\/$/, '')}/api/chat/status`, {
            cache: 'no-store',
        });
        if (res.ok) {
            return NextResponse.json(await res.json());
        }
    } catch {
        // fall through
    }
    return NextResponse.json({
        enabled: false,
        bedrock_ready: false,
        provider: 'Amazon Bedrock',
        model_id: null,
        model_display_name: 'Unavailable',
        AI_PROVIDER: 'Amazon Bedrock',
        AI_MODEL: null,
        AI_MODEL_DISPLAY_NAME: 'Unavailable',
        balloons_enabled: false,
        grounded: true,
        last_error: 'FastAPI /api/chat/status unreachable',
    });
}
