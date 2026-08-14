'use client';

import React, { useState, useEffect } from 'react';
import { Globe, Search, RefreshCw, Compass, MapPin, X, Bot, Sparkles } from 'lucide-react';
import { cn, formatUTCTime } from '@/lib/utils';
import { Balloon, BackendHealthStatus } from '@/services/windborne';

interface SearchResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
}

interface NavbarProps {
    balloons: Balloon[];
    selectedId: string | null;
    onSelectBalloon: (id: string) => void;
    onSelectLocation: (lat: number, lon: number, name: string) => void;
    lastUpdated: Date | null;
    loading: boolean;
    onRefresh: () => void;
    healthStatus: BackendHealthStatus | null;
    onResetCamera: () => void;
    onToggleChat?: () => void;
    isChatOpen?: boolean;
}

export default function Navbar({
    balloons,
    selectedId,
    onSelectBalloon,
    onSelectLocation,
    lastUpdated,
    loading,
    onRefresh,
    healthStatus,
    onResetCamera,
    onToggleChat,
    isChatOpen = false
}: NavbarProps) {

    const [utcTime, setUtcTime] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchMenu, setShowSearchMenu] = useState(false);

    // Live UTC Clock
    useEffect(() => {
        const updateClock = () => setUtcTime(formatUTCTime(Date.now()));
        updateClock();
        const interval = setInterval(updateClock, 1000);
        return () => clearInterval(interval);
    }, []);

    // Nominatim Geocoding Debounce
    useEffect(() => {
        if (!searchQuery.trim() || searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`);
                if (res.ok) {
                    const data = await res.json();
                    setSearchResults(data);
                }
            } catch (err) {
                console.error("Geocoding search failed", err);
            } finally {
                setIsSearching(false);
            }
        }, 350);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Matching balloons by ID search
    const matchingBalloons = searchQuery.trim()
        ? balloons.filter(b => b.id.toLowerCase().includes(searchQuery.toLowerCase()))
        : [];

    return (
        <header className="h-14 w-full bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-3 md:px-5 flex items-center justify-between z-30 shrink-0 select-none">
            {/* Left: Brand */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                        <Globe className="w-4 h-4 animate-pulse" />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm md:text-base tracking-wide bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent">
                                WINDBORNE
                            </span>
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/50">
                                OPS 3D
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Center: Global Search Bar */}
            <div className="relative max-w-xs md:max-w-md w-full mx-2">
                <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search city (e.g. Tokyo, London, Paris) or balloon..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setShowSearchMenu(true);
                        }}
                        onFocus={() => setShowSearchMenu(true)}
                        className="w-full h-8 pl-8 pr-8 bg-slate-900/90 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => { setSearchQuery(''); setShowSearchMenu(false); }}
                            className="absolute right-2.5 text-slate-400 hover:text-slate-200"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Search Dropdown */}
                {showSearchMenu && (searchQuery.trim().length > 0) && (
                    <div className="absolute top-10 left-0 right-0 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl overflow-hidden z-50 max-h-72 overflow-y-auto divide-y divide-slate-800">
                        {/* Matching Balloons */}
                        {matchingBalloons.length > 0 && (
                            <div className="p-1.5">
                                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 font-mono">
                                    Matching Balloons ({matchingBalloons.length})
                                </div>
                                {matchingBalloons.slice(0, 4).map(b => (
                                    <button
                                        key={b.id}
                                        onClick={() => {
                                            onSelectBalloon(b.id);
                                            setShowSearchMenu(false);
                                        }}
                                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-cyan-950/60 flex items-center justify-between text-xs transition-colors"
                                    >
                                        <span className="font-mono font-bold text-cyan-400">{b.id}</span>
                                        <span className="text-[11px] text-slate-400 font-mono">
                                            {b.latestPoint ? `${Math.round(b.latestPoint.alt)}m` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Location Geocoding Results */}
                        <div className="p-1.5">
                            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 font-mono flex items-center justify-between">
                                <span>Global Cities & Places</span>
                                {isSearching && <span className="text-cyan-400 animate-pulse text-[9px]">Searching...</span>}
                            </div>
                            {searchResults.length === 0 && !isSearching && (
                                <div className="text-xs text-slate-500 px-2 py-1.5 font-mono">
                                    No place results found
                                </div>
                            )}
                            {searchResults.map(r => (
                                <button
                                    key={r.place_id}
                                    onClick={() => {
                                        onSelectLocation(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
                                        setShowSearchMenu(false);
                                    }}
                                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-slate-800/80 flex items-center gap-2 text-xs text-slate-300 transition-colors"
                                >
                                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                    <span className="truncate">{r.display_name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Right Controls: Clock & Controls */}
            <div className="flex items-center gap-2">
                <div className="hidden md:flex flex-col items-end text-right font-mono pr-2">
                    <span className="text-xs font-bold text-slate-200 tracking-wider">
                        {utcTime || '00:00:00 UTC'}
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono">SYSTEM CLOCK</span>
                </div>

                {onToggleChat && (
                    <button
                        onClick={onToggleChat}
                        title="Vicky-AI Amazon Bedrock Co-Pilot"
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all border",
                            isChatOpen
                                ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow-lg shadow-cyan-500/30"
                                : "bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border-cyan-700/60"
                        )}
                    >
                        <Bot className={cn("w-3.5 h-3.5", !isChatOpen && "animate-pulse text-cyan-400")} />
                        <span className="hidden sm:inline">Vicky-AI</span>
                    </button>
                )}

                <button
                    onClick={onResetCamera}
                    title="Reset Globe View"
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 rounded-md transition-colors"
                >
                    <Compass className="w-4 h-4 text-cyan-400" />
                </button>

                <button
                    onClick={onRefresh}
                    disabled={loading}
                    title="Force Telemetry Sync"
                    className="p-1.5 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-700/60 rounded-md transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                </button>
            </div>

        </header>
    );
}
