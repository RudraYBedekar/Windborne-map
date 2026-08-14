'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Navbar from '@/components/Navbar';
import BalloonDetailPanel from '@/components/BalloonDetailPanel';
import CityWeatherPanel from '@/components/CityWeatherPanel';
import TimelineControls from '@/components/TimelineControls';
import MapComponent from '@/components/Map';
import WeatherEffects from '@/components/WeatherEffects';
import VickyChat from '@/components/VickyChat';
import { Balloon, fetchWindBorneData, checkBackendHealth, BackendHealthStatus } from '@/services/windborne';
import { fetchWeather, WeatherData } from '@/services/weather';
import { ShieldAlert } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';

/** Treasure public feed is not operationally accurate — hide balloon markers/list. */
const SHOW_BALLOONS = process.env.NEXT_PUBLIC_SHOW_BALLOONS === 'true';

export default function Home() {
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isTrackingCamera, setIsTrackingCamera] = useState(false);
  const [healthStatus, setHealthStatus] = useState<BackendHealthStatus | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherData | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);


  // Timeline scrubbing — Date.now() must NOT run during render (SSR hydration mismatch).
  // Initialize after mount, then keep the live edge fresh on an interval.
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
      // Stay pinned to live edge when user is within ~1 minute of "now"
      setScrubTime((prev) => (t - prev < 60_000 ? t : prev));
    }, 30_000);

    return () => clearInterval(liveTick);
  }, []);

  // Selected balloon entity
  const selectedBalloon = useMemo(() => {
    return balloons.find(b => b.id === selectedId) || null;
  }, [balloons, selectedId]);

  const prevHealthRef = useRef<BackendHealthStatus | null>(null);

  // Load health (+ optional balloons only if explicitly enabled)
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

      if (SHOW_BALLOONS) {
        const data = await fetchWindBorneData();
        if (data.length === 0) {
          setError('No telemetry data returned.');
        } else {
          setBalloons(data);
          setLastUpdated(new Date());
        }
      } else {
        setBalloons([]);
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
    const interval = setInterval(loadData, 60000); // 60s polling
    return () => clearInterval(interval);
  }, [loadData]);

  // Fetch weather for active balloon or city location to drive real particles in WeatherEffects
  useEffect(() => {
    const lat = selectedLocation?.lat ?? selectedBalloon?.latestPoint?.lat ?? 36.85;
    const lon = selectedLocation?.lon ?? selectedBalloon?.latestPoint?.lon ?? -76.28;

    let cancelled = false;
    fetchWeather(lat, lon).then(data => {
      if (!cancelled) setCurrentWeather(data);
    }).catch(() => {
      if (!cancelled) setCurrentWeather(null);
    });

    return () => { cancelled = true; };
  }, [selectedLocation?.lat, selectedLocation?.lon, selectedBalloon?.latestPoint?.lat, selectedBalloon?.latestPoint?.lon]);

  // Playback timer tick
  useEffect(() => {
    if (!isPlaying) return;

    const tickMs = 100;
    const incrementMs = tickMs * 30 * playbackSpeed * 60; // speed multiplier

    const timer = setInterval(() => {
      setScrubTime(prev => {
        const next = prev + incrementMs;
        if (next >= maxTime) {
          setIsPlaying(false);
          return maxTime;
        }
        return next;
      });
    }, tickMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, maxTime]);

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-cyan-500/30 font-sans">
      {/* Top Professional Ops Navbar */}
      <Navbar
        balloons={SHOW_BALLOONS ? balloons : []}
        selectedId={SHOW_BALLOONS ? selectedId : null}
        onSelectBalloon={(id) => {
          if (!SHOW_BALLOONS) return;
          setSelectedId(id);
          setSelectedLocation(null);
          setAutoRotate(false);
          setIsTrackingCamera(true);
        }}
        onSelectLocation={(lat, lon, name) => {
          setSelectedLocation({ lat, lon, name });
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

      {/* Main Content Area */}
      <div className="flex-1 relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        <WeatherEffects weather={currentWeather} />

        {selectedLocation && (
          <CityWeatherPanel
            cityName={selectedLocation.name}
            lat={selectedLocation.lat}
            lon={selectedLocation.lon}
            onClose={() => setSelectedLocation(null)}
          />
        )}

        {SHOW_BALLOONS && selectedBalloon && !selectedLocation && (
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
          balloons={SHOW_BALLOONS ? balloons : []}
          selectedBalloon={SHOW_BALLOONS ? selectedBalloon : null}
          weather={currentWeather}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen((prev) => !prev)}
          onAction={(action) => {
            if (!action || typeof action !== 'object') return;
            if (action.type === 'FLY_TO_LOCATION' && action.latitude != null && action.longitude != null) {
              setSelectedLocation({
                lat: Number(action.latitude),
                lon: Number(action.longitude),
                name: action.name || `Location (${Number(action.latitude).toFixed(2)}°, ${Number(action.longitude).toFixed(2)}°)`,
              });
              setSelectedId(null);
              setIsTrackingCamera(false);
              setAutoRotate(false);
            }
            if (SHOW_BALLOONS && action.type === 'SELECT_BALLOON' && action.balloonId) {
              setSelectedId(String(action.balloonId));
              setSelectedLocation(null);
              setIsTrackingCamera(true);
            }
          }}
        />

        {healthStatus?.directMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-amber-950/90 border border-amber-700/80 text-amber-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 backdrop-blur-md">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>FastAPI Backend Offline</span>
          </div>
        )}

        {SHOW_BALLOONS && isTrackingCamera && selectedBalloon && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-cyan-950/90 border border-cyan-700/80 text-cyan-200 px-3.5 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>Tracking {selectedBalloon.id} — drag map to unlock</span>
          </div>
        )}

        {SHOW_BALLOONS && timelineReady && (
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
            balloons={SHOW_BALLOONS ? balloons : []}
            selectedId={SHOW_BALLOONS ? selectedId : null}
            onSelectBalloon={(id) => {
              if (!SHOW_BALLOONS) return;
              setSelectedId(id);
              setSelectedLocation(null);
              if (id) {
                setAutoRotate(false);
                setIsTrackingCamera(true);
              } else {
                setIsTrackingCamera(false);
              }
            }}
            selectedLocation={selectedLocation}
            onSelectLocation={(loc) => {
              setSelectedLocation(loc);
              setSelectedId(null);
              setIsTrackingCamera(false);
            }}
            autoRotate={autoRotate}
            trackSelected={SHOW_BALLOONS && isTrackingCamera}
            onStopTracking={() => setIsTrackingCamera(false)}
            scrubTime={
              SHOW_BALLOONS && timelineReady && scrubTime < maxTime - 60000
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
