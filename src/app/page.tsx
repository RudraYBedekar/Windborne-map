'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Navbar from '@/components/Navbar';
import BalloonDetailPanel from '@/components/BalloonDetailPanel';
import CityWeatherPanel from '@/components/CityWeatherPanel';
import CycloneDetailPanel, { CycloneDetail } from '@/components/CycloneDetailPanel';
import CycloneListPanel, { CycloneListItem } from '@/components/CycloneListPanel';
import TimelineControls from '@/components/TimelineControls';
import ForecastHourControls from '@/components/ForecastHourControls';
import MapComponent from '@/components/Map';
import VickyChat from '@/components/VickyChat';
import {
  Balloon,
  fetchWindBorneData,
  checkBackendHealth,
  BackendHealthStatus,
  filterBalloonsNearLocation,
  LocationFilter,
} from '@/services/windborne';
import { fetchWeather, WeatherData } from '@/services/weather';
import {
  CYCLONE_FORECAST_HOURS,
  GRID_FORECAST_HOURS,
  MeshVariable,
  fetchCycloneDetail,
  fetchCyclonesGeoJson,
  fetchCyclonesList,
  fetchMeshStatus,
  meshPngUrl,
} from '@/services/cyclones';
import type { FeatureCollection } from 'geojson';
import { ShieldAlert } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';

/** When true, show the full Treasure constellation globally. Otherwise only location-filtered balloons. */
const SHOW_ALL_BALLOONS = process.env.NEXT_PUBLIC_SHOW_BALLOONS === 'true';
const DEFAULT_MESH_BBOX = '-130,20,-60,55';
/** Match backend WB_MIN_REQUEST_INTERVAL_SEC (5 min) for UI refresh. */
const WB_UI_REFRESH_MS = 5 * 60 * 1000;

export default function Home() {
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationFilter | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isTrackingCamera, setIsTrackingCamera] = useState(false);
  const [healthStatus, setHealthStatus] = useState<BackendHealthStatus | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherData | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [timelineReady, setTimelineReady] = useState(false);
  const [minTime, setMinTime] = useState(0);
  const [maxTime, setMaxTime] = useState(0);
  const [scrubTime, setScrubTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const [globeMode, setGlobeMode] = useState<'weather' | 'cyclones'>('weather');
  const [cycloneGeoJson, setCycloneGeoJson] = useState<FeatureCollection | null>(null);
  const [selectedCycloneId, setSelectedCycloneId] = useState<string | null>(null);
  const [selectedCyclone, setSelectedCyclone] = useState<CycloneDetail | null>(null);
  const [cyclonePoint, setCyclonePoint] = useState<Record<string, unknown> | null>(null);
  const [cycloneBasinLabels, setCycloneBasinLabels] = useState<string[]>([]);
  const [cycloneRouteSummary, setCycloneRouteSummary] = useState<
    import('@/components/CycloneDetailPanel').CycloneRouteSummary | null
  >(null);
  const [cycloneRegion, setCycloneRegion] = useState<
    import('@/components/CycloneDetailPanel').CycloneRegionInfo | null
  >(null);
  const [cycloneInitTime, setCycloneInitTime] = useState<string | null>(null);
  const [cycloneForecastHour, setCycloneForecastHour] = useState(0);
  const [showEnsemble, setShowEnsemble] = useState(false);
  const [cycloneError, setCycloneError] = useState<string | null>(null);
  const [cyclonesEnabled, setCyclonesEnabled] = useState(true);
  const [griddedEnabled, setGriddedEnabled] = useState(true);
  const [cycloneListItems, setCycloneListItems] = useState<CycloneListItem[]>([]);
  const [cycloneListLoading, setCycloneListLoading] = useState(false);

  const [meshVariable, setMeshVariable] = useState<MeshVariable>('off');
  const [meshForecastHour, setMeshForecastHour] = useState(0);
  const [meshImageUrl, setMeshImageUrl] = useState<string | null>(null);
  const [meshHint, setMeshHint] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(null);
  const [rankedLocations, setRankedLocations] = useState<
    Array<{
      rank?: number;
      name?: string;
      latitude: number;
      longitude: number;
      value?: number;
      units?: string;
    }>
  >([]);

  useEffect(() => {
    const now = Date.now();
    const min = now - 24 * 3600 * 1000;
    setMinTime(min);
    setMaxTime(now);
    setScrubTime(now);
    setTimelineReady(true);

    const liveTick = setInterval(() => {
      const t = Date.now();
      setMaxTime(t);
      setMinTime(t - 24 * 3600 * 1000);
      setScrubTime((prev) => (t - prev < 60_000 ? t : prev));
    }, 30_000);

    return () => clearInterval(liveTick);
  }, []);

  const selectedBalloon = useMemo(() => {
    return balloons.find((b) => b.id === selectedId) || null;
  }, [balloons, selectedId]);

  /** Region filter for searched places; full fleet only if SHOW_ALL_BALLOONS. */
  const visibleBalloons = useMemo(() => {
    if (selectedLocation) {
      return filterBalloonsNearLocation(balloons, selectedLocation, 250);
    }
    if (SHOW_ALL_BALLOONS) return balloons;
    return [];
  }, [balloons, selectedLocation]);

  const balloonsVisible = visibleBalloons.length > 0 || Boolean(selectedLocation);

  const prevHealthRef = useRef<BackendHealthStatus | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const health = await checkBackendHealth();
      const prevHealth = prevHealthRef.current;
      prevHealthRef.current = health;
      setHealthStatus(health);

      if (health.directMode) {
        toast.error('FastAPI Backend Offline', { id: 'backend-health', duration: 5000 });
      } else if (prevHealth && prevHealth.directMode) {
        toast.success('FastAPI Backend Connected', { id: 'backend-health', duration: 3000 });
      }

      // Always load Treasure so location search can filter nearby balloons
      const data = await fetchWindBorneData();
      if (data.length === 0) {
        setError('No telemetry data returned.');
        setBalloons([]);
      } else {
        setBalloons(data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load backend status.');
      toast.error('Failed to load backend status.', { id: 'data-status' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    fetchMeshStatus().then((status) => {
      if (cancelled || !status) return;
      setCyclonesEnabled(status.cyclones?.enabled !== false);
      setGriddedEnabled(status.gridded?.enabled !== false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedLocation) return;
    const nearby = filterBalloonsNearLocation(balloons, selectedLocation, 250);
    const shortName = selectedLocation.name.split(',')[0] || selectedLocation.name;
    if (nearby.length === 0) {
      toast(`No Treasure balloons near ${shortName}`, { id: 'region-balloons', duration: 3500 });
    } else {
      toast.success(`${nearby.length} balloon${nearby.length === 1 ? '' : 's'} near ${shortName} — click for status`, {
        id: 'region-balloons',
        duration: 4000,
      });
    }
  }, [selectedLocation?.name, selectedLocation?.lat, selectedLocation?.lon, balloons.length]);

  useEffect(() => {
    const lat = selectedBalloon?.latestPoint?.lat ?? selectedLocation?.lat ?? 36.85;
    const lon = selectedBalloon?.latestPoint?.lon ?? selectedLocation?.lon ?? -76.28;

    let cancelled = false;
    fetchWeather(lat, lon).then((data) => {
      if (!cancelled) setCurrentWeather(data);
    }).catch(() => {
      if (!cancelled) setCurrentWeather(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    selectedLocation?.lat,
    selectedLocation?.lon,
    selectedBalloon?.latestPoint?.lat,
    selectedBalloon?.latestPoint?.lon,
  ]);

  // Cyclone GeoJSON + clickable list — refresh on mode / hour / ensemble; poll every 5 min
  useEffect(() => {
    if (globeMode !== 'cyclones') return;
    let cancelled = false;

    const load = async () => {
      setCycloneListLoading(true);
      const [geo, list] = await Promise.all([
        fetchCyclonesGeoJson({
          forecastHour: cycloneForecastHour,
          includeEnsemble: showEnsemble,
        }),
        fetchCyclonesList(),
      ]);
      if (cancelled) return;

      if (geo.error) {
        setCycloneError(geo.error);
        setCycloneGeoJson(null);
        toast.error(geo.error.slice(0, 120), { id: 'cyclone-load' });
      } else {
        setCycloneError(null);
        setCycloneGeoJson(geo.geojson);
        const init = (geo.geojson as FeatureCollection & { properties?: { initialization_time?: string } })
          ?.properties?.initialization_time;
        if (init) setCycloneInitTime(init);
      }

      if (list.ok) {
        const items: CycloneListItem[] = Object.entries(list.storms).map(([id, storm]) => {
          const path = (storm.path || []) as Array<Record<string, unknown>>;
          const exact = path.find((p) => p.forecast_hour === cycloneForecastHour);
          const pt =
            exact ||
            path.slice().sort((a, b) => {
              const ah = typeof a.forecast_hour === 'number' ? a.forecast_hour : 9999;
              const bh = typeof b.forecast_hour === 'number' ? b.forecast_hour : 9999;
              return Math.abs(ah - cycloneForecastHour) - Math.abs(bh - cycloneForecastHour);
            })[0];
          const gen = storm.genesis;
          return {
            id: storm.tropical_cyclone_id || id,
            storm,
            latitude:
              (typeof pt?.latitude === 'number' ? pt.latitude : null) ??
              (typeof gen?.latitude === 'number' ? gen.latitude : null),
            longitude:
              (typeof pt?.longitude === 'number' ? pt.longitude : null) ??
              (typeof gen?.longitude === 'number' ? gen.longitude : null),
            forecastHour: typeof pt?.forecast_hour === 'number' ? pt.forecast_hour : null,
          };
        });
        setCycloneListItems(items);
        if (list.initialization_time) setCycloneInitTime(list.initialization_time);
      } else if (!geo.error) {
        setCycloneError(list.message || list.error || 'Cyclone list unavailable');
        setCycloneListItems([]);
      }
      setCycloneListLoading(false);
    };

    load();
    const interval = setInterval(load, WB_UI_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [globeMode, cycloneForecastHour, showEnsemble]);

  // Selected cyclone detail
  useEffect(() => {
    if (!selectedCycloneId || globeMode !== 'cyclones') {
      setSelectedCyclone(null);
      setCyclonePoint(null);
      setCycloneBasinLabels([]);
      setCycloneRouteSummary(null);
      setCycloneRegion(null);
      return;
    }
    let cancelled = false;
    fetchCycloneDetail(selectedCycloneId, cycloneForecastHour).then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.cyclone) {
        toast.error(res.message || res.error || 'Cyclone unavailable', { id: 'cyclone-detail' });
        return;
      }
      setSelectedCyclone(res.cyclone);
      setCyclonePoint(res.point || null);
      setCycloneBasinLabels(res.basin_labels || []);
      setCycloneRouteSummary(res.route_summary || null);
      setCycloneRegion(res.region || null);
      if (res.initialization_time) setCycloneInitTime(res.initialization_time);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCycloneId, cycloneForecastHour, globeMode]);

  // WeatherMesh PNG overlay — cache-bust only every 5 min so we don't hammer the gate
  useEffect(() => {
    if (meshVariable === 'off') {
      setMeshImageUrl(null);
      setMeshHint(null);
      return;
    }
    if (!griddedEnabled) {
      setMeshImageUrl(null);
      setMeshHint('Gridded forecasts disabled');
      return;
    }

    const tick = () => {
      const base = meshPngUrl(meshVariable, meshForecastHour, DEFAULT_MESH_BBOX);
      setMeshImageUrl(`${base}&t=${Math.floor(Date.now() / WB_UI_REFRESH_MS)}`);
      setMeshHint(`CONUS · +${meshForecastHour}h · refresh ≤5 min`);
    };
    tick();
    const interval = setInterval(tick, WB_UI_REFRESH_MS);
    return () => clearInterval(interval);
  }, [meshVariable, meshForecastHour, griddedEnabled]);

  // Playback
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setScrubTime((prev) => {
        const next = prev + 60_000 * playbackSpeed;
        if (next >= maxTime) {
          setIsPlaying(false);
          return maxTime;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, maxTime]);

  const selectBalloon = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      setSelectedCycloneId(null);
      setAutoRotate(false);
      setIsTrackingCamera(true);
    } else {
      setIsTrackingCamera(false);
    }
  };

  const selectCyclone = (id: string | null) => {
    setSelectedCycloneId(id);
    if (id) {
      setSelectedId(null);
      setIsTrackingCamera(false);
      setAutoRotate(false);
      setGlobeMode('cyclones');
    }
  };

  const showBalloonTimeline = balloonsVisible && timelineReady && globeMode === 'weather';
  const showCycloneHours = globeMode === 'cyclones';
  const showMeshHours = meshVariable !== 'off' && globeMode === 'weather';

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-cyan-500/30 font-sans">
      <Navbar
        balloons={visibleBalloons}
        selectedId={selectedId}
        onSelectBalloon={(id) => selectBalloon(id)}
        onSelectLocation={(lat, lon, name, bbox) => {
          setSelectedLocation({ lat, lon, name, bbox });
          setSelectedId(null);
          setSelectedCycloneId(null);
          setAutoRotate(false);
          setIsTrackingCamera(false);
        }}
        lastUpdated={lastUpdated}
        loading={loading}
        onRefresh={loadData}
        healthStatus={healthStatus}
        onResetCamera={() => {
          setSelectedId(null);
          setSelectedLocation(null);
          setSelectedCycloneId(null);
          setAutoRotate(false);
          setIsTrackingCamera(false);
        }}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        isChatOpen={isChatOpen}
      />

      <div className="flex-1 relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        {globeMode === 'cyclones' && (
          <CycloneListPanel
            items={cycloneListItems}
            selectedId={selectedCycloneId}
            loading={cycloneListLoading}
            error={cycloneError}
            initTime={cycloneInitTime}
            onSelect={selectCyclone}
          />
        )}

        {selectedLocation && !selectedBalloon && !selectedCyclone && (
          <CityWeatherPanel
            cityName={selectedLocation.name}
            lat={selectedLocation.lat}
            lon={selectedLocation.lon}
            onClose={() => {
              setSelectedLocation(null);
              setSelectedId(null);
            }}
          />
        )}

        {selectedBalloon && (
          <BalloonDetailPanel
            balloon={selectedBalloon}
            onClose={() => {
              setSelectedId(null);
              setIsTrackingCamera(false);
            }}
            isTrackingCamera={isTrackingCamera}
            onFocusCamera={() => {
              setAutoRotate(false);
              setIsTrackingCamera((prev) => !prev);
            }}
          />
        )}

        {selectedCyclone && globeMode === 'cyclones' && (
          <CycloneDetailPanel
            cyclone={selectedCyclone}
            forecastHour={cycloneForecastHour}
            point={cyclonePoint}
            initializationTime={cycloneInitTime}
            basinLabels={cycloneBasinLabels}
            routeSummary={cycloneRouteSummary}
            region={cycloneRegion}
            onClose={() => setSelectedCycloneId(null)}
            className="!left-[316px] md:!left-[316px] max-md:!left-3 max-md:!top-[auto] max-md:!bottom-28"
          />
        )}

        <VickyChat
          balloons={visibleBalloons}
          selectedBalloon={selectedBalloon}
          weather={currentWeather}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen((prev) => !prev)}
          mapBounds={mapBounds}
          selectedLocation={selectedLocation}
          selectedCycloneId={selectedCycloneId}
          onAction={(action) => {
            if (!action || typeof action !== 'object') return;
            if (action.type === 'FLY_TO_LOCATION' && action.latitude != null && action.longitude != null) {
              const lat = Number(action.latitude);
              const lon = Number(action.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
              if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
              setSelectedLocation({
                lat,
                lon,
                name:
                  action.name ||
                  `Location (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
              });
              setSelectedId(null);
              setIsTrackingCamera(false);
              setAutoRotate(false);
            }
            if (action.type === 'SELECT_BALLOON' && action.balloonId) {
              selectBalloon(String(action.balloonId));
            }
            if (action.type === 'SET_GLOBE_MODE' && action.mode === 'cyclones') {
              setGlobeMode('cyclones');
            }
            if (
              (action.type === 'SELECT_CYCLONE' || action.type === 'FLY_TO_CYCLONE') &&
              action.cycloneId
            ) {
              selectCyclone(String(action.cycloneId));
            }
            if (action.type === 'SET_CYCLONE_FORECAST_HOUR') {
              const h = Number(action.forecastHour ?? action.hour);
              if (Number.isFinite(h)) {
                setGlobeMode('cyclones');
                setCycloneForecastHour(h);
              }
            }
            if (action.type === 'SHOW_RANKED_LOCATIONS' && Array.isArray(action.locations)) {
              const cleaned = action.locations
                .map((loc: any) => ({
                  rank: loc.rank,
                  name: loc.name,
                  latitude: Number(loc.latitude),
                  longitude: Number(loc.longitude),
                  value: loc.value,
                  units: loc.units,
                }))
                .filter(
                  (loc: { latitude: number; longitude: number }) =>
                    Number.isFinite(loc.latitude) &&
                    Number.isFinite(loc.longitude) &&
                    loc.latitude >= -90 &&
                    loc.latitude <= 90
                );
              setRankedLocations(cleaned);
            }
          }}
        />

        {healthStatus?.directMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-amber-950/90 border border-amber-700/80 text-amber-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 backdrop-blur-md">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>FastAPI Backend Offline</span>
          </div>
        )}

        {globeMode === 'cyclones' && cycloneError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-rose-950/90 border border-rose-700/80 text-rose-100 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono backdrop-blur-md max-w-[90vw] truncate">
            Cyclones unavailable: {cycloneError}
          </div>
        )}

        {globeMode === 'cyclones' && !cycloneError && cycloneGeoJson && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-slate-950/90 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono backdrop-blur-md max-w-[90vw] truncate">
            {cycloneGeoJson.features.filter((f) => f.properties?.feature_type === 'position').length}{' '}
            storm(s) · click marker · forecast +{cycloneForecastHour}h · WB ≤5 min
          </div>
        )}

        {selectedLocation && globeMode === 'weather' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-slate-950/90 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono backdrop-blur-md max-w-[90vw] truncate">
            {visibleBalloons.length} balloon{visibleBalloons.length === 1 ? '' : 's'} near{' '}
            {selectedLocation.name.split(',')[0]} · click a marker for live status · Treasure feed
          </div>
        )}

        {isTrackingCamera && selectedBalloon && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-cyan-950/90 border border-cyan-700/80 text-cyan-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>Tracking {selectedBalloon.id} — drag map to unlock</span>
          </div>
        )}

        {showBalloonTimeline && (
          <TimelineControls
            minTime={minTime}
            maxTime={maxTime}
            currentTime={scrubTime}
            onChangeTime={(time) => {
              setScrubTime(time);
              setIsPlaying(false);
            }}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            playbackSpeed={playbackSpeed}
            onChangeSpeed={setPlaybackSpeed}
            onJumpToLive={() => {
              setScrubTime(maxTime);
              setIsPlaying(false);
            }}
          />
        )}

        {showCycloneHours && (
          <ForecastHourControls
            label="CYCLONE FORECAST"
            hours={CYCLONE_FORECAST_HOURS}
            value={cycloneForecastHour}
            onChange={setCycloneForecastHour}
            hint={cycloneInitTime ? `Init ${cycloneInitTime}` : 'WeatherMesh tropical cyclones'}
          />
        )}

        {showMeshHours && !showCycloneHours && (
          <ForecastHourControls
            label="MESH FORECAST"
            hours={GRID_FORECAST_HOURS}
            value={meshForecastHour}
            onChange={setMeshForecastHour}
            hint={meshHint}
          />
        )}

        <div className="flex-1 h-full w-full relative">
          <MapComponent
            balloons={visibleBalloons}
            selectedId={selectedId}
            onSelectBalloon={selectBalloon}
            selectedLocation={selectedLocation}
            onSelectLocation={(loc) => {
              if (!loc) {
                setSelectedLocation(null);
                setSelectedId(null);
                return;
              }
              setSelectedLocation(loc);
              setSelectedId(null);
              setSelectedCycloneId(null);
              setIsTrackingCamera(false);
            }}
            autoRotate={autoRotate}
            trackSelected={isTrackingCamera}
            onStopTracking={() => setIsTrackingCamera(false)}
            scrubTime={
              balloonsVisible && timelineReady && scrubTime < maxTime - 60000
                ? scrubTime
                : undefined
            }
            globeMode={globeMode}
            onGlobeModeChange={(mode) => {
              setGlobeMode(mode);
              if (mode === 'weather') setSelectedCycloneId(null);
            }}
            cycloneGeoJson={cycloneGeoJson}
            selectedCycloneId={selectedCycloneId}
            onSelectCyclone={selectCyclone}
            showEnsemble={showEnsemble}
            onToggleEnsemble={() => setShowEnsemble((v) => !v)}
            meshVariable={meshVariable}
            onMeshVariableChange={setMeshVariable}
            meshImageUrl={meshImageUrl}
            meshBbox={DEFAULT_MESH_BBOX}
            cyclonesEnabled={cyclonesEnabled}
            griddedEnabled={griddedEnabled}
            rankedLocations={rankedLocations}
            onMapBoundsChange={setMapBounds}
          />
        </div>
      </div>
      <Toaster
        position="bottom-left"
        toastOptions={{
          style: {
            background: '#020617',
            color: '#f8fafc',
            border: '1px solid #1e293b',
            fontFamily: 'monospace',
            fontSize: '12px',
          },
          success: {
            iconTheme: {
              primary: '#06b6d4',
              secondary: '#020617',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#020617',
            },
          },
        }}
      />
    </main>
  );
}
