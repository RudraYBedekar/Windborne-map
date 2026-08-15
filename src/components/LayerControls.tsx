'use client';

import React, { useState, type ReactNode } from 'react';
import { Cloud, CloudRain, Layers, Thermometer, Wind, X, Info, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BASEMAP_OPTIONS,
  BasemapId,
  WEATHER_LAYER_OPTIONS,
  WeatherLayerId,
  mapKeys,
} from '@/config/map';

interface LayerControlsProps {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  weatherLayers: Record<WeatherLayerId, boolean>;
  onToggleWeather: (id: WeatherLayerId) => void;
  radarAgeLabel?: string | null;
  globeMode?: 'weather' | 'cyclones';
  onGlobeModeChange?: (mode: 'weather' | 'cyclones') => void;
  showEnsemble?: boolean;
  onToggleEnsemble?: () => void;
  meshVariable?: 'off' | 'temperature_2m' | 'wind_speed' | 'pressure_msl' | 'precipitation';
  onMeshVariableChange?: (v: 'off' | 'temperature_2m' | 'wind_speed' | 'pressure_msl' | 'precipitation') => void;
  cyclonesEnabled?: boolean;
  griddedEnabled?: boolean;
}

const WEATHER_ICONS: Record<WeatherLayerId, ReactNode> = {
  radar: <CloudRain className="w-3.5 h-3.5" />,
  clouds: <Cloud className="w-3.5 h-3.5" />,
  temp: <Thermometer className="w-3.5 h-3.5" />,
  wind: <Wind className="w-3.5 h-3.5" />,
  terminator: <Sun className="w-3.5 h-3.5 text-amber-400" />,
};

export default function LayerControls({
  basemap,
  onBasemapChange,
  weatherLayers,
  onToggleWeather,
  radarAgeLabel,
  globeMode = 'weather',
  onGlobeModeChange,
  showEnsemble = false,
  onToggleEnsemble,
  meshVariable = 'off',
  onMeshVariableChange,
  cyclonesEnabled = true,
  griddedEnabled = true,
}: LayerControlsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative pointer-events-auto select-none font-mono">
      {/* Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all shadow-xl backdrop-blur-md",
          isOpen
            ? "bg-cyan-950 border-cyan-500 text-cyan-300 shadow-cyan-950/40"
            : "bg-slate-950/90 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-900"
        )}
      >
        <Layers className="w-4 h-4 text-cyan-400" />
        <span className="uppercase tracking-wider">Layers</span>
      </button>

      {/* Layer Options Popover */}
      {isOpen && (
        <div className="absolute top-10 right-0 w-60 rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur-xl shadow-2xl overflow-hidden z-40 p-3 space-y-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>MAP & OVERLAYS</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Globe mode */}
          {onGlobeModeChange && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">MODE</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(['weather', 'cyclones'] as const).map((mode) => {
                  const locked = mode === 'cyclones' && !cyclonesEnabled;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={locked}
                      onClick={() => onGlobeModeChange(mode)}
                      className={cn(
                        'rounded-lg px-2.5 py-1.5 text-xs border capitalize',
                        locked && 'opacity-40 cursor-not-allowed',
                        globeMode === mode
                          ? 'bg-cyan-950/90 border-cyan-500/80 text-cyan-300 font-bold'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-400'
                      )}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
              {globeMode === 'cyclones' && onToggleEnsemble && (
                <button
                  type="button"
                  onClick={onToggleEnsemble}
                  className={cn(
                    'mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-[10px] border',
                    showEnsemble
                      ? 'bg-amber-950/80 border-amber-700 text-amber-200'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400'
                  )}
                >
                  {showEnsemble ? 'Ensemble / landfalls ON' : 'Show Ensemble Paths'}
                </button>
              )}
            </div>
          )}

          {/* WeatherMesh gridded */}
          {onMeshVariableChange && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">
                WEATHERMESH FORECAST
              </p>
              <div className="space-y-1">
                {(
                  [
                    ['off', 'Off'],
                    ['temperature_2m', 'Temperature'],
                    ['wind_speed', 'Wind'],
                    ['pressure_msl', 'Pressure'],
                    ['precipitation', 'Precipitation'],
                  ] as const
                ).map(([id, label]) => {
                  const locked = !griddedEnabled && id !== 'off';
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={locked}
                      onClick={() => onMeshVariableChange(id)}
                      className={cn(
                        'w-full rounded-lg px-2.5 py-1.5 text-xs border text-left',
                        locked && 'opacity-40 cursor-not-allowed',
                        meshVariable === id
                          ? 'bg-sky-950/90 border-sky-500/80 text-sky-200 font-bold'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-400'
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[9px] text-slate-500">Upstream refresh ≤ every 5 min (trial safe)</p>
            </div>
          )}

          {/* Basemap Switcher */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">
              BASEMAP STYLE
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {BASEMAP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onBasemapChange(opt.id)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-left transition-all border text-xs',
                    basemap === opt.id
                      ? 'bg-cyan-950/90 border-cyan-500/80 text-cyan-300 font-bold'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-850 hover:text-slate-200'
                  )}
                >
                  <div>{opt.label}</div>
                  <div className="text-[9px] text-slate-500 font-normal">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Weather Layers */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">
              WEATHER OVERLAYS
            </p>
            <div className="space-y-1">
              {WEATHER_LAYER_OPTIONS.filter(
                (opt) => !opt.requiresKey || mapKeys.hasOpenWeather
              ).map((opt) => {
                const active = weatherLayers[opt.id];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onToggleWeather(opt.id)}
                    title={
                      opt.id === 'radar' && radarAgeLabel
                        ? `Radar sync: ${radarAgeLabel}`
                        : undefined
                    }
                    className={cn(
                      'w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all border',
                      active && 'bg-sky-950/90 border-sky-500/80 text-sky-200 font-bold',
                      !active && 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:bg-slate-850 hover:text-slate-200'
                    )}
                  >
                    {WEATHER_ICONS[opt.id]}
                    <span className="flex-1 text-left">{opt.label}</span>
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-700'
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {weatherLayers.radar && radarAgeLabel && (
              <p className="mt-2 text-[9px] text-slate-500 flex items-center gap-1">
                <Info className="w-3 h-3 text-cyan-400 shrink-0" />
                Live Radar • {radarAgeLabel}
              </p>
            )}
            {mapKeys.hasOpenWeather && (
              <p className="mt-2 text-[9px] text-slate-500 leading-snug">
                Clouds / Temp / Wind: one layer at a time · OpenWeather capped at 50 req/min
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
