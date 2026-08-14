export type BasemapId = 'google-roads' | 'google-hybrid' | 'earth' | 'dark' | 'google-terrain';

export type WeatherLayerId = 'radar' | 'clouds' | 'temp' | 'wind' | 'terminator';

const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() || '';
const openWeatherKey = process.env.NEXT_PUBLIC_OPENWEATHER_KEY?.trim() || '';
const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || '';

export const mapKeys = {
  mapTiler: mapTilerKey,
  openWeather: openWeatherKey,
  googleMaps: googleMapsKey,
  hasMapTiler: mapTilerKey.length > 0,
  hasOpenWeather: openWeatherKey.length > 0,
  hasGoogleMaps: googleMapsKey.length > 0,
};

/** Google Earth–like sky / atmosphere for globe projection (MapLibre setSky) */
export const EARTH_SKY = {
  'sky-color': '#0a1628',
  'horizon-color': '#7eb6e8',
  'fog-color': '#c5d8eb',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.4,
  'atmosphere-blend': 0.85,
} as const;

/** Google Maps high-resolution tile subdomains for performance */
const GOOGLE_TILE_SERVERS = (lyrs: string) => [
  `https://mt0.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
  `https://mt1.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
  `https://mt2.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
  `https://mt3.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
];

/**
 * Google raster tiles are available roughly through z19.
 * Source maxzoom must match real tile depth so MapLibre overscales
 * parent tiles instead of requesting unsupported higher zooms.
 */
const GOOGLE_TILE_MAX_ZOOM = 19;

function createGoogleRasterStyle(lyrs: string, name: string): object {
  return {
    version: 8,
    name,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'google-tiles': {
        type: 'raster',
        tiles: GOOGLE_TILE_SERVERS(lyrs),
        tileSize: 256,
        attribution: '© Google Maps',
        minzoom: 0,
        maxzoom: GOOGLE_TILE_MAX_ZOOM,
      },
    },
    layers: [
      {
        id: 'google-tiles-layer',
        type: 'raster',
        source: 'google-tiles',
        minzoom: 0,
        // No layer maxzoom cap — stay visible while map overscales past source maxzoom
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
    ],
  };
}

export function getBasemapStyle(id: BasemapId): string | object {
  switch (id) {
    case 'google-roads':
      return createGoogleRasterStyle('m', 'Google Roads');
    case 'google-hybrid':
      return createGoogleRasterStyle('y', 'Google Hybrid');
    case 'earth':
      return createGoogleRasterStyle('s', 'Google Satellite');
    case 'google-terrain':
      return createGoogleRasterStyle('p', 'Google Terrain');
    case 'dark':
    default:
      return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  }
}

export const BASEMAP_OPTIONS: { id: BasemapId; label: string; hint: string }[] = [
  { id: 'google-roads', label: 'Google Roads', hint: 'Full streets & map' },
  { id: 'google-hybrid', label: 'Google Hybrid', hint: 'Sat + Google roads' },
  { id: 'earth', label: 'Google Sat', hint: 'Satellite view' },
  { id: 'google-terrain', label: 'Google Terrain', hint: 'Elevation & roads' },
  { id: 'dark', label: 'Dark Cyber', hint: 'Night weather map' },
];

export const WEATHER_LAYER_OPTIONS: {
  id: WeatherLayerId;
  label: string;
  requiresKey?: boolean;
}[] = [
  { id: 'radar', label: 'Radar' },
  { id: 'clouds', label: 'Clouds', requiresKey: true },
  { id: 'temp', label: 'Temp', requiresKey: true },
  { id: 'wind', label: 'Wind', requiresKey: true },
  { id: 'terminator', label: 'Day/Night' },
];

/** OpenWeatherMap raster tile URL (needs NEXT_PUBLIC_OPENWEATHER_KEY) */
export function getOpenWeatherTileUrl(layer: Exclude<WeatherLayerId, 'radar'>): string | null {
  if (!mapKeys.hasOpenWeather) return null;
  const layerPath =
    layer === 'clouds' ? 'clouds_new' : layer === 'temp' ? 'temp_new' : 'wind_new';
  return `https://tile.openweathermap.org/map/${layerPath}/{z}/{x}/{y}.png?appid=${openWeatherKey}`;
}

/** MapTiler or public Terrarium DEM source — enables true 3D terrain elevation mesh */
export function getTerrainSource(): { tiles: string[]; encoding: 'mapbox' | 'terrarium' } | null {
  if (mapKeys.hasMapTiler) {
    return {
      tiles: [
        `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${mapTilerKey}`,
      ],
      encoding: 'mapbox',
    };
  }
  return {
    tiles: [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    ],
    encoding: 'terrarium',
  };
}

