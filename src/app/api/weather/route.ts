import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function logWeatherDataToJSON(data: any, cityName?: string) {
    try {
        const filePath = path.join(process.cwd(), 'weather_data_log.json');
        let records: any[] = [];
        if (fs.existsSync(filePath)) {
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                records = JSON.parse(fileContent);
                if (!Array.isArray(records)) records = [];
            } catch {
                records = [];
            }
        }

        const coords = data.coordinates || {};
        const curr = data.current || data;
        const record = {
            id: `wx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: data.forecastTime || new Date().toISOString(),
            city: cityName || data.cityName || null,
            latitude: coords.latitude ?? data.lat ?? null,
            longitude: coords.longitude ?? data.lon ?? null,
            provider: data.provider || 'WindBorne',
            model: data.model || 'WeatherMesh',
            metrics: {
                temperature_c: curr.temperature ?? null,
                apparent_temperature_c: curr.apparentTemperature ?? null,
                humidity_pct: curr.humidity ?? null,
                wind_speed_kmh: curr.windSpeed ?? null,
                wind_direction_deg: curr.windDirection ?? null,
                pressure_hpa: curr.pressure ?? null,
                precipitation_mm: curr.precipitation ?? null,
                cloud_cover_pct: curr.cloudCover ?? null
            },
            distribution: data.distribution || null,
            raw: data
        };

        records.push(record);
        fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to log weather data to JSON:', err);
    }
}

function logWeatherDataToCSV(data: any) {
    try {
        const filePath = path.join(process.cwd(), 'weather_data_log.csv');
        const fileExists = fs.existsSync(filePath);

        if (!fileExists) {
            const header = 'timestamp,latitude,longitude,provider,model,temperature_c,apparent_temp_c,humidity_pct,wind_speed_kmh,wind_dir_deg,pressure_hpa,precipitation_mm,cloud_cover_pct\n';
            fs.writeFileSync(filePath, header, 'utf8');
        }

        const coords = data.coordinates || {};
        const curr = data.current || data;
        const timestamp = data.forecastTime || new Date().toISOString();

        const row = [
            `"${timestamp}"`,
            coords.latitude ?? data.lat ?? '',
            coords.longitude ?? data.lon ?? '',
            `"${data.provider || 'WindBorne'}"`,
            `"${data.model || 'WeatherMesh'}"`,
            curr.temperature ?? '',
            curr.apparentTemperature ?? '',
            curr.humidity ?? '',
            curr.windSpeed ?? '',
            curr.windDirection ?? '',
            curr.pressure ?? '',
            curr.precipitation ?? '',
            curr.cloudCover ?? ''
        ].join(',') + '\n';

        fs.appendFileSync(filePath, row, 'utf8');
    } catch (err) {
        console.error('Failed to log weather data to CSV:', err);
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const cityName = searchParams.get('city') || searchParams.get('name') || undefined;

    if (!lat || !lon) {
        return NextResponse.json(
            { error: 'Missing lat or lon parameter' },
            { status: 400 }
        );
    }

    const backendBase = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
    const backendUrl = `${backendBase.replace(/\/$/, '')}/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;

    try {
        // Website → FastAPI → WindBorne (Open-Meteo fallback owned by FastAPI)
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
            logWeatherDataToCSV(data);
            logWeatherDataToJSON(data, cityName);
            return NextResponse.json(data, { status: 200 });
        }

        // Pass through FastAPI error payloads; do not invent a second Open-Meteo path
        // when the backend already applied (or attempted) its own fallback.
        const status = res.status >= 400 ? res.status : 502;
        return NextResponse.json(
            data || { error: 'BACKEND_WEATHER_ERROR', message: 'FastAPI weather request failed.' },
            { status }
        );
    } catch (error) {
        // Only if FastAPI itself is unreachable — last-resort Open-Meteo so the UI still works
        console.warn('[Weather API] FastAPI unreachable, last-resort Open-Meteo:', error);
        try {
            const openMeteoUrl =
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover`;
            const omRes = await fetch(openMeteoUrl, { cache: 'no-store' });

            if (omRes.ok) {
                const omData = await omRes.json();
                const curr = omData.current || {};
                const resultData = {
                    provider: 'Open-Meteo (Fallback)',
                    model: 'open-meteo-v1',
                    coordinates: {
                        latitude: Number(lat),
                        longitude: Number(lon)
                    },
                    current: {
                        temperature: curr.temperature_2m,
                        apparentTemperature: curr.apparent_temperature,
                        humidity: curr.relative_humidity_2m,
                        windSpeed: curr.wind_speed_10m,
                        windDirection: curr.wind_direction_10m,
                        cloudCover: curr.cloud_cover,
                        pressure: curr.surface_pressure,
                        precipitation: curr.precipitation ?? null,
                    },
                    forecastTime: curr.time || null
                };

                logWeatherDataToCSV(resultData);
                logWeatherDataToJSON(resultData, cityName);
                return NextResponse.json(resultData);
            }
        } catch (omErr) {
            console.error('[Weather API] Open-Meteo last-resort failed:', omErr);
        }

        return NextResponse.json(
            { error: 'WEATHER_PROVIDER_UNAVAILABLE', message: 'Weather data is temporarily unavailable.' },
            { status: 503 }
        );
    }
}
