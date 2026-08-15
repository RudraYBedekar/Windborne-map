'use client';

import React from 'react';
import { CloudLightning, MapPin, Wind, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CycloneDetail } from '@/components/CycloneDetailPanel';

export interface CycloneListItem {
  id: string;
  storm: CycloneDetail;
  latitude?: number | null;
  longitude?: number | null;
  forecastHour?: number | null;
}

interface Props {
  items: CycloneListItem[];
  selectedId: string | null;
  loading?: boolean;
  error?: string | null;
  initTime?: string | null;
  onSelect: (id: string) => void;
}

function fmt(v: unknown, suffix = ''): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}${suffix}`;
  return String(v);
}

export default function CycloneListPanel({
  items,
  selectedId,
  loading,
  error,
  initTime,
  onSelect,
}: Props) {
  return (
    <div className="absolute top-3 left-3 z-30 w-[300px] max-w-[92vw] max-h-[min(70vh,520px)] flex flex-col rounded-xl border border-slate-700 bg-slate-950/95 backdrop-blur-xl shadow-2xl overflow-hidden font-mono">
      <div className="px-3 py-2.5 border-b border-slate-800 bg-slate-900/80 shrink-0">
        <div className="flex items-center gap-2 text-cyan-300 text-sm font-bold">
          <CloudLightning className="w-4 h-4 shrink-0" />
          <span>ACTIVE CYCLONES</span>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">
          {loading ? 'Loading WeatherMesh…' : `${items.length} storm${items.length === 1 ? '' : 's'}`}
          {initTime ? ` · init ${initTime}` : ''}
        </div>
      </div>

      <div className="overflow-y-auto p-2 space-y-1.5">
        {error && (
          <div className="text-[10px] text-rose-300 border border-rose-800/60 bg-rose-950/40 rounded-lg px-2 py-1.5">
            {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="text-[10px] text-slate-400 px-1 py-2">
            No active tropical cyclones from WeatherMesh right now.
          </div>
        )}
        {items.map((item) => {
          const name = item.storm.storm_name || item.id;
          const active = selectedId === item.id;
          const hasPos = item.latitude != null && item.longitude != null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                'w-full text-left rounded-lg border px-2.5 py-2 transition-colors',
                active
                  ? 'bg-cyan-950/80 border-cyan-600 text-cyan-100'
                  : 'bg-slate-900/70 border-slate-800 text-slate-200 hover:border-slate-600'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold truncate">{name}</span>
                <span className="text-[9px] text-slate-400 shrink-0">{item.id}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Wind className="w-3 h-3" />
                  {fmt(item.storm.max_wind_kt, ' kt')}
                </span>
                <span className="flex items-center gap-1">
                  <Gauge className="w-3 h-3" />
                  {fmt(item.storm.min_mslp_hpa, ' hPa')}
                </span>
              </div>
              <div className="mt-1 text-[9px] text-slate-400 flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                {hasPos
                  ? `${Number(item.latitude).toFixed(2)}°, ${Number(item.longitude).toFixed(2)}°`
                  : 'Position unavailable'}
                {(item.storm.basins || []).length > 0 && (
                  <span className="ml-auto text-slate-500">{(item.storm.basins || []).join(',')}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
