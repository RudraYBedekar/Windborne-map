'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type WeatherType = 'rain' | 'snow' | 'wind' | 'none';

export default function WeatherEffects() {
    const [weather, setWeather] = useState<WeatherType>('none');
    const [particles, setParticles] = useState<number[]>([]);

    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        // Randomly select weather (removed 'none' for visibility assurance)
        const types: WeatherType[] = ['rain', 'snow', 'wind'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        setWeather(randomType);

        // Generate particle count based on type
        const count = randomType === 'rain' ? 150 : randomType === 'snow' ? 70 : 30;
        setParticles(Array.from({ length: count }, (_, i) => i));

        // Fade out after 6 seconds
        const timer = setTimeout(() => {
            setIsVisible(false);
        }, 6000);

        return () => clearTimeout(timer);
    }, []);

    if (weather === 'none') return null;

    return (
        <div
            className={cn(
                "absolute inset-0 pointer-events-none z-50 overflow-hidden transition-opacity duration-1000 ease-out",
                isVisible ? "opacity-100" : "opacity-0"
            )}
        >
            {particles.map((i) => {
                const style = getRandomStyle(weather, i);
                return (
                    <div
                        key={i}
                        className={cn(
                            "absolute",
                            weather === 'rain' && "w-[1px] h-4 bg-gradient-to-b from-blue-300/10 to-blue-400/60",
                            weather === 'snow' && "w-1.5 h-1.5 bg-white/60 rounded-full blur-[1px]",
                            weather === 'wind' && "h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent",
                        )}
                        style={style}
                    />
                );
            })}
            <style jsx>{`
                @keyframes fall {
                    0% { transform: translateY(-10vh); }
                    100% { transform: translateY(110vh); }
                }
                @keyframes snow-fall {
                    0% { transform: translate(0, -10vh); }
                    25% { transform: translate(20px, 20vh); }
                    50% { transform: translate(-20px, 50vh); }
                    75% { transform: translate(20px, 80vh); }
                    100% { transform: translate(0, 110vh); }
                }
                @keyframes wind-blow {
                    0% { transform: translateX(-10vw); opacity: 0; }
                    50% { opacity: 1; }
                    100% { transform: translateX(110vw); opacity: 0; }
                }
            `}</style>
        </div>
    );
}

function getRandomStyle(type: WeatherType, seed: number): React.CSSProperties {
    const random = (min: number, max: number) => Math.random() * (max - min) + min;

    const left = `${Math.random() * 100}%`;
    const delay = `${Math.random() * 5}s`;

    if (type === 'rain') {
        const duration = `${random(0.5, 1.5)}s`;
        return {
            left,
            top: `-${random(10, 20)}px`,
            animation: `fall ${duration} linear infinite`,
            animationDelay: delay,
            opacity: random(0.3, 0.7),
        };
    } else if (type === 'snow') {
        const duration = `${random(3, 8)}s`;
        return {
            left,
            top: '-10px',
            animation: `snow-fall ${duration} ease-in-out infinite`,
            animationDelay: delay,
            opacity: random(0.4, 0.9),
            transform: `scale(${random(0.5, 1.2)})`,
        };
    } else if (type === 'wind') {
        // Wind lines come from left, stick to random tops
        const top = `${Math.random() * 100}%`;
        const duration = `${random(1, 3)}s`;
        const width = `${random(50, 200)}px`;
        return {
            left: '-20%', // Start off screen
            top,
            width,
            animation: `wind-blow ${duration} ease-out infinite`,
            animationDelay: delay, // Stagger them
        };
    }
    return {};
}
