'use client';

import * as React from 'react';
import Map, { Source, Layer, MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Balloon, LocationFilter } from '@/services/windborne';
import { buildRadarTileUrl, fetchRainViewerMaps } from '@/services/rainviewer';
import { getTerminatorGeoJSON } from '@/lib/sun';
import {
  BasemapId,
  EARTH_SKY,
  WeatherLayerId,
  getBasemapStyle,
  getOpenWeatherTileUrl,
  OPENWEATHER_TILE_MAX_ZOOM,
} from '@/config/map';
import LayerControls from '@/components/LayerControls';
import type { FeatureCollection, Feature } from 'geojson';
import type { MeshVariable } from '@/services/cyclones';
import { parseBbox } from '@/services/cyclones';

interface MapComponentProps {
  balloons: Balloon[];
  selectedId: string | null;
  onSelectBalloon: (id: string | null) => void;
  selectedLocation?: LocationFilter | null;
  onSelectLocation?: (loc: LocationFilter | null) => void;
  autoRotate?: boolean;
  scrubTime?: number;
  trackSelected?: boolean;
  onStopTracking?: () => void;
  globeMode?: 'weather' | 'cyclones';
  onGlobeModeChange?: (mode: 'weather' | 'cyclones') => void;
  cycloneGeoJson?: FeatureCollection | null;
  selectedCycloneId?: string | null;
  onSelectCyclone?: (id: string | null) => void;
  showEnsemble?: boolean;
  onToggleEnsemble?: () => void;
  meshVariable?: MeshVariable;
  onMeshVariableChange?: (v: MeshVariable) => void;
  meshImageUrl?: string | null;
  meshBbox?: string;
  cyclonesEnabled?: boolean;
  griddedEnabled?: boolean;
}

const POIs = [
    {
        id: 'poi-norfolk',
    name: 'Norfolk Launch Site',
        lat: 36.8508,
        lon: -76.2859,
    desc: 'Strategic high-altitude payload launch facility.',
  },
];

const DEFAULT_WEATHER: Record<WeatherLayerId, boolean> = {
  radar: true,
  clouds: false,
  temp: false,
  wind: false,
  terminator: true,
};

const BALLOON_HIT_LAYERS = ['balloon-hit', 'balloon-points', 'balloon-points-halo', 'balloon-pulsing'];
const CYCLONE_HIT_LAYERS = ['cyclone-position', 'cyclone-position-halo', 'cyclone-mean-path', 'cyclone-cone'];

function setupMapAssets(map: MaplibreMap) {
  try {
    // Wait until style/projection exist — avoids MapLibre
    // "Cannot read properties of undefined (reading 'shaderPreludeCode')"
    if (!map.getStyle() || !(map as any).style?.projection) return;

    try {
      map.setSky({ ...EARTH_SKY });
    } catch {
      // Sky optional on some basemaps
    }

    // Terrain + globe + style swaps triggers shaderPreludeCode crashes in MapLibre 5.
    // Keep globe stable and skip DEM for now.
    try {
      map.setTerrain(null);
    } catch {
      // ignore
    }

    if (map.hasImage('balloon-icon')) map.removeImage('balloon-icon');
                        const img = new Image();
    img.src = '/balloon.svg?v=3';
                        img.onload = () => {
      try {
        if (map.getStyle() && !map.hasImage('balloon-icon')) map.addImage('balloon-icon', img);
      } catch {
        // style may have swapped mid-load
      }
    };

    if (map.getStyle() && !map.hasImage('pulsing-dot')) {
                    const size = 150;
                    const pulsingDot = {
                        width: size,
                        height: size,
                        data: new Uint8ClampedArray(size * size * 4),
                        context: null as CanvasRenderingContext2D | null,
        onAdd() {
                            const canvas = document.createElement('canvas');
                            canvas.width = this.width;
                            canvas.height = this.height;
                            this.context = canvas.getContext('2d');
                        },
        render() {
                            const duration = 1500;
                            const t = (performance.now() % duration) / duration;
                            const context = this.context;
                            if (!context) return false;

                            const radius = (size / 2) * 0.3;
                            const outerRadius = (size / 2) * 0.7 * t + radius;
                            const alpha = 1 - t;

                            context.clearRect(0, 0, this.width, this.height);
                            context.beginPath();
                            context.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
          context.fillStyle = `rgba(6, 182, 212, ${alpha})`;
                            context.fill();

                            context.beginPath();
                            context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
          context.fillStyle = 'rgba(6, 182, 212, 0.9)';
                            context.strokeStyle = 'white';
                            context.lineWidth = 2;
                            context.fill();
                            context.stroke();

                            this.data = context.getImageData(0, 0, this.width, this.height).data;
                            map.triggerRepaint();
                            return true;
        },
      };
      try {
        map.addImage('pulsing-dot', pulsingDot, { pixelRatio: 2 });
      } catch {
        // ignore duplicate/race
      }
    }
  } catch (err) {
    console.warn('Map asset setup warning:', err);
  }
}

export default function MapComponent({
  balloons,
  selectedId,
  onSelectBalloon,
  selectedLocation,
  onSelectLocation,
  autoRotate = false,
  scrubTime,
  trackSelected = false,
  onStopTracking,
  globeMode = 'weather',
  onGlobeModeChange,
  cycloneGeoJson = null,
  selectedCycloneId = null,
  onSelectCyclone,
  showEnsemble = false,
  onToggleEnsemble,
  meshVariable = 'off',
  onMeshVariableChange,
  meshImageUrl = null,
  meshBbox = '-130,20,-60,55',
  cyclonesEnabled = true,
  griddedEnabled = true,
}: MapComponentProps) {
  const mapRef = React.useRef<MapRef>(null);
  const isProgrammaticMove = React.useRef(false);

  const [basemap, setBasemap] = React.useState<BasemapId>('google-roads');
  const [weatherLayers, setWeatherLayers] = React.useState<Record<WeatherLayerId, boolean>>(DEFAULT_WEATHER);
  const [radarTileUrl, setRadarTileUrl] = React.useState<string | null>(null);
  const [radarAgeLabel, setRadarAgeLabel] = React.useState<string | null>(null);
  const [pathProgress, setPathProgress] = React.useState(1);

  const animFrameRef = React.useRef<number | null>(null);

  const mapStyle = React.useMemo(() => getBasemapStyle(basemap), [basemap]);

  // Day/Night Solar Terminator live state & memoized polygon calculation
  const [liveTime, setLiveTime] = React.useState(Date.now());
  React.useEffect(() => {
    const interval = setInterval(() => {
      setLiveTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const terminatorGeoJson = React.useMemo(() => {
    const timeMs = scrubTime || liveTime;
    return getTerminatorGeoJSON(timeMs);
  }, [scrubTime, liveTime]);

  const cloudTiles = React.useMemo(() => getOpenWeatherTileUrl('clouds'), []);
  const tempTiles = React.useMemo(() => getOpenWeatherTileUrl('temp'), []);
  const windTiles = React.useMemo(() => getOpenWeatherTileUrl('wind'), []);

  // Re-apply atmosphere / icons after basemap style swaps (deferred until projection ready)
  React.useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const apply = () => {
      // Defer one frame so MapLibre finishes wiring style.projection
      requestAnimationFrame(() => setupMapAssets(map));
    };

    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [basemap, mapStyle]);

  // RainViewer live radar tile sync
  const refreshRadar = React.useCallback(async () => {
    try {
      const data = await fetchRainViewerMaps();
      if (data?.radar?.past?.length) {
        const latest = data.radar.past[data.radar.past.length - 1];
        setRadarTileUrl(buildRadarTileUrl(data));
        const minAgo = Math.round((Date.now() - latest.time * 1000) / 60000);
        setRadarAgeLabel(minAgo <= 1 ? 'Just now' : `${minAgo}m ago`);
      }
    } catch {
      setRadarTileUrl(null);
      setRadarAgeLabel(null);
    }
  }, []);

  React.useEffect(() => {
    if (weatherLayers.radar) refreshRadar();
    const interval = setInterval(() => {
      if (weatherLayers.radar) refreshRadar();
    }, 300000);
    return () => clearInterval(interval);
  }, [weatherLayers.radar, refreshRadar]);

  const toggleWeather = (id: WeatherLayerId) => {
    setWeatherLayers((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      // Only one OpenWeather raster at a time — keeps RPM under the 50/min budget
      if (next[id] && (id === 'clouds' || id === 'temp' || id === 'wind')) {
        next.clouds = id === 'clouds';
        next.temp = id === 'temp';
        next.wind = id === 'wind';
      }
      return next;
    });
  };

  // Globe auto-rotation
  React.useEffect(() => {
    if (!autoRotate || !mapRef.current) return;

    let rotationFrame: number;
    const rotate = () => {
      const map = mapRef.current?.getMap();
      if (map) {
        const center = map.getCenter();
        const zoom = map.getZoom();
        if (zoom < 5) {
          map.easeTo({
            center: [center.lng + 0.05, center.lat],
            duration: 1000,
            easing: (n) => n,
          });
        }
      }
      rotationFrame = requestAnimationFrame(rotate);
    };
    rotationFrame = requestAnimationFrame(rotate);

    return () => cancelAnimationFrame(rotationFrame);
  }, [autoRotate]);

  // Fly / fit to selected city or region
  React.useEffect(() => {
    if (selectedLocation && mapRef.current) {
      if (selectedLocation.bbox) {
        const [south, north, west, east] = selectedLocation.bbox;
        mapRef.current.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 60, duration: 1600, maxZoom: 8, pitch: 35, bearing: 0 }
        );
      } else {
        mapRef.current.flyTo({
          center: [selectedLocation.lon, selectedLocation.lat],
          zoom: 7,
          pitch: 45,
          bearing: 0,
          speed: 1.2,
          curve: 1.4,
          essential: true,
        });
      }
    }
  }, [selectedLocation]);

  // Fly to selected balloon & animate trajectory line drawing (with clean cancellation)
  React.useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (selectedId && mapRef.current) {
      const balloon = balloons.find((b) => b.id === selectedId);
      if (balloon && balloon.path.length > 0) {
        const targetPt = scrubTime
          ? (balloon.path.filter(p => p.time <= scrubTime).pop() || balloon.path[balloon.path.length - 1])
          : balloon.path[balloon.path.length - 1];

        isProgrammaticMove.current = true;
        mapRef.current.flyTo({
          center: [targetPt.lon, targetPt.lat],
          zoom: Math.max(mapRef.current.getZoom(), 5.5),
          pitch: 50,
          bearing: 15,
          speed: 1.2,
          curve: 1.3,
          essential: true,
        });
        mapRef.current.getMap().once('moveend', () => {
          window.setTimeout(() => {
            isProgrammaticMove.current = false;
          }, 80);
        });

        setPathProgress(0);
        let start: number | null = null;
        const duration = 1800;

        const animate = (timestamp: number) => {
          if (!start) start = timestamp;
          const progress = Math.min((timestamp - start) / duration, 1);
          setPathProgress(progress);
          if (progress < 1) {
            animFrameRef.current = requestAnimationFrame(animate);
          } else {
            animFrameRef.current = null;
          }
        };
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
    // Initial fly only when selection changes — continuous follow handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Continuous camera tracking while Focus/Track is on (follows scrub + live updates)
  React.useEffect(() => {
    if (!trackSelected || !selectedId || !mapRef.current) return;

    const balloon = balloons.find((b) => b.id === selectedId);
    if (!balloon?.path?.length) return;

    const targetPt = scrubTime
      ? (balloon.path.filter((p) => p.time <= scrubTime).pop() || balloon.path[balloon.path.length - 1])
      : balloon.path[balloon.path.length - 1];

    const map = mapRef.current.getMap();
    isProgrammaticMove.current = true;
    mapRef.current.easeTo({
      center: [targetPt.lon, targetPt.lat],
      duration: 450,
      essential: true,
    });
    map.once('moveend', () => {
      // Keep ignoring interaction unlocks until the camera settle finishes
      window.setTimeout(() => {
        isProgrammaticMove.current = false;
      }, 80);
    });
  }, [trackSelected, selectedId, scrubTime, balloons]);

  // User drag / rotate unlocks tracking (ignore programmatic camera moves)
  React.useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !onStopTracking) return;

    const unlock = () => {
      if (isProgrammaticMove.current) return;
      if (trackSelected) onStopTracking();
    };

    map.on('dragstart', unlock);
    map.on('rotatestart', unlock);
    map.on('pitchstart', unlock);

    return () => {
      map.off('dragstart', unlock);
      map.off('rotatestart', unlock);
      map.off('pitchstart', unlock);
    };
  }, [trackSelected, onStopTracking]);

  const onMapClick = React.useCallback(
    (event: MapLayerMouseEvent) => {
      const map = mapRef.current?.getMap();
      const { lngLat, point } = event;

      if (globeMode === 'cyclones' && onSelectCyclone) {
        const cycloneLayers = CYCLONE_HIT_LAYERS.filter((id) => !!map?.getLayer(id));
        let cycloneFeature = event.features?.find((f) =>
          CYCLONE_HIT_LAYERS.includes(f.layer?.id || '')
        );
        if (!cycloneFeature && map && cycloneLayers.length) {
          const pad = 14;
          const hits = map.queryRenderedFeatures(
            [
              [point.x - pad, point.y - pad],
              [point.x + pad, point.y + pad],
            ],
            { layers: cycloneLayers }
          );
          cycloneFeature = hits.find((f) => f.properties?.tropical_cyclone_id) as typeof cycloneFeature;
        }
        const cid = cycloneFeature?.properties?.tropical_cyclone_id;
        if (cid) {
          onSelectCyclone(String(cid));
          return;
        }
      }

      // Prefer a padded hit-test so small balloon icons are easier to click
      let balloonFeature = event.features?.find(
        (f) => f.properties?.id && BALLOON_HIT_LAYERS.includes(f.layer?.id || '')
      );

      if (!balloonFeature && map) {
        const pad = 12;
        const hits = map.queryRenderedFeatures(
          [
            [point.x - pad, point.y - pad],
            [point.x + pad, point.y + pad],
          ],
          { layers: BALLOON_HIT_LAYERS.filter((id) => !!map.getLayer(id)) }
        );
        balloonFeature = hits.find((f) => f.properties?.id) as typeof balloonFeature;
      }

      if (balloonFeature?.properties?.id) {
        // Keep regional location filter active so nearby balloons stay visible
        onSelectBalloon(String(balloonFeature.properties.id));
        return;
      }

      // Empty-map click: do NOT steal selection — only set location when Shift is held
      if (lngLat && onSelectLocation && (event.originalEvent as MouseEvent)?.shiftKey) {
        onSelectLocation({
          lat: lngLat.lat,
          lon: lngLat.lng,
          name: `Location (${lngLat.lat.toFixed(2)}°, ${lngLat.lng.toFixed(2)}°)`,
        });
        onSelectBalloon(null);
      }
    },
    [globeMode, onSelectBalloon, onSelectCyclone, onSelectLocation]
  );

  const onMouseMove = React.useCallback(
    (event: MapLayerMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const overBalloon = (event.features || []).some(
        (f) => f.properties?.id && BALLOON_HIT_LAYERS.includes(f.layer?.id || '')
      );
      const overCyclone = (event.features || []).some((f) =>
        CYCLONE_HIT_LAYERS.includes(f.layer?.id || '')
      );
      map.getCanvas().style.cursor = overBalloon || overCyclone ? 'pointer' : '';
    },
    []
  );

  const meshCoords = React.useMemo(() => {
    const parsed = parseBbox(meshBbox);
    if (!parsed) return null;
    const [west, south, east, north] = parsed;
    return [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ] as [[number, number], [number, number], [number, number], [number, number]];
  }, [meshBbox]);

  // Fly to selected cyclone position
  React.useEffect(() => {
    if (!selectedCycloneId || !cycloneGeoJson || !mapRef.current) return;
    const pos = cycloneGeoJson.features.find(
      (f) =>
        f.properties?.tropical_cyclone_id === selectedCycloneId &&
        f.properties?.feature_type === 'position' &&
        f.geometry?.type === 'Point'
    );
    if (!pos || pos.geometry.type !== 'Point') return;
    const [lon, lat] = pos.geometry.coordinates;
    isProgrammaticMove.current = true;
    mapRef.current.flyTo({
      center: [lon, lat],
      zoom: Math.max(mapRef.current.getZoom(), 4.5),
      pitch: 40,
      speed: 1.1,
      essential: true,
    });
    mapRef.current.getMap().once('moveend', () => {
      window.setTimeout(() => {
        isProgrammaticMove.current = false;
      }, 80);
    });
  }, [selectedCycloneId, cycloneGeoJson]);

  // Compute points GeoJSON filtered by scrubTime if provided
  const pointsGeoJson: FeatureCollection = React.useMemo(() => {
    const features: Feature[] = [];
    balloons.forEach((b) => {
      const validPath = scrubTime
        ? b.path.filter((p) => p.time <= scrubTime)
        : b.path;
      if (validPath.length > 0) {
        const last = validPath[validPath.length - 1];
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [last.lon, last.lat],
          },
          properties: {
            id: b.id,
            color: b.color,
            alt: last.alt,
          },
        });
      }
    });

    return { type: 'FeatureCollection', features };
  }, [balloons, scrubTime]);

  const poiGeoJson: FeatureCollection = React.useMemo(
    () => ({
      type: 'FeatureCollection',
      features: POIs.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name },
      })),
    }),
    []
  );

  const selectedLocationGeoJson: FeatureCollection | null = React.useMemo(() => {
    if (!selectedLocation) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [selectedLocation.lon, selectedLocation.lat],
          },
          properties: { name: selectedLocation.name },
        },
      ],
    };
  }, [selectedLocation]);

  // Window resize handler for MapLibre canvas
  React.useEffect(() => {
    const handleResize = () => {
      mapRef.current?.getMap()?.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="w-full h-full relative" style={{ background: '#020409' }}>
      {/* Floating Layer Controls */}
      <div className="absolute top-4 right-4 z-30">
        <LayerControls
          basemap={basemap}
          onBasemapChange={setBasemap}
          weatherLayers={weatherLayers}
          onToggleWeather={toggleWeather}
          radarAgeLabel={radarAgeLabel}
          globeMode={globeMode}
          onGlobeModeChange={onGlobeModeChange}
          showEnsemble={showEnsemble}
          onToggleEnsemble={onToggleEnsemble}
          meshVariable={meshVariable}
          onMeshVariableChange={onMeshVariableChange}
          cyclonesEnabled={cyclonesEnabled}
          griddedEnabled={griddedEnabled}
        />
      </div>

      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 15,
          latitude: 20,
          zoom: 2.2,
          pitch: 25,
          bearing: 0,
        }}
        minZoom={1.2}
        // Cap below Google / DEM tile depth so we never request unsupported z-levels
        maxZoom={18}
        mapStyle={mapStyle as any}
        projection="globe"
        interactiveLayerIds={[
          ...BALLOON_HIT_LAYERS,
          ...(globeMode === 'cyclones' ? CYCLONE_HIT_LAYERS : []),
        ]}
        onClick={onMapClick}
        onMouseMove={onMouseMove}
        style={{ width: '100%', height: '100%' }}
        onLoad={(e) => {
          requestAnimationFrame(() => setupMapAssets(e.target));
        }}
      >
        {/* WeatherMesh gridded PNG overlay */}
        {meshVariable !== 'off' && meshImageUrl && meshCoords && (
          <Source id="weathermesh-grid" type="image" url={meshImageUrl} coordinates={meshCoords}>
            <Layer
              id="weathermesh-grid-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.55, 'raster-fade-duration': 0 }}
            />
          </Source>
        )}
        {/* Day/Night Solar Terminator Layer */}
        {weatherLayers.terminator && (
          <Source id="solar-terminator" type="geojson" data={terminatorGeoJson}>
            <Layer
              id="terminator-layer"
              type="fill"
              paint={{
                'fill-color': '#020617',
                'fill-opacity': 0.45,
              }}
            />
            <Layer
              id="terminator-boundary-layer"
              type="line"
              paint={{
                'line-color': '#06b6d4',
                'line-width': 1.5,
                'line-opacity': 0.35,
              }}
            />
          </Source>
        )}

        {/*
          Weather rasters: set source maxzoom to the provider's real tile depth.
          MapLibre then overscales those tiles when the camera zooms further,
          instead of requesting missing higher zooms ("zoom level not supported").
          RainViewer radar tiles exist through z7; OpenWeather through ~z12.
        */}
        {weatherLayers.radar && radarTileUrl && (
          <Source id="rainviewer-radar" type="raster" tiles={[radarTileUrl]} tileSize={256} minzoom={0} maxzoom={7}>
            <Layer
              id="radar-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.65, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }}
            />
          </Source>
        )}

        {weatherLayers.clouds && cloudTiles && (
          <Source id="weather-clouds" type="raster" tiles={[cloudTiles]} tileSize={256} minzoom={0} maxzoom={OPENWEATHER_TILE_MAX_ZOOM}>
            <Layer
              id="weather-clouds-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.45, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }}
            />
          </Source>
        )}

        {weatherLayers.temp && tempTiles && (
          <Source id="weather-temp" type="raster" tiles={[tempTiles]} tileSize={256} minzoom={0} maxzoom={OPENWEATHER_TILE_MAX_ZOOM}>
            <Layer
              id="weather-temp-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.45, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }}
            />
          </Source>
        )}

        {weatherLayers.wind && windTiles && (
          <Source id="weather-wind" type="raster" tiles={[windTiles]} tileSize={256} minzoom={0} maxzoom={OPENWEATHER_TILE_MAX_ZOOM}>
            <Layer
              id="weather-wind-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.45, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }}
            />
          </Source>
        )}

        {/* POI Launch Site Layers */}
                <Source id="pois" type="geojson" data={poiGeoJson}>
                    <Layer
                        id="pois-layer"
                        type="symbol"
                        layout={{
                            'text-field': ['get', 'name'],
                            'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                            'text-radial-offset': 0.5,
              'text-size': 11,
                            'text-transform': 'uppercase',
                        }}
                        paint={{
              'text-color': '#38bdf8',
              'text-halo-color': '#020409',
              'text-halo-width': 2,
            }}
          />
                    <Layer
                        id="pois-circle"
                        type="circle"
                        paint={{
              'circle-radius': 5,
              'circle-color': '#38bdf8',
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
                        }}
                    />
                </Source>

        {/* Selected City Location Marker */}
        {selectedLocationGeoJson && (
          <Source id="selected-location" type="geojson" data={selectedLocationGeoJson}>
            <Layer
              id="selected-location-circle"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': '#06b6d4',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </Source>
        )}

        {/* Selected Balloon Trajectory Line */}
        {selectedId &&
          (() => {
            const balloon = balloons.find((b) => b.id === selectedId);
            if (!balloon || balloon.path.length < 2) return null;

            const targetPath = scrubTime
              ? balloon.path.filter((p) => p.time <= scrubTime)
              : balloon.path;

            const visibleCount = Math.max(2, Math.floor(targetPath.length * pathProgress));
            const partialPath = targetPath.slice(0, visibleCount);

                    const pathGeoJson: FeatureCollection = {
                        type: 'FeatureCollection',
              features: [
                {
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                    coordinates: partialPath.map((p) => [p.lon, p.lat]),
                  },
                  properties: {},
                            },
              ],
                    };

                    return (
                        <Source id="selected-path" type="geojson" data={pathGeoJson}>
                            <Layer
                                id="selected-path-glow"
                                type="line"
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                                paint={{
                    'line-color': '#06b6d4',
                                    'line-width': 4,
                    'line-opacity': 0.85,
                    'line-blur': 2,
                                }}
                            />
                            <Layer
                                id="selected-path-line"
                                type="line"
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                                paint={{
                                    'line-color': '#ffffff',
                                    'line-width': 2,
                                    'line-opacity': 1,
                                }}
                            />
                        </Source>
                    );
                })()}

        {/* Tropical cyclone layers */}
        {globeMode === 'cyclones' && cycloneGeoJson && (
          <Source id="tropical-cyclones" type="geojson" data={cycloneGeoJson}>
            <Layer
              id="cyclone-cone"
              type="fill"
              filter={['==', ['get', 'feature_type'], 'uncertainty_cone']}
              paint={{
                'fill-color': '#f59e0b',
                'fill-opacity': [
                  'case',
                  ['==', ['get', 'tropical_cyclone_id'], selectedCycloneId || ''],
                  0.28,
                  0.14,
                ],
              }}
            />
            <Layer
              id="cyclone-cone-outline"
              type="line"
              filter={['==', ['get', 'feature_type'], 'uncertainty_cone']}
              paint={{
                'line-color': '#fbbf24',
                'line-width': 1.5,
                'line-opacity': 0.7,
              }}
            />
            <Layer
              id="cyclone-mean-path"
              type="line"
              filter={['==', ['get', 'feature_type'], 'mean_path']}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'tropical_cyclone_id'], selectedCycloneId || ''],
                  '#22d3ee',
                  '#94a3b8',
                ],
                'line-width': [
                  'case',
                  ['==', ['get', 'tropical_cyclone_id'], selectedCycloneId || ''],
                  3.5,
                  2,
                ],
                'line-opacity': 0.9,
              }}
            />
            <Layer
              id="cyclone-landfall"
              type="circle"
              filter={['==', ['get', 'feature_type'], 'landfall']}
              paint={{
                'circle-radius': 4,
                'circle-color': '#f97316',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff7ed',
                'circle-opacity': showEnsemble ? 0.9 : 0,
              }}
            />
            <Layer
              id="cyclone-position-halo"
              type="circle"
              filter={['==', ['get', 'feature_type'], 'position']}
              paint={{
                'circle-radius': [
                  'case',
                  ['==', ['get', 'tropical_cyclone_id'], selectedCycloneId || ''],
                  16,
                  11,
                ],
                'circle-color': '#ef4444',
                'circle-opacity': 0.25,
              }}
            />
            <Layer
              id="cyclone-position"
              type="circle"
              filter={['==', ['get', 'feature_type'], 'position']}
              paint={{
                'circle-radius': [
                  'case',
                  ['==', ['get', 'tropical_cyclone_id'], selectedCycloneId || ''],
                  9,
                  6,
                ],
                'circle-color': '#ef4444',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
            <Layer
              id="cyclone-labels"
              type="symbol"
              filter={['==', ['get', 'feature_type'], 'position']}
              layout={{
                'text-field': ['coalesce', ['get', 'storm_name'], ['get', 'tropical_cyclone_id']],
                'text-size': 11,
                'text-offset': [0, 1.4],
                'text-anchor': 'top',
                'text-allow-overlap': false,
              }}
              paint={{
                'text-color': '#fecaca',
                'text-halo-color': '#020617',
                'text-halo-width': 1.5,
              }}
            />
          </Source>
        )}

        {/* Active Balloon Scatter Vectors */}
                <Source id="points" type="geojson" data={pointsGeoJson}>
          {/* Large invisible hit target — makes balloons easy to click */}
          <Layer
            id="balloon-hit"
            type="circle"
            paint={{
              'circle-radius': 18,
              'circle-color': '#ffffff',
              'circle-opacity': 0.01,
            }}
          />
                    <Layer
                        id="balloon-pulsing"
                        type="symbol"
                        layout={{
                            'icon-image': 'pulsing-dot',
                            'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-pitch-alignment': 'viewport',
                        }}
                    />
                    <Layer
                        id="balloon-points-halo"
                        type="circle"
                        paint={{
              'circle-radius': 14,
                            'circle-color': ['get', 'color'],
              'circle-opacity': 0.35,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': 0.7,
            }}
          />
                    <Layer
                        id="balloon-points"
                        type="symbol"
                        layout={{
                            'icon-image': 'balloon-icon',
              'icon-size': 0.75,
                            'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'bottom',
              'icon-pitch-alignment': 'viewport',
                        }}
                    />
                </Source>
            </Map>
        </div>
    );
}
