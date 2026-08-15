import type { FeatureCollection } from 'geojson';
import type { CycloneDetail } from '@/components/CycloneDetailPanel';

export const CYCLONE_FORECAST_HOURS = [0, 12, 24, 48, 72, 120] as const;
export const GRID_FORECAST_HOURS = [0, 3, 6, 12, 24, 48, 72] as const;

export type MeshVariable =
  | 'off'
  | 'temperature_2m'
  | 'wind_speed'
  | 'pressure_msl'
  | 'precipitation';

export interface CycloneListResponse {
  ok: boolean;
  error?: string;
  message?: string;
  tropical_cyclones?: Record<string, CycloneDetail>;
  total?: number;
  initialization_time?: string | null;
  forecast_zero?: string | null;
  from_cache?: boolean;
  warning?: string;
  provider?: string;
  model?: string;
}

export interface CycloneDetailResponse {
  ok: boolean;
  cyclone?: CycloneDetail;
  point?: Record<string, unknown> | null;
  forecast_hour?: number;
  initialization_time?: string | null;
  cone_caption?: string;
  basin_labels?: string[];
  route_summary?: {
    points: number;
    status?: string;
    note?: string;
    start?: { lat?: number | null; lon?: number | null; valid_at?: string | null } | null;
    end?: { lat?: number | null; lon?: number | null; valid_at?: string | null } | null;
  } | null;
  region?: {
    ok?: boolean;
    region_label?: string;
    country?: string | null;
    ocean_or_sea?: string | null;
    display_name?: string;
  } | null;
  brief?: Record<string, unknown>;
  error?: string;
  message?: string;
}

export interface MeshStatus {
  wb_gate?: {
    min_interval_seconds?: number;
    seconds_until_next_allowed_fetch?: number;
  };
  cyclones?: { enabled?: boolean; has_wb_key?: boolean };
  gridded?: { enabled?: boolean; has_wb_key?: boolean };
  cyclone_forecast_hours?: number[];
  grid_forecast_hours?: number[];
}

export async function fetchMeshStatus(): Promise<MeshStatus | null> {
  try {
    const res = await fetch('/api/weather/mesh-status', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as MeshStatus;
  } catch {
    return null;
  }
}

export async function fetchCyclonesGeoJson(opts: {
  forecastHour: number;
  includeEnsemble?: boolean;
  selectedId?: string | null;
}): Promise<{ geojson: FeatureCollection | null; meta: CycloneListResponse | null; error?: string }> {
  const params = new URLSearchParams({
    geojson: 'true',
    include_details: 'true',
    forecast_hour: String(opts.forecastHour),
    include_ensemble: opts.includeEnsemble ? 'true' : 'false',
  });
  if (opts.selectedId) params.set('selected_id', opts.selectedId);

  try {
    const res = await fetch(`/api/cyclones?${params}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) {
      return {
        geojson: null,
        meta: null,
        error: data?.detail?.message || data?.message || data?.error || `HTTP ${res.status}`,
      };
    }
    if (data?.type === 'FeatureCollection') {
      return { geojson: data as FeatureCollection, meta: (data.properties as CycloneListResponse) || null };
    }
    return { geojson: null, meta: data as CycloneListResponse, error: data?.message || 'Unexpected response' };
  } catch (e) {
    return { geojson: null, meta: null, error: String(e) };
  }
}

export async function fetchCyclonesList(): Promise<{
  ok: boolean;
  storms: Record<string, CycloneDetail>;
  initialization_time?: string | null;
  error?: string;
  message?: string;
}> {
  try {
    const res = await fetch('/api/cyclones?include_details=true', { cache: 'no-store' });
    const data = (await res.json()) as CycloneListResponse & { detail?: { message?: string } };
    if (!res.ok) {
      return {
        ok: false,
        storms: {},
        error: data.error || `HTTP ${res.status}`,
        message: data.message || data.detail?.message,
      };
    }
    return {
      ok: Boolean(data.ok),
      storms: data.tropical_cyclones || {},
      initialization_time: data.initialization_time,
      error: data.error,
      message: data.message,
    };
  } catch (e) {
    return { ok: false, storms: {}, error: 'FETCH_FAILED', message: String(e) };
  }
}

export async function fetchCycloneDetail(
  id: string,
  forecastHour: number
): Promise<CycloneDetailResponse> {
  try {
    const res = await fetch(
      `/api/cyclones/${encodeURIComponent(id)}?forecast_hour=${forecastHour}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: data?.detail?.error || data?.error || `HTTP ${res.status}`,
        message: data?.detail?.message || data?.message,
      };
    }
    return data as CycloneDetailResponse;
  } catch (e) {
    return { ok: false, error: 'FETCH_FAILED', message: String(e) };
  }
}

/** Build PNG overlay URL for WeatherMesh gridded layer (proxied; backend enforces 5‑min gate). */
export function meshPngUrl(
  variable: Exclude<MeshVariable, 'off'>,
  forecastHour: number,
  bbox = '-130,20,-60,55'
): string {
  const params = new URLSearchParams({
    variable,
    forecast_hour: String(forecastHour),
    bbox,
    format: 'png',
    resolution: '128',
  });
  return `/api/weather/grid?${params}`;
}

export function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  return [west, south, east, north];
}
