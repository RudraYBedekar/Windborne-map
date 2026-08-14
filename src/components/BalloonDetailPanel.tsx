'use client';

import React, { useEffect, useState } from 'react';
import { Balloon } from '@/services/windborne';
import { fetchWeather, WeatherData } from '@/services/weather';
import {
    formatAltitude,
    formatCoordinates,
    formatSpeed,
    formatHeading,
    formatTime,
    formatRelativeTime
} from '@/lib/utils';
import {
    X,
    Gauge,
    Navigation,
    Clock,
    Wind,
    Thermometer,
    Cloud,
    Droplets,
    Activity,
    Compass,
    Shield,
    TrendingUp,
    CheckCircle2,
    Download,
    FileJson
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface BalloonDetailPanelProps {
    balloon: Balloon;
    onClose: () => void;
    onFocusCamera: () => void;
    isTrackingCamera?: boolean;
}

export default function BalloonDetailPanel({
    balloon,
    onClose,
    onFocusCamera,
    isTrackingCamera = false
}: BalloonDetailPanelProps) {
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [weatherLoading, setWeatherLoading] = useState(false);

    const latest = balloon.latestPoint;
    const alt = formatAltitude(latest?.alt);
    const speed = formatSpeed(balloon.currentSpeedKmh);
    const heading = formatHeading(balloon.headingDeg);

    // Fetch Weather for selected balloon position
    useEffect(() => {
        if (!latest) return;
        let isCancelled = false;
        setWeatherLoading(true);

        fetchWeather(latest.lat, latest.lon)
            .then(data => {
                if (!isCancelled) {
                    setWeather(data);
                    setWeatherLoading(false);
                }
            })
            .catch(() => {
                if (!isCancelled) setWeatherLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [latest?.lat, latest?.lon]);

    // Generate SVG Sparkline Path for Altitude Profile Over 24h History
    const pathPoints = balloon.path || [];
    const minAlt = Math.min(...pathPoints.map(p => p.alt), 0);
    const maxAlt = Math.max(...pathPoints.map(p => p.alt), 25000);
    const svgWidth = 240;
    const svgHeight = 45;

    const sparklinePath = pathPoints.length > 1
        ? pathPoints.map((pt, i) => {
            const x = (i / (pathPoints.length - 1)) * svgWidth;
            const y = svgHeight - ((pt.alt - minAlt) / (maxAlt - minAlt || 1)) * (svgHeight - 10) - 5;
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ')
        : `M 0 ${svgHeight / 2} L ${svgWidth} ${svgHeight / 2}`;

    const handleExportGPX = () => {
        try {
            const points = balloon.path || [];
            if (points.length === 0) {
                toast.error("No flight path points to export.");
                return;
            }
            const gpxString = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<gpx version="1.1" creator="WindBorne Tracker" xmlns="http://www.topografix.com/GPX/1/1">',
                '  <trk>',
                `    <name>${balloon.id}</name>`,
                '    <trkseg>',
                ...points.map(pt => {
                    const timeISO = new Date(pt.time).toISOString();
                    return `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}">
        <ele>${pt.alt.toFixed(1)}</ele>
        <time>${timeISO}</time>
      </trkpt>`;
                }),
                '    </trkseg>',
                '  </trk>',
                '</gpx>'
            ].join('\n');

            const blob = new Blob([gpxString], { type: 'application/gpx+xml;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${balloon.id}_flight_path.gpx`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(`Exported GPX for ${balloon.id}`);
        } catch (err) {
            console.error(err);
            toast.error("Failed to export GPX.");
        }
    };

    const handleExportGeoJSON = () => {
        try {
            const points = balloon.path || [];
            if (points.length === 0) {
                toast.error("No flight path points to export.");
                return;
            }
            const feature = {
                type: "Feature",
                properties: {
                    id: balloon.id,
                    color: balloon.color,
                    status: balloon.status,
                    pointCount: points.length,
                    durationHours: balloon.flightDurationHours
                },
                geometry: {
                    type: "LineString",
                    coordinates: points.map(pt => [pt.lon, pt.lat, pt.alt])
                }
            };

            const geojsonString = JSON.stringify(feature, null, 2);
            const blob = new Blob([geojsonString], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${balloon.id}_flight_path.geojson`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(`Exported GeoJSON for ${balloon.id}`);
        } catch (err) {
            console.error(err);
            toast.error("Failed to export GeoJSON.");
        }
    };

    return (
        <div className="absolute top-16 right-4 z-20 w-80 md:w-96 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl overflow-hidden font-sans select-none animate-in fade-in slide-in-from-right-4 duration-200">
            {/* Header Strip */}
            <div className="p-3.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <span
                        className="w-3 h-3 rounded-full shadow-[0_0_10px_currentColor]"
                        style={{ backgroundColor: balloon.color }}
                    />
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-mono font-bold text-base text-slate-100">{balloon.id}</h3>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 uppercase font-semibold">
                                {balloon.status || 'ACTIVE'}
                            </span>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400">
                            {formatCoordinates(latest?.lat, latest?.lon)}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={onFocusCamera}
                        className={`p-1.5 rounded-md border text-xs transition-all ${
                            isTrackingCamera
                                ? "bg-cyan-950 border-cyan-500 text-cyan-300"
                                : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                        }`}
                        title={isTrackingCamera ? "Stop tracking balloon" : "Track balloon with camera"}
                    >
                        <Compass className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md border border-slate-800 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content Body */}
            <div className="p-3.5 space-y-3.5 max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {/* Telemetry Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                            <span>ALTITUDE</span>
                        </div>
                        <div className="font-bold text-slate-100 text-sm">{alt.meters}</div>
                        <div className="text-[10px] text-slate-500">{alt.feet}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                            <Navigation className="w-3.5 h-3.5 text-indigo-400" />
                            <span>GROUND SPEED</span>
                        </div>
                        <div className="font-bold text-slate-100 text-sm">{speed.kmh}</div>
                        <div className="text-[10px] text-slate-500">{speed.knots}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                            <Compass className="w-3.5 h-3.5 text-emerald-400" />
                            <span>HEADING</span>
                        </div>
                        <div className="font-bold text-slate-100 text-sm">{heading}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mb-1">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>LAST UPDATE</span>
                        </div>
                        <div className="font-bold text-slate-100 text-xs">{formatTime(latest?.time || 0)}</div>
                        <div className="text-[10px] text-slate-500">{formatRelativeTime(latest?.time || 0)}</div>
                    </div>
                </div>

                {/* Export Action Buttons */}
                <div className="flex gap-2">
                    <button
                        onClick={handleExportGPX}
                        className="flex-1 py-2 px-3 rounded-lg bg-slate-900/65 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700/85 text-[11px] font-mono text-slate-300 hover:text-cyan-400 transition-all flex items-center justify-center gap-1.5"
                        title="Download track as standard GPX file"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export GPX</span>
                    </button>
                    <button
                        onClick={handleExportGeoJSON}
                        className="flex-1 py-2 px-3 rounded-lg bg-slate-900/65 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700/85 text-[11px] font-mono text-slate-300 hover:text-indigo-400 transition-all flex items-center justify-center gap-1.5"
                        title="Download track as standard GeoJSON file"
                    >
                        <FileJson className="w-3.5 h-3.5" />
                        <span>Export GeoJSON</span>
                    </button>
                </div>

                {/* 24-Hour Altitude Profile Sparkline */}
                <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/80 font-mono">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2">
                        <span className="flex items-center gap-1 text-cyan-400 font-bold uppercase">
                            <TrendingUp className="w-3.5 h-3.5" /> 24H Altitude Profile
                        </span>
                        <span>Max {formatAltitude(maxAlt).meters}</span>
                    </div>
                    <div className="relative w-full h-12 bg-slate-950/80 rounded border border-slate-800 flex items-center justify-center p-1">
                        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full overflow-visible">
                            <path
                                d={sparklinePath}
                                fill="none"
                                stroke="#06b6d4"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                        <span>24h ago</span>
                        <span>12h ago</span>
                        <span>Live</span>
                    </div>
                </div>

                {/* Live Weather Intelligence Card */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 font-mono">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800/80 pb-2 mb-2.5">
                        <span className="flex items-center gap-1.5 text-sky-400 font-bold uppercase">
                            <Wind className="w-3.5 h-3.5" /> Local Atmospheric Weather
                        </span>
                        {weather && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                                {weather.provider}
                            </span>
                        )}
                    </div>

                    {weatherLoading ? (
                        <div className="py-4 text-center text-xs text-slate-500 animate-pulse">
                            Querying weather forecast data...
                        </div>
                    ) : weather ? (
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800/60">
                                <div className="text-[9px] text-slate-500 uppercase">Temp</div>
                                <div className="font-bold text-slate-200 mt-0.5">
                                    {weather.temperature ?? '--'}°C
                                </div>
                            </div>
                            <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800/60">
                                <div className="text-[9px] text-slate-500 uppercase">Wind</div>
                                <div className="font-bold text-cyan-300 mt-0.5">
                                    {weather.windSpeed ?? '--'} km/h
                                </div>
                            </div>
                            <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800/60">
                                <div className="text-[9px] text-slate-500 uppercase">Pressure</div>
                                <div className="font-bold text-indigo-300 mt-0.5">
                                    {weather.pressure ? `${Math.round(weather.pressure)}hPa` : '--'}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-[11px] text-slate-500 text-center py-2">
                            Weather metrics temporarily unavailable
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
