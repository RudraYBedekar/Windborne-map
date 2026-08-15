'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Navbar from '@/components/Navbar';
import BalloonDetailPanel from '@/components/BalloonDetailPanel';
import CityWeatherPanel from '@/components/CityWeatherPanel';
import TimelineControls from '@/components/TimelineControls';
import MapComponent from '@/components/Map';
import WeatherEffects from '@/components/WeatherEffects';
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
import { ShieldAlert } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';

/** When true, show the full Treasure constellation globally. Otherwise only location-filtered balloons. */
const SHOW_ALL_BALLOONS = process.env.NEXT_PUBLIC_SHOW_BALLOONS === 'true';

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
      setAutoRotate(false);
      setIsTrackingCamera(true);
    } else {
      setIsTrackingCamera(false);
    }
  };

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-cyan-500/30 font-sans">
      <Navbar
        balloons={visibleBalloons}
        selectedId={selectedId}
        onSelectBalloon={(id) => selectBalloon(id)}
        onSelectLocation={(lat, lon, name, bbox) => {
          setSelectedLocation({ lat, lon, name, bbox });
          setSelectedId(null);
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
          setAutoRotate(false);
          setIsTrackingCamera(false);
        }}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        isChatOpen={isChatOpen}
      />

      <div className="flex-1 relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        <WeatherEffects weather={currentWeather} />

        {selectedLocation && !selectedBalloon && (
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

        <VickyChat
          balloons={visibleBalloons}
          selectedBalloon={selectedBalloon}
          weather={currentWeather}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen((prev) => !prev)}
          onAction={(action) => {
            if (!action || typeof action !== 'object') return;
            if (action.type === 'FLY_TO_LOCATION' && action.latitude != null && action.longitude != null) {
              setSelectedLocation({
                lat: Number(action.latitude),
                lon: Number(action.longitude),
                name:
                  action.name ||
                  `Location (${Number(action.latitude).toFixed(2)}°, ${Number(action.longitude).toFixed(2)}°)`,
              });
              setSelectedId(null);
              setIsTrackingCamera(false);
              setAutoRotate(false);
            }
            if (action.type === 'SELECT_BALLOON' && action.balloonId) {
              selectBalloon(String(action.balloonId));
            }
          }}
        />

        {healthStatus?.directMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-amber-950/90 border border-amber-700/80 text-amber-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 backdrop-blur-md">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>FastAPI Backend Offline</span>
          </div>
        )}

        {selectedLocation && (
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

        {balloonsVisible && timelineReady && (
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
