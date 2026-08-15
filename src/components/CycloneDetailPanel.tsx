'use client';

import React from 'react';
import { X, CloudLightning, Wind, Gauge, Clock, MapPin, Info } from 'lucide-react';

export interface CycloneDetail {
  tropical_cyclone_id?: string;
  storm_name?: string | null;
  basins?: string[];
  start_time?: string | null;
  end_time?: string | null;
  max_wind_kt?: number | null;
  min_mslp_hpa?: number | null;
  path?: Array<Record<string, unknown>>;
  landfalls?: Array<Record<string, unknown>>;
  cone?: { members_total?: number; max_forecast_hour?: number } | null;
  genesis?: { latitude?: number; longitude?: number } | null;
}

interface Props {
  cyclone: CycloneDetail;
  forecastHour: number;
  point?: Record<string, unknown> | null;
  initializationTime?: string | null;
  onClose: () => void;
}

function fmt(v: unknown, suffix = ''): string {
  if (v === null || v === undefined || v === '') return 'Unavailable';
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}${suffix}`;
  return String(v);
}

export default function CycloneDetailPanel({
  cyclone,
  forecastHour,
  point,
  initializationTime,
  onClose,
}: Props) {
  const name = cyclone.storm_name || cyclone.tropical_cyclone_id || 'Cyclone';

  return (
    <div className="absolute top-3 left-3 z-30 w-[320px] max-w-[92vw] rounded-xl border border-slate-700 bg-slate-950/95 backdrop-blur-xl shadow-2xl overflow-hidden font-mono">
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-slate-800 bg-slate-900/80">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-cyan-300 text-sm font-bold">
            <CloudLightning className="w-4 h-4 shrink-0" />
            <span className="truncate">{name}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            {cyclone.tropical_cyclone_id || 'ID unavailable'} · {(cyclone.basins || []).join(',') || 'basin n/a'}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
            <div className="text-[9px] text-slate-500 flex items-center gap-1"><Wind className="w-3 h-3" /> MAX WIND</div>
            <div className="text-slate-100 font-bold mt-1">{fmt(point?.max_wind_kt ?? cyclone.max_wind_kt, ' kt')}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
            <div className="text-[9px] text-slate-500 flex items-center gap-1"><Gauge className="w-3 h-3" /> MIN MSLP</div>
            <div className="text-slate-100 font-bold mt-1">{fmt(point?.min_mslp_hpa ?? cyclone.min_mslp_hpa, ' hPa')}</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2 space-y-1 text-[10px] text-slate-300">
          <div className="flex items-center gap-1 text-slate-500"><Clock className="w-3 h-3" /> FORECAST</div>
          <div>Hour: <span className="text-cyan-300">+{forecastHour}h</span></div>
          <div>Type: {fmt(point?.storm_type)}</div>
          <div>Init: {fmt(initializationTime)}</div>
          <div>Valid: {fmt(point?.valid_at)}</div>
          <div className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-cyan-400" />
            {point?.latitude != null && point?.longitude != null
              ? `${Number(point.latitude).toFixed(2)}°, ${Number(point.longitude).toFixed(2)}°`
              : 'Position unavailable'}
          </div>
        </div>

        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-2 text-[10px] text-amber-200/90 leading-snug">
          <div className="flex items-center gap-1 font-bold mb-1"><Info className="w-3 h-3" /> Forecast Cone</div>
          Represents the WeatherMesh ensemble-supported range of plausible cyclone positions.
          Not a guaranteed storm-impact region.
          {cyclone.cone?.members_total != null && (
            <div className="mt-1 text-amber-300/80">Ensemble members: {cyclone.cone.members_total}</div>
          )}
        </div>

        <div className="text-[10px] text-slate-500">
          Path points: {cyclone.path?.length ?? 0} · Landfalls (members): {cyclone.landfalls?.length ?? 0}
        </div>
      </div>
    </div>
  );
}
