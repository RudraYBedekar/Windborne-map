'use client';

import React, { useEffect, useState } from 'react';
import { fetchWeather, WeatherData } from '@/services/weather';
import { formatCoordinates, formatSpeed, formatHeading } from '@/lib/utils';
import {
    X,
    MapPin,
    Wind,
    Thermometer,
    Cloud,
    Droplets,
    Gauge,
    Compass,
    Download,
} from 'lucide-react';

interface CityWeatherPanelProps {
    cityName: string;
    lat: number;
    lon: number;
    onClose: () => void;
}

export default function CityWeatherPanel({
    cityName,
    lat,
    lon,
    onClose
}: CityWeatherPanelProps) {
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(true);
    const [savedLogs, setSavedLogs] = useState(false);

    useEffect(() => {
        let isCancelled = false;
        setLoading(true);
        setSavedLogs(false);

        fetchWeather(lat, lon, cityName)
            .then((data) => {
                if (!isCancelled) {
                    setWeather(data);
                    setLoading(false);
                    setSavedLogs(true);
                }
            })
            .catch((err) => {
                console.error("City weather fetch error:", err);
                if (!isCancelled) setLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [lat, lon, cityName]);

    const handleDownloadJSON = () => {
        if (!weather) return;
        const payload = {
            city: cityName,
            coordinates: { latitude: lat, longitude: lon },
            timestamp: new Date().toISOString(),
            weather: weather
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cityName.toLowerCase().replace(/[^a-z0-9]/gi, '_')}_weather.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="absolute top-16 right-4 z-20 w-80 md:w-96 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl overflow-hidden font-mono select-none animate-in fade-in slide-in-from-right-4 duration-200">
            {/* Header */}
            <div className="p-3.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                        <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="font-bold text-sm text-slate-100 truncate max-w-[200px]">
                            {cityName}
                        </h3>
                        <p className="text-[10px] text-slate-400">
                            {formatCoordinates(lat, lon)}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {weather && (
                        <button
                            onClick={handleDownloadJSON}
                            title="Download City Weather JSON"
                            className="p-1.5 bg-slate-900 hover:bg-cyan-950/60 text-slate-400 hover:text-cyan-300 rounded-md border border-slate-800 hover:border-cyan-500/40 transition-colors flex items-center gap-1 text-[11px]"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">JSON</span>
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md border border-slate-800 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="p-3.5 space-y-3">
                {loading ? (
                    <div className="py-8 text-center text-xs text-slate-400 animate-pulse space-y-2">
                        <div className="text-cyan-400 font-bold">Querying Live Weather API...</div>
                        <div className="text-[10px] text-slate-500">Fetching WeatherMesh & saving JSON</div>
                    </div>
                ) : weather ? (
                    <>
                        {/* Live Primary Temperature Hero */}
                        <div className="p-3 rounded-lg bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-slate-800 flex items-center justify-between">
                            <div>
                                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                                    Current Temperature
                                </div>
                                <div className="text-3xl font-bold text-slate-100 mt-0.5">
                                    {weather.temperature ?? '--'}
                                    <span className="text-xl text-cyan-400 font-normal">°C</span>
                                </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-400">
                                <div>Provider: <span className="text-cyan-300 font-bold">{weather.provider || 'WindBorne'}</span></div>
                                <div>Model: <span className="text-slate-300">{weather.model || 'wm-6'}</span></div>
                                {weather.isFallback && (
                                    <div className="mt-1 text-amber-400">WeatherMesh down — Open-Meteo fallback</div>
                                )}
                            </div>
                        </div>

                        {/* Detailed Metrics Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                                    <Wind className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>WIND SPEED</span>
                                </div>
                                <div className="font-bold text-slate-100">{formatSpeed(weather.windSpeed).kmh}</div>
                                <div className="text-[10px] text-slate-500">{formatSpeed(weather.windSpeed).knots}</div>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                                    <Compass className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>WIND DIRECTION</span>
                                </div>
                                <div className="font-bold text-slate-100">{formatHeading(weather.windDirection)}</div>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                                    <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>SURFACE PRESSURE</span>
                                </div>
                                <div className="font-bold text-slate-100">
                                    {weather.pressure ? `${Math.round(weather.pressure)} hPa` : '--'}
                                </div>
                            </div>

                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                                    <Droplets className="w-3.5 h-3.5 text-sky-400" />
                                    <span>PRECIPITATION</span>
                                </div>
                                <div className="font-bold text-slate-100">
                                    {weather.precipitation !== undefined ? `${weather.precipitation} mm/h` : '0.0 mm/h'}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="py-6 text-center text-xs text-amber-400 font-mono">
                        Weather data unavailable for this location.
                    </div>
                )}
            </div>
        </div>
    );
}
