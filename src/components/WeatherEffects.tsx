'use client';

import React, { useMemo } from 'react';
import { WeatherData } from '@/services/weather';
import { cn } from '@/lib/utils';

interface WeatherEffectsProps {
    weather?: WeatherData | null;
}

type Mode = 'rain' | 'snow' | 'wind' | 'none';

export default function WeatherEffects({ weather }: WeatherEffectsProps) {
    // Determine actual weather particle mode from real meteorological metrics
    const mode: Mode = useMemo(() => {
        if (!weather) return 'none';

        const precip = weather.precipitation ?? 0;
        const temp = weather.temperature ?? 15;
        const windSpeed = weather.windSpeed ?? 0;

        if (precip > 0.1) {
            return temp <= 0 ? 'snow' : 'rain';
        }
        if (windSpeed > 20) {
            return 'wind';
        }
        return 'none';
    }, [weather]);

    // Particle count scaled according to weather severity
    const particles = useMemo(() => {
        if (mode === 'none' || !weather) return [];
        let count = 25;
        if (mode === 'rain') {
            count = Math.min(Math.max(Math.round((weather.precipitation || 1) * 30), 40), 120);
        } else if (mode === 'snow') {
            count = 50;
        } else if (mode === 'wind') {
            count = Math.min(Math.max(Math.round((weather.windSpeed || 20) * 1.5), 25), 70);
        }
        return Array.from({ length: count }, (_, i) => i);
    }, [mode, weather]);

    if (mode === 'none') return null;

    const windAngle = weather?.windDirection ?? 90;

    return (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden opacity-60 transition-opacity duration-1000">
            {particles.map((i) => {
                const style = getParticleStyle(mode, i, windAngle);
                return (
                    <div
                        key={i}
                        className={cn(
                            "absolute",
                            mode === 'rain' && "w-[1.5px] h-6 bg-gradient-to-b from-sky-300/20 via-cyan-400/80 to-blue-500/90 rounded-full",
                            mode === 'snow' && "w-1.5 h-1.5 bg-slate-100/80 rounded-full blur-[0.5px]",
                            mode === 'wind' && "h-[1.5px] bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent rounded-full"
                        )}
                        style={style}
                    />
                );
            })}
            <style jsx>{`
                @keyframes rain-fall {
                    0% { transform: translateY(-20px); }
                    100% { transform: translateY(105vh); }
                }
                @keyframes snow-fall {
                    0% { transform: translate(0, -10px); }
                    50% { transform: translate(25px, 50vh); }
                    100% { transform: translate(-10px, 105vh); }
                }
                @keyframes wind-streak {
                    0% { transform: translateX(-20vw); opacity: 0; }
                    40% { opacity: 0.8; }
                    100% { transform: translateX(120vw); opacity: 0; }
                }
            `}</style>
        </div>
    );
}

function getParticleStyle(mode: Mode, index: number, windAngle: number): React.CSSProperties {
    const left = `${((index * 17) % 100).toFixed(1)}%`;
    const top = `${((index * 13) % 100).toFixed(1)}%`;
    const delay = `${((index * 0.17) % 4).toFixed(2)}s`;

    if (mode === 'rain') {
        const duration = `${(0.6 + (index % 5) * 0.15).toFixed(2)}s`;
        return {
            left,
            top: '-20px',
            animation: `rain-fall ${duration} linear infinite`,
            animationDelay: delay,
            transform: `rotate(${windAngle - 90}deg)`
        };
    } else if (mode === 'snow') {
        const duration = `${(3 + (index % 6) * 0.8).toFixed(2)}s`;
        return {
            left,
            top: '-10px',
            animation: `snow-fall ${duration} ease-in-out infinite`,
            animationDelay: delay,
        };
    } else if (mode === 'wind') {
        const duration = `${(1.2 + (index % 4) * 0.3).toFixed(2)}s`;
        const width = `${(80 + (index % 7) * 20)}px`;
        return {
            left: '-20%',
            top,
            width,
            animation: `wind-streak ${duration} linear infinite`,
            animationDelay: delay,
            transform: `rotate(${windAngle - 90}deg)`
        };
    }
    return {};
}
