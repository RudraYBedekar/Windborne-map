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
    distribution?: {
        mean?: number;
        standardDeviation?: number;
        percentiles?: Record<string, number>;
    };
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
    try {
        const params = new URLSearchParams({
            lat: lat.toString(),
            lon: lon.toString(),
        });

        // Call our Next.js API proxy route which connects to FastAPI backend / WindBorne API
        let res = await fetch(`/api/weather?${params.toString()}`);
        
        // Fallback to direct Python FastAPI backend URL if API route is unavailable
        if (!res.ok && typeof window !== 'undefined') {
            try {
                res = await fetch(`http://localhost:8000/api/weather?${params.toString()}`);
            } catch {
                // Ignore fallback error and handle below
            }
        }

        if (!res.ok) {
            throw new Error(`Weather API failed with status ${res.status}`);
        }

        const data = await res.json();

        if (data.error) {
            console.warn('Weather API returned error:', data.message || data.error);
            return null;
        }

        // Support normalized WindBorne WeatherMesh backend response contract
        const current = data.current || data;

        return {
            temperature: typeof current.temperature === 'number' ? current.temperature : (current.temp ?? 0),
            windSpeed: typeof current.windSpeed === 'number' ? current.windSpeed : (current.wind_speed ?? 0),
            windDirection: typeof current.windDirection === 'number' ? current.windDirection : (current.wind_direction ?? 0),
            weatherCode: current.weatherCode ?? current.weathercode ?? 0,
            cloudCover: current.cloudCover ?? current.cloud_cover,
            pressure: current.pressure,
            precipitation: current.precipitation,
            provider: data.provider || 'WindBorne WeatherMesh',
            model: data.model || 'WeatherMesh',
            forecastTime: data.forecastTime,
            distribution: data.distribution
        };
    } catch (err) {
        console.error('Failed to fetch weather from WindBorne backend', err);
        return null;
    }
}
