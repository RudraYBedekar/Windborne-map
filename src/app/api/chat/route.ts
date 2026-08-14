import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages,
                    fleet_context,
                    selected_balloon,
                    weather_context
                }),
                cache: 'no-store'
            });

            if (res.ok) {
                const data = await res.json();
                return NextResponse.json(data);
            }
        } catch (fastApiErr) {
            console.warn('[Vicky-AI Chat] FastAPI backend unreachable, using Next.js local fallback:', fastApiErr);
        }

        // Next.js fallback if FastAPI is offline
        const lastMsg = messages[messages.length - 1]?.content || '';
        const lower = lastMsg.toLowerCase();

        let reply = "👋 I am **Vicky-AI**, your Lead Flight Operations & Meteorological Co-Pilot for the WindBorne balloon constellation.\n\nAsk me anything about active balloon altitudes, flight trajectories, or WeatherMesh forecasts!";
        
        if (lower.includes('highest') || lower.includes('altitude')) {
            const h = fleet_context?.highest_balloon;
            if (h) {
                reply = `🏔️ **Highest Balloon in the Constellation**\n\nBalloon **\`${h.id}\`** is flying at **\`${Math.round(h.alt).toLocaleString()} meters\`** (${Math.round(h.alt * 3.28084).toLocaleString()} ft) at coordinates \`${h.lat?.toFixed(3)}°, ${h.lon?.toFixed(3)}°\`.`;
            } else {
                reply = "📡 Fleet telemetry is updating. Please ensure live constellation data is loaded.";
            }
        } else if (lower.includes('fleet') || lower.includes('summary') || lower.includes('how many')) {
            const total = fleet_context?.total_balloons || 0;
            const high = fleet_context?.high_altitude_count || 0;
            const avg = Math.round(fleet_context?.avg_altitude_m || 0);
            reply = `🌐 **Fleet Intelligence Status**\n\n- **Active Balloons:** \`${total}\`\n- **Stratospheric Craft (≥18,000m):** \`${high}\`\n- **Average Altitude:** \`${avg.toLocaleString()} m\`\n- **Atmospheric Model:** WindBorne WeatherMesh AI`;
        } else if (selected_balloon && (lower.includes('selected') || lower.includes('this'))) {
            reply = `🎈 **Selected Balloon \`${selected_balloon.id}\`**\n\n- **Altitude:** \`${Math.round(selected_balloon.alt).toLocaleString()} m\`\n- **Speed:** \`${selected_balloon.speed_kmh?.toFixed(1)} km/h\`\n- **Position:** \`${selected_balloon.lat?.toFixed(4)}°, ${selected_balloon.lon?.toFixed(4)}°\``;
        }

        return NextResponse.json({
            reply,
            provider: 'Vicky-AI Local Engine (Next.js Fallback)',
            model: 'rule-based-contextual',
            is_fallback: true,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('[Vicky-AI Chat Route Error]:', err);
        return NextResponse.json(
            { error: 'CHAT_REQUEST_FAILED', message: 'Unable to process chat request' },
            { status: 500 }
        );
    }
}
