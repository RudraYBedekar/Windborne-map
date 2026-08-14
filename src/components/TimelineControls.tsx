'use client';

import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, FastForward, Clock, Radio } from 'lucide-react';
import { cn, formatUTCTime } from '@/lib/utils';

interface TimelineControlsProps {
    minTime: number; // 24 hours ago epoch ms
    maxTime: number; // Current Live epoch ms
    currentTime: number; // Currently scrubbed epoch ms
    onChangeTime: (time: number) => void;
    isPlaying: boolean;
    onTogglePlay: () => void;
    playbackSpeed: number;
    onChangeSpeed: (speed: number) => void;
    onJumpToLive: () => void;
}

export default function TimelineControls({
    minTime,
    maxTime,
    currentTime,
    onChangeTime,
    isPlaying,
    onTogglePlay,
    playbackSpeed,
    onChangeSpeed,
    onJumpToLive
}: TimelineControlsProps) {
    const isLive = Math.abs(maxTime - currentTime) < 60000;
    const progressPercent = maxTime > minTime
        ? Math.min(Math.max(((currentTime - minTime) / (maxTime - minTime)) * 100, 0), 100)
        : 100;

    // Time difference display e.g. "-4h 15m" or "LIVE"
    const diffHours = ((maxTime - currentTime) / (1000 * 3600)).toFixed(1);

    return (
        <div className="absolute bottom-4 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-2xl z-20 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl p-2.5 md:p-3 font-mono text-slate-200 select-none">
            {/* Top Info Bar */}
            <div className="flex items-center justify-between text-xs mb-2 px-1">
                <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="font-bold tracking-wider text-slate-100">
                        {formatUTCTime(currentTime)}
                    </span>
                    <span className="text-[10px] text-slate-500 font-semibold">
                        {isLive ? '(LIVE)' : `(-${diffHours}h)`}
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    {/* Playback Speeds */}
                    <div className="flex bg-slate-900 border border-slate-800 rounded p-0.5 text-[10px]">
                        {[0.5, 1, 2, 4].map(s => (
                            <button
                                key={s}
                                onClick={() => onChangeSpeed(s)}
                                className={cn(
                                    "px-1.5 py-0.5 rounded font-bold transition-colors",
                                    playbackSpeed === s ? "bg-cyan-950 text-cyan-400 border border-cyan-800" : "text-slate-500 hover:text-slate-300"
                                )}
                            >
                                {s}x
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={onJumpToLive}
                        className={cn(
                            "px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all border",
                            isLive
                                ? "bg-emerald-950/80 border-emerald-700 text-emerald-400"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-100"
                        )}
                    >
                        <Radio className={cn("w-3 h-3", isLive && "animate-pulse")} />
                        LIVE
                    </button>
                </div>
            </div>

            {/* Range Scrubber Bar */}
            <div className="relative flex items-center my-1.5 px-1">
                <div className="absolute left-1 right-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-cyan-600 to-sky-400 rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <input
                    type="range"
                    min={minTime}
                    max={Math.max(maxTime, minTime + 1)}
                    step={60_000}
                    value={Math.min(Math.max(currentTime, minTime), Math.max(maxTime, minTime + 1))}
                    onChange={(e) => onChangeTime(Number(e.target.value))}
                    className="w-full h-4 opacity-0 cursor-pointer z-10"
                />
            </div>

            {/* Playback Control Buttons */}
            <div className="flex items-center justify-between text-xs pt-1 px-1">
                <span className="text-[10px] text-slate-500">-24 HOURS</span>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onChangeTime(Math.max(minTime, currentTime - 3600000))}
                        className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded border border-slate-800 transition-colors"
                        title="Step Back 1 Hour"
                    >
                        <SkipBack className="w-3.5 h-3.5" />
                    </button>

                    <button
                        onClick={onTogglePlay}
                        className="p-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-full shadow-lg shadow-cyan-950/50 transition-transform active:scale-95"
                        title={isPlaying ? "Pause Playback" : "Play Telemetry History"}
                    >
                        {isPlaying ? <Pause className="w-4 h-4 fill-slate-950" /> : <Play className="w-4 h-4 fill-slate-950 ml-0.5" />}
                    </button>

                    <button
                        onClick={() => onChangeTime(Math.min(maxTime, currentTime + 3600000))}
                        className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded border border-slate-800 transition-colors"
                        title="Step Forward 1 Hour"
                    >
                        <SkipForward className="w-3.5 h-3.5" />
                    </button>
                </div>

                <span className="text-[10px] text-slate-500">LIVE NOW</span>
            </div>
        </div>
    );
}
