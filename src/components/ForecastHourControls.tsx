'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  hours: readonly number[] | number[];
  value: number;
  onChange: (hour: number) => void;
  hint?: string | null;
}

export default function ForecastHourControls({ label, hours, value, onChange, hint }: Props) {
  return (
    <div className="absolute bottom-4 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-xl z-20 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl p-2.5 font-mono text-slate-200 select-none">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-bold tracking-wider">{label}</span>
          <span className="text-cyan-300 font-bold">+{value}h</span>
        </div>
        {hint && <span className="text-[9px] text-slate-500 truncate max-w-[50%]">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {hours.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onChange(h)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors',
              value === h
                ? 'bg-cyan-950 border-cyan-600 text-cyan-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            )}
          >
            +{h}h
          </button>
        ))}
      </div>
    </div>
  );
}
