'use client';

import React, { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BASEMAP_OPTIONS, BasemapId } from '@/config/map';

interface LayerControlsProps {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  weatherLayers?: Record<string, boolean>;
  onToggleWeather?: (id: never) => void;
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

export default function LayerControls({
  basemap,
  onBasemapChange,
  globeMode = 'weather',
  onGlobeModeChange,
  showEnsemble = false,
  onToggleEnsemble,
  cyclonesEnabled = true,
}: LayerControlsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative pointer-events-auto select-none font-mono">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all shadow-xl backdrop-blur-md',
          isOpen
            ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-cyan-950/40'
            : 'bg-slate-950/90 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-900'
        )}
      >
        <Layers className="w-4 h-4 text-cyan-400" />
        <span className="uppercase tracking-wider">Layers</span>
      </button>

      {isOpen && (
        <div className="absolute top-10 right-0 w-60 rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur-xl shadow-2xl overflow-hidden z-40 p-3 space-y-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>MAP CONTROLS</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

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
              <p className="mt-1.5 text-[9px] text-slate-500 leading-snug">
                Switch to Cyclones to track live tropical storms on the globe.
              </p>
            </div>
          )}

          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">BASEMAP</p>
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
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200'
                  )}
                >
                  <div>{opt.label}</div>
                  <div className="text-[9px] text-slate-500 font-normal">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
