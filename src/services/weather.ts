export interface WeatherData {
    temperature: number;
    windSpeed: number;
    windDirection: number;
    weatherCode: number;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
    try {
        const params = new URLSearchParams({
            latitude: lat.toString(),
            longitude: lon.toString(),
            current_weather: 'true',
        });

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!res.ok) throw new Error('Weather API failed');

        const data = await res.json();
        return {
            temperature: data.current_weather.temperature,
            windSpeed: data.current_weather.windspeed,
            windDirection: data.current_weather.winddirection,
            weatherCode: data.current_weather.weathercode
        };
    } catch (err) {
        console.error('Failed to fetch weather', err);
        return null;
    }
}
