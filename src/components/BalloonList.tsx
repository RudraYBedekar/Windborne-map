'use client';

import React, { useMemo, useState } from 'react';
import { Balloon } from '@/services/windborne';
import { cn, formatAltitude, formatCoordinates, formatSpeed, formatHeading } from '@/lib/utils';
import { ChevronRight, Search, Shield, ArrowUpDown, Filter, Gauge, Navigation, ShieldCheck } from 'lucide-react';

interface BalloonListProps {
    balloons: Balloon[];
    onSelect: (balloon: Balloon) => void;
    selectedId: string | null;
}

type SortOption = 'altitude' | 'speed' | 'id' | 'duration';
type FilterOption = 'all' | 'active' | 'high_alt' | 'stale';

export default function BalloonList({ balloons, onSelect, selectedId }: BalloonListProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('altitude');
    const [filterBy, setFilterBy] = useState<FilterOption>('all');

    // Fleet Summary Metrics
    const metrics = useMemo(() => {
        const total = balloons.length;
        const highAlt = balloons.filter(b => (b.latestPoint?.alt || 0) >= 18000).length;
        const avgAlt = total > 0
            ? Math.round(balloons.reduce((acc, b) => acc + (b.latestPoint?.alt || 0), 0) / total)
            : 0;
        return { total, highAlt, avgAlt };
    }, [balloons]);

    // Filter & Sort Logic
    const processedList = useMemo(() => {
        let result = balloons.filter(b => {
            const matchesSearch = b.id.toLowerCase().includes(searchTerm.toLowerCase());
            if (!matchesSearch) return false;

            if (filterBy === 'high_alt') return (b.latestPoint?.alt || 0) >= 18000;
            if (filterBy === 'stale') return b.status === 'stale';
            if (filterBy === 'active') return b.status === 'active' || b.status === 'high_altitude';
            return true;
        });

        result.sort((a, b) => {
            const altA = a.latestPoint?.alt || 0;
            const altB = b.latestPoint?.alt || 0;
            if (sortBy === 'altitude') return altB - altA;
            if (sortBy === 'speed') return (b.currentSpeedKmh || 0) - (a.currentSpeedKmh || 0);
            if (sortBy === 'duration') return (b.flightDurationHours || 0) - (a.flightDurationHours || 0);
            if (sortBy === 'id') return a.id.localeCompare(b.id, undefined, { numeric: true });
            return 0;
        });

        return result;
    }, [balloons, searchTerm, sortBy, filterBy]);

    return (
        <div className="flex flex-col h-full bg-slate-950/95 backdrop-blur-xl border-r border-slate-800/80 w-80 md:w-84 max-w-[90vw] transition-all select-none z-20 shrink-0">
            {/* Header & Fleet Stats */}
            <div className="p-3.5 border-b border-slate-800/80 bg-slate-900/60">
                <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-cyan-400" />
                        <h2 className="text-sm font-bold font-mono tracking-wider text-slate-100 uppercase">
                            Fleet Intelligence
                        </h2>
                    </div>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                        {processedList.length} / {metrics.total}
                    </span>
                </div>

                {/* Metrics Summary Strip */}
                <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-center font-mono">
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase">Total</div>
                        <div className="text-xs font-bold text-slate-200">{metrics.total}</div>
                    </div>
                    <div className="border-x border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase">High Alt</div>
                        <div className="text-xs font-bold text-cyan-400">{metrics.highAlt}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase">Avg Alt</div>
                        <div className="text-xs font-bold text-indigo-300">
                            {formatAltitude(metrics.avgAlt).meters.replace(' m', 'm')}
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative mt-3">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Filter fleet ID..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                    />
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 mt-2.5 overflow-x-auto no-scrollbar font-mono text-[10px]">
                    {(['all', 'active', 'high_alt', 'stale'] as FilterOption[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilterBy(f)}
                            className={cn(
                                "px-2 py-0.5 rounded uppercase tracking-wider transition-colors shrink-0 border",
                                filterBy === f
                                    ? "bg-cyan-950 border-cyan-700/80 text-cyan-300 font-bold"
                                    : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
                            )}
                        >
                            {f.replace('_', ' ')}
                        </button>
                    ))}
                </div>

                {/* Sort Selector */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60 text-[10px] font-mono text-slate-400">
                    <span className="flex items-center gap-1 text-slate-500">
                        <ArrowUpDown className="w-3 h-3" /> SORT
                    </span>
                    <div className="flex gap-1.5">
                        {(['altitude', 'speed', 'duration', 'id'] as SortOption[]).map(s => (
                            <button
                                key={s}
                                onClick={() => setSortBy(s)}
                                className={cn(
                                    "hover:text-slate-200 uppercase transition-colors",
                                    sortBy === s ? "text-cyan-400 font-bold underline underline-offset-2" : "text-slate-500"
                                )}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Balloon List Items */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {processedList.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 font-mono">
                        No balloons match current filter options.
                    </div>
                ) : (
                    processedList.map(balloon => {
                        const isSelected = selectedId === balloon.id;
                        const alt = formatAltitude(balloon.latestPoint?.alt);
                        const speed = formatSpeed(balloon.currentSpeedKmh);

                        return (
                            <button
                                key={balloon.id}
                                onClick={() => onSelect(balloon)}
                                className={cn(
                                    "w-full text-left p-2.5 rounded-lg border transition-all flex items-center justify-between group",
                                    isSelected
                                        ? "bg-cyan-950/80 border-cyan-500/70 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                                        : "bg-slate-900/40 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700/80"
                                )}
                            >
                                <div className="space-y-1 w-full mr-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className="w-2 h-2 rounded-full ring-2 ring-slate-950"
                                                style={{ backgroundColor: balloon.color }}
                                            />
                                            <span className="font-mono font-bold text-slate-100 text-xs tracking-wider">
                                                {balloon.id}
                                            </span>
                                        </div>
                                        <span className={cn(
                                            "text-[9px] font-mono px-1.5 py-0.2 rounded border uppercase font-semibold",
                                            balloon.status === 'high_altitude'
                                                ? "bg-cyan-950 border-cyan-800 text-cyan-400"
                                                : balloon.status === 'stale'
                                                ? "bg-amber-950 border-amber-800 text-amber-400"
                                                : "bg-emerald-950 border-emerald-800 text-emerald-400"
                                        )}>
                                            {balloon.status === 'high_altitude' ? 'HIGH ALT' : balloon.status}
                                        </span>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-x-2 text-[11px] font-mono text-slate-400 pt-0.5">
                                        <div className="flex items-center gap-1 text-slate-300">
                                            <Gauge className="w-3 h-3 text-cyan-500 shrink-0" />
                                            <span>{alt.meters}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-slate-300">
                                            <Navigation className="w-3 h-3 text-indigo-400 shrink-0" />
                                            <span>{speed.kmh}</span>
                                        </div>
                                    </div>

                                    <div className="text-[10px] font-mono text-slate-500 flex justify-between pt-0.5 border-t border-slate-800/40">
                                        <span>{formatCoordinates(balloon.latestPoint?.lat, balloon.latestPoint?.lon)}</span>
                                        <span>{balloon.flightDurationHours}h history</span>
                                    </div>
                                </div>

                                <ChevronRight className={cn(
                                    "w-4 h-4 text-slate-600 transition-transform shrink-0",
                                    isSelected ? "text-cyan-400 translate-x-0.5" : "group-hover:text-slate-400"
                                )} />
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
