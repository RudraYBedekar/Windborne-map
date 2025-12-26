'use client';

import React, { useEffect, useState } from 'react';
import MapComponent from '@/components/Map';
import BalloonList from '@/components/BalloonList';
import WeatherEffects from '@/components/WeatherEffects';
import { Balloon, fetchWindBorneData } from '@/services/windborne';
import { RefreshCw, Menu, X, Globe, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Home() {
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [autoRotate, setAutoRotate] = useState(true);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWindBorneData();
      if (data.length === 0) {
        setError("No data available (API might be empty or blocked).");
      } else {
        setBalloons(data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load balloon data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-black text-white selection:bg-blue-500/30">
      <WeatherEffects />

      {/* Sidebar - Collapsible */}
      <div className={cn(
        "h-full z-20 transition-all duration-300 ease-in-out absolute md:relative shadow-2xl md:shadow-none",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:w-0 md:overflow-hidden md:translate-x-0"
      )}>
        <BalloonList
          balloons={balloons}
          selectedId={selectedId}
          onSelect={(b) => { setSelectedId(b.id); setAutoRotate(false); }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 relative flex flex-col h-full w-full">

        {/* Top Bar Overlay */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between pointer-events-none">

          {/* Left Controls */}
          <div className="flex flex-col gap-2 pointer-events-auto">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 bg-black/80 backdrop-blur border border-white/20 rounded-lg hover:bg-white/10 transition-colors text-white"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <div className="bg-black/80 backdrop-blur p-4 rounded-xl border border-white/10 shadow-xl max-w-sm">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                Windborne Weather Map
              </h1>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                <span className={cn("w-2 h-2 rounded-full", loading ? "bg-yellow-400 animate-pulse" : error ? "bg-red-500" : "bg-green-500")} />
                <span>{loading ? "Syncing..." : error ? "Offline" : `${balloons.length} Balloons Active`}</span>
              </div>
              {error && (
                <div className="mt-2 text-red-300 text-[10px] leading-tight">
                  {error} <button onClick={loadData} className="underline hover:text-white">Retry</button>
                </div>
              )}
            </div>
          </div>

          {/* Right Controls */}
          <div className="pointer-events-auto flex gap-2">
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={cn(
                "p-2.5 rounded-full text-white shadow-lg transition-all active:scale-95",
                autoRotate ? "bg-purple-600 hover:bg-purple-500 shadow-purple-900/20" : "bg-gray-700 hover:bg-gray-600"
              )}
              title="Toggle Auto-Rotate"
            >
              <Globe className={cn("w-5 h-5", autoRotate && "animate-spin-slow")} />
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              title="Refresh Data"
            >
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Map Area */}
        <div className="flex-1 h-full w-full">
          <MapComponent
            balloons={balloons}
            selectedId={selectedId}
            onSelectBalloon={(id) => { setSelectedId(id); if (id) setAutoRotate(false); }}
            autoRotate={autoRotate}
          />
        </div>

      </div>
    </main>
  );
}
