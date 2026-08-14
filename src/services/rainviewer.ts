export interface RainViewerFrame {
  path: string;
  time: number;
}

export interface RainViewerMaps {
  host: string;
  radar: {
    past: RainViewerFrame[];
    nowcast: RainViewerFrame[];
  };
}

/**
 * Free real-time precipitation radar (no API key).
 * Docs: https://www.rainviewer.com/api.html
 */
export async function fetchRainViewerMaps(): Promise<RainViewerMaps | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`RainViewer ${res.status}`);
    return (await res.json()) as RainViewerMaps;
  } catch (err) {
    console.error('Failed to fetch RainViewer maps', err);
    return null;
  }
}

/** Latest past radar frame tile template for MapLibre raster source */
export function buildRadarTileUrl(maps: RainViewerMaps): string | null {
  const frames = [...(maps.radar.past || []), ...(maps.radar.nowcast || [])];
  if (frames.length === 0) return null;
  const latest = frames[frames.length - 1];
  // color=2 (universal blue), options=1_1 (smooth + snow)
  return `${maps.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
}
