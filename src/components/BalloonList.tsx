'use client';

import React, { useMemo, useState } from 'react';
import { Balloon } from '@/services/windborne';
import { cn, formatTime } from '@/lib/utils';
import { ChevronRight, ArrowUpRight, Search } from 'lucide-react';

interface BalloonListProps {
    balloons: Balloon[];
    onSelect: (balloon: Balloon) => void;
    selectedId: string | null;
}

export default function BalloonList({ balloons, onSelect, selectedId }: BalloonListProps) {
    const [filter, setFilter] = useState('');
    const [sortBy, setSortBy] = useState<'id' | 'alt' | 'speed'>('alt');

    const filtered = useMemo(() => {
        let list = balloons.filter(b => b.id.toLowerCase().includes(filter.toLowerCase()));

        list.sort((a, b) => {
            const lastA = a.path[a.path.length - 1];
            const lastB = b.path[b.path.length - 1];

            if (sortBy === 'alt') {
                return (lastB?.alt || 0) - (lastA?.alt || 0);
            } else if (sortBy === 'id') {
                return a.id.localeCompare(b.id);
            }
            // Speed sort is harder without pre-calc, stick to Alt for now
            return 0;
        });

        return list;
    }, [balloons, filter, sortBy]);

    return (
        <div className="flex flex-col h-full bg-black/80 backdrop-blur-md border-r border-white/10 w-80 max-w-[90vw] transition-all">
            <div className="p-4 border-b border-white/10">
                <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-4">
                    Balloon Fleet
                </h2>

                <div className="relative mb-4">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search ID..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                </div>

                <div className="flex gap-2 text-xs">
                    <button
                        onClick={() => setSortBy('alt')}
                        className={cn("px-2 py-1 rounded transition-colors", sortBy === 'alt' ? "bg-white/20 text-white" : "text-gray-500 hover:text-white")}
                    >
                        Sort: Altitude
                    </button>
                    <button
                        onClick={() => setSortBy('id')}
                        className={cn("px-2 py-1 rounded transition-colors", sortBy === 'id' ? "bg-white/20 text-white" : "text-gray-500 hover:text-white")}
                    >
                        Sort: ID
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {filtered.map(b => {
                    const lastPoint = b.path[b.path.length - 1];
                    return (
                        <button
                            key={b.id}
                            onClick={() => onSelect(b)}
                            className={cn(
                                "w-full text-left p-3 rounded-lg border border-transparent transition-all group flex items-center justify-between",
                                selectedId === b.id
                                    ? "bg-blue-500/20 border-blue-500/50"
                                    : "hover:bg-white/5 hover:border-white/10"
                            )}
                        >
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span
                                        className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
                                        style={{ backgroundColor: b.color }}
                                    />
                                    <span className="font-mono font-medium text-gray-200 text-sm">{b.id}</span>
                                </div>
                                <div className="text-xs text-gray-500 font-mono flex gap-3">
                                    <span>{lastPoint?.alt.toFixed(1)}km</span>
                                    <span>{lastPoint?.lat.toFixed(1)}°N, {lastPoint?.lon.toFixed(1)}°E</span>
                                </div>
                            </div>
                            <ChevronRight className={cn("w-4 h-4 text-gray-600 transition-transform", selectedId === b.id ? "text-blue-400 translate-x-1" : "group-hover:text-gray-400")} />
                        </button>
                    )
                })}
            </div>
        </div>
    );
}
