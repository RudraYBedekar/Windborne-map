export interface WeatherData {
    temperature: number;
    windSpeed: number;
    windDirection: number;
    weatherCode?: number;
    cloudCover?: number;
    pressure?: number;
    precipitation?: number;
    provider?: string;
    model?: string;
    forecastTime?: string;
    isFallback?: boolean;
    distribution?: {
        mean?: number;
        standardDeviation?: number;
        percentiles?: Record<string, number>;
    };
}

export async function fetchWeather(lat: number, lon: number, cityName?: string): Promise<WeatherData | null> {
    try {
        const params = new URLSearchParams({
            lat: lat.toString(),
            lon: lon.toString(),
        });
        if (cityName) {
            params.append('city', cityName);
        }

        // Always use the Next.js API proxy — never call localhost from the browser
        const res = await fetch(`/api/weather?${params.toString()}`);

        if (!res.ok) {
            throw new Error(`Weather API failed with status ${res.status}`);
        }

        const data = await res.json();

        if (data.error) {
            console.warn('Weather API returned error:', data.message || data.error);
            return null;
        }

        const current = data.current || data;
        const provider = data.provider || 'WindBorne WeatherMesh';
        const isFallback =
            Boolean(data.isFallback) ||
            String(provider).toLowerCase().includes('fallback') ||
            String(provider).toLowerCase().includes('open-meteo');

        return {
            temperature: typeof current.temperature === 'number' ? current.temperature : (current.temp ?? 0),
            windSpeed: typeof current.windSpeed === 'number' ? current.windSpeed : (current.wind_speed ?? 0),
            windDirection: typeof current.windDirection === 'number' ? current.windDirection : (current.wind_direction ?? 0),
            weatherCode: current.weatherCode ?? current.weathercode ?? 0,
            cloudCover: current.cloudCover ?? current.cloud_cover,
            pressure: current.pressure,
            precipitation: current.precipitation,
            provider,
            model: data.model || 'WeatherMesh',
            forecastTime: data.forecastTime,
            isFallback,
            distribution: data.distribution
        };
    } catch (err) {
        console.error('Failed to fetch weather from WindBorne backend', err);
        return null;
    }
}
