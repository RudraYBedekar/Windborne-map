'use client';

import * as React from 'react';
import Map, { Source, Layer, Popup, MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Balloon } from '@/services/windborne';
import { fetchWeather, WeatherData } from '@/services/weather';
import { Loader2, MapPin, Search } from 'lucide-react';
import { formatTime, cn } from '@/lib/utils';
import type { FeatureCollection, Feature } from 'geojson';

interface SearchResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
}

interface MapComponentProps {
    balloons: Balloon[];
    selectedId: string | null;
    onSelectBalloon: (id: string | null) => void;
    autoRotate?: boolean;
}

// Demo POIs
const POIs = [
    {
        id: 'poi-norfolk',
        name: 'Norfolk, VA',
        lat: 36.8508,
        lon: -76.2859,
        desc: 'Strategic launch site for high-altitude operations.',
        image: 'https://images.unsplash.com/photo-1589408229046-e58f0011409f?q=80&w=600&auto=format&fit=crop' // Placeholder: generic naval/city
    }
];

export default function MapComponent({ balloons, selectedId, onSelectBalloon, autoRotate = false }: MapComponentProps) {
    const mapRef = React.useRef<MapRef>(null);

    const [hoverInfo, setHoverInfo] = React.useState<{
        longitude: number;
        latitude: number;
        balloonId: string;
        pointIndex: number;
    } | null>(null);

    const [poiHover, setPoiHover] = React.useState<typeof POIs[0] | null>(null);

    const [weather, setWeather] = React.useState<WeatherData | null>(null);
    const [loadingWeather, setLoadingWeather] = React.useState(false);
    const [pathProgress, setPathProgress] = React.useState(1); // 0 to 1

    // Search State
    const [searchQuery, setSearchQuery] = React.useState('');
    const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const [showResults, setShowResults] = React.useState(false);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setShowResults(true);
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
            const data = await response.json();
            setSearchResults(data);
        } catch (error) {
            console.error("Search failed:", error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    const flyToLocation = (result: SearchResult) => {
        if (mapRef.current) {
            mapRef.current.flyTo({
                center: [parseFloat(result.lon), parseFloat(result.lat)],
                zoom: 10,
                essential: true
            });
            // Optional: Set a temporary marker or popup? For now just fly there.
            setHoverInfo(null);
            onSelectBalloon(null);
            setShowResults(false);
            setSearchQuery(result.display_name);
        }
    };

    // Auto-rotation effect
    React.useEffect(() => {
        if (!autoRotate || !mapRef.current) return;

        let animationFrame: number;
        const rotate = () => {
            const map = mapRef.current?.getMap();
            if (map) {
                const center = map.getCenter();
                const zoom = map.getZoom();
                if (zoom < 5) { // Only rotate at world view
                    map.easeTo({
                        center: [center.lng + 0.1, center.lat],
                        duration: 1000,
                        easing: (n) => n
                    });
                }
            }
            animationFrame = requestAnimationFrame(rotate);
        };
        animationFrame = requestAnimationFrame(rotate);

        return () => cancelAnimationFrame(animationFrame);
    }, [autoRotate]);


    // Effect to fly to selected balloon
    // Effect to fly to selected balloon and animate path
    React.useEffect(() => {
        if (selectedId && mapRef.current) {
            const balloon = balloons.find(b => b.id === selectedId);
            if (balloon && balloon.path.length > 0) {
                const lastPoint = balloon.path[balloon.path.length - 1];
                mapRef.current.flyTo({
                    center: [lastPoint.lon, lastPoint.lat],
                    zoom: 4,
                    speed: 1.5,
                    curve: 1
                });
                setHoverInfo({
                    longitude: lastPoint.lon,
                    latitude: lastPoint.lat,
                    balloonId: selectedId,
                    pointIndex: balloon.path.length - 1
                });
                setPoiHover(null);

                // Trigger path drawing animation
                setPathProgress(0);
                let start: number;
                const animate = (timestamp: number) => {
                    if (!start) start = timestamp;
                    const duration = 2500; // 2.5s for full path
                    const progress = Math.min((timestamp - start) / duration, 1);
                    setPathProgress(progress);
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    }
                };
                requestAnimationFrame(animate);
            }
        }
    }, [selectedId, balloons]);

    const onHover = React.useCallback(async (event: MapLayerMouseEvent) => {
        const { features, lngLat } = event;
        const hoveredFeature = features && features[0];

        // Check POI Hover/Click first
        if (hoveredFeature && hoveredFeature.source === 'pois') {
            const id = hoveredFeature.properties?.id;
            const poi = POIs.find(p => p.id === id);
            if (poi) {
                setPoiHover(poi);
                setHoverInfo(null);
                return;
            }
        }

        if (hoveredFeature && (hoveredFeature.source === 'points' || hoveredFeature.source === 'balloons')) {
            const balloonId = hoveredFeature.properties?.id;
            if (!balloonId) return;

            onSelectBalloon(balloonId);

            const balloon = balloons.find(b => b.id === balloonId);
            if (!balloon) return;

            setPoiHover(null);

            // Find closest point
            let minDist = Infinity;
            let closestIndex = -1;
            let closestPoint = null;

            balloon.path.forEach((p, idx) => {
                const dist = Math.sqrt(Math.pow(p.lat - lngLat.lat, 2) + Math.pow(p.lon - lngLat.lng, 2));
                if (dist < minDist) {
                    minDist = dist;
                    closestPoint = p;
                    closestIndex = idx;
                }
            });

            if (closestPoint) {
                setHoverInfo({
                    longitude: (closestPoint as any).lon,
                    latitude: (closestPoint as any).lat,
                    balloonId,
                    pointIndex: closestIndex
                });
            }

        } else {
            // onSelectBalloon(null);
            // setHoverInfo(null);
            // Dont clear strictly on map click to allow exploring
        }
    }, [balloons, onSelectBalloon]);

    // Fetch weather
    React.useEffect(() => {
        if (hoverInfo) {
            setLoadingWeather(true);
            fetchWeather(hoverInfo.latitude, hoverInfo.longitude)
                .then(setWeather)
                .catch(() => setWeather(null))
                .finally(() => setLoadingWeather(false));
        } else {
            setWeather(null);
        }
    }, [hoverInfo]);

    const poiGeoJson: FeatureCollection = React.useMemo(() => {
        return {
            type: 'FeatureCollection',
            features: POIs.map(p => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: { id: p.id, name: p.name }
            }))
        };
    }, []);

    const pointsGeoJson: FeatureCollection = React.useMemo(() => {
        // ... reuse previous logic ...
        return {
            type: 'FeatureCollection',
            features: balloons.map((b) => {
                const last = b.path[b.path.length - 1];
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [last.lon, last.lat],
                    },
                    properties: {
                        id: b.id,
                        color: b.color,
                        alt: last.alt
                    },
                };
            }) as Feature[],
        };
    }, [balloons]);

    return (
        <div className="w-full h-full relative group" style={{ background: '#020409' }}>
            {/* Search Bar Overlay */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-4 pointer-events-none">
                <div className="pointer-events-auto relative shadow-2xl">
                    <form onSubmit={handleSearch} className="relative group/search">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-500 group-focus-within/search:text-blue-600 transition-colors" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-12 pr-4 py-3 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-full text-base text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all shadow-lg"
                            placeholder="Search cities, countries..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
                        />
                        {isSearching && (
                            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                            </div>
                        )}
                    </form>

                    {/* Search Results Dropdown */}
                    {showResults && searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                            {searchResults.map((result) => (
                                <button
                                    key={result.place_id}
                                    onClick={() => flyToLocation(result)}
                                    className="w-full text-left px-4 py-3 hover:bg-blue-50 text-sm text-gray-700 hover:text-blue-700 border-b border-gray-100 last:border-0 transition-colors flex items-start gap-2"
                                >
                                    <MapPin className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />
                                    <span className="line-clamp-2">{result.display_name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <Map
                ref={mapRef}
                initialViewState={{
                    longitude: -76,
                    latitude: 36,
                    zoom: 3,
                    pitch: 45 // Start with some 3D pitch
                }}
                style={{ width: '100%', height: '100%' }}
                mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
                interactiveLayerIds={['balloon-points', 'pois-layer']}
                onClick={onHover}
                maxZoom={14}
                minZoom={1}
                projection="globe"
                terrain={{ source: 'terrain', exaggeration: 1.5 }} // Enable terrain
                onLoad={(e) => {
                    const map = e.target;

                    // 1. Load the static Balloon SVG
                    if (!map.hasImage('balloon-icon')) {
                        const img = new Image();
                        img.src = '/balloon.svg';
                        img.onload = () => {
                            if (!map.hasImage('balloon-icon')) map.addImage('balloon-icon', img);
                        };
                        img.onerror = (err) => console.error('Failed to load balloon icon', err);
                    }

                    // 2. Implement Pulsing Dot (Canvas Source)
                    const size = 150;
                    const pulsingDot = {
                        width: size,
                        height: size,
                        data: new Uint8ClampedArray(size * size * 4),
                        context: null as CanvasRenderingContext2D | null,
                        onAdd: function () {
                            const canvas = document.createElement('canvas');
                            canvas.width = this.width;
                            canvas.height = this.height;
                            this.context = canvas.getContext('2d');
                        },
                        render: function () {
                            const duration = 1500;
                            const t = (performance.now() % duration) / duration;
                            const context = this.context;
                            if (!context) return false;

                            const radius = (size / 2) * 0.3;
                            const outerRadius = (size / 2) * 0.7 * t + radius;
                            const alpha = 1 - t;

                            context.clearRect(0, 0, this.width, this.height);

                            // Draw pulsating halo
                            context.beginPath();
                            context.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
                            context.fillStyle = 'rgba(0, 255, 255,' + alpha + ')'; // Cyan glow
                            context.fill();

                            // Draw static core
                            context.beginPath();
                            context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
                            context.fillStyle = 'rgba(0, 255, 255, 0.8)';
                            context.strokeStyle = 'white';
                            context.lineWidth = 2;
                            context.fill();
                            context.stroke();

                            this.data = context.getImageData(0, 0, this.width, this.height).data;
                            map.triggerRepaint();
                            return true;
                        }
                    };

                    if (!map.hasImage('pulsing-dot')) {
                        map.addImage('pulsing-dot', pulsingDot, { pixelRatio: 2 });
                    }
                }}
            >
                {/* 3D Terrain Source */}
                {/* Note: Carto doesn't provide free RGB terrain tiles easily.
            We can use MapTiler or similar, but without a key it's hard.
            However, we can use a "hillshade" layer for visuals or just rely on globe projection.
            For "Animation like 3D map", the globe + pitch + auto-rotate is the main effect.
            Using 'terrain' requires an RGB-DEM source. 
            I will look for a public free dem source or omit actual mesh terrain if not available without key.
            Actually, let's use the 'globe' projection widely.
         */}

                {/* POI Layer */}
                <Source id="pois" type="geojson" data={poiGeoJson}>
                    <Layer
                        id="pois-layer"
                        type="symbol"
                        layout={{
                            'icon-image': 'marker-15', // Might not exist in style, use circle
                            'text-field': ['get', 'name'],
                            'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                            'text-radial-offset': 0.5,
                            'text-justify': 'auto',
                            'text-size': 14,
                            'text-transform': 'uppercase',
                            'text-font': ['Open Sans Bold']
                        }}
                        paint={{
                            'text-color': '#ffffff',
                            'text-halo-color': '#000000',
                            'text-halo-width': 2
                        }}
                    />
                    {/* Fallback circle if icon missing */}
                    <Layer
                        id="pois-circle"
                        type="circle"
                        paint={{
                            'circle-radius': 6,
                            'circle-color': '#ff0055',
                            'circle-stroke-width': 2,
                            'circle-stroke-color': '#fff'
                        }}
                    />
                </Source>

                {/* Selected Path Layer - ONLY shows when a balloon is selected */}
                {/* Selected Path Layer - Animated Drawing */}
                {selectedId && (() => {
                    const selectedBalloon = balloons.find(b => b.id === selectedId);
                    if (!selectedBalloon) return null;

                    // Calculate partial path based on progress
                    const totalPoints = selectedBalloon.path.length;
                    // Ensure at least 2 points to draw a line
                    const visibleCount = Math.max(2, Math.floor(totalPoints * pathProgress));
                    const partialPath = selectedBalloon.path.slice(0, visibleCount);

                    const pathGeoJson: FeatureCollection = {
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: partialPath.map(p => [p.lon, p.lat])
                            },
                            properties: {}
                        }]
                    };

                    return (
                        <Source id="selected-path" type="geojson" data={pathGeoJson}>
                            <Layer
                                id="selected-path-glow"
                                type="line"
                                layout={{
                                    'line-join': 'round',
                                    'line-cap': 'round'
                                }}
                                paint={{
                                    'line-color': '#00ffff', // Cyan glow
                                    'line-width': 4,
                                    'line-opacity': 0.8,
                                    'line-blur': 2
                                }}
                            />
                            <Layer
                                id="selected-path-line"
                                type="line"
                                layout={{
                                    'line-join': 'round',
                                    'line-cap': 'round'
                                }}
                                paint={{
                                    'line-color': '#ffffff',
                                    'line-width': 2,
                                    'line-opacity': 1,
                                    'line-dasharray': [1, 0] // Solid line
                                }}
                            />
                        </Source>
                    );
                })()}

                {/* Current Position Markers */}
                <Source id="points" type="geojson" data={pointsGeoJson}>
                    {/* Pulsing Dot Halo */}
                    <Layer
                        id="balloon-pulsing"
                        type="symbol"
                        layout={{
                            'icon-image': 'pulsing-dot',
                            'icon-allow-overlap': true,
                            'icon-pitch-alignment': 'map',
                            'icon-ignore-placement': true
                        }}
                    />
                    <Layer
                        id="balloon-points-halo"
                        type="circle"
                        paint={{
                            'circle-radius': 15,
                            'circle-color': ['get', 'color'],
                            'circle-opacity': 0.3,
                            'circle-blur': 0.5
                        }}
                    />
                    {/* SVG Balloon Icon */}
                    <Layer
                        id="balloon-points"
                        type="symbol"
                        layout={{
                            'icon-image': 'balloon-icon',
                            'icon-size': 0.6, // SVG is 60x80 roughly, 0.6 makes it ~36px wide which is good
                            'icon-allow-overlap': true,
                            'icon-anchor': 'bottom' // Anchor at bottom so basket touches location
                        }}
                    />
                </Source>

                {/* Balloon Details Card (Replaces Popup) */}
                {hoverInfo && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 animate-in zoom-in-95 fade-in duration-300 pointer-events-auto w-[90%] max-w-2xl">
                        <div className="p-8 bg-black/85 backdrop-blur-2xl text-white rounded-3xl shadow-2xl border border-white/20">
                            <div className="flex items-start justify-between mb-8">
                                <div>
                                    <h3 className="font-bold text-4xl text-blue-400 font-mono tracking-tight mb-2">{hoverInfo.balloonId}</h3>
                                    <span className="text-sm bg-cyan-500/20 px-4 py-1.5 rounded-full text-cyan-300 border border-cyan-500/30 font-bold uppercase tracking-widest">Active Flight</span>
                                </div>
                                <button
                                    onClick={() => { setHoverInfo(null); onSelectBalloon(null); }}
                                    className="p-2 -mr-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-all"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            </div>

                            {(() => {
                                const balloon = balloons.find(b => b.id === hoverInfo.balloonId);
                                if (!balloon) return null;
                                const point = balloon.path[hoverInfo.pointIndex];
                                return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Main Stats */}
                                        <div className="space-y-6">
                                            <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                                                <div className="text-gray-400 text-sm uppercase tracking-wider mb-2">Altitude</div>
                                                <div className="text-5xl font-bold text-yellow-400 flex items-baseline gap-2">
                                                    {point.alt.toFixed(1)} <span className="text-2xl text-yellow-500/70 font-medium">km</span>
                                                </div>
                                            </div>
                                            <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                                                <div className="text-gray-400 text-sm uppercase tracking-wider mb-2">Time Recorded</div>
                                                <div className="text-3xl font-bold text-white font-mono">{formatTime(point.time).split(' ')[0]}</div>
                                                <div className="text-gray-500 text-sm mt-1">{formatTime(point.time).split(' ')[1]}</div>
                                            </div>
                                        </div>

                                        {/* Weather Stats */}
                                        <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 p-6 rounded-2xl border border-white/10 flex flex-col justify-between">
                                            <div className="flex items-center gap-3 mb-6">
                                                <Loader2 className={cn("h-6 w-6", loadingWeather ? "animate-spin text-blue-400" : "text-blue-400")} />
                                                <p className="font-bold text-lg uppercase text-blue-200 tracking-wide">Live Conditions</p>
                                            </div>

                                            {loadingWeather ? (
                                                <div className="h-24 w-full bg-white/10 animate-pulse rounded-xl"></div>
                                            ) : weather ? (
                                                <div className="space-y-6">
                                                    <div>
                                                        <div className="text-6xl font-bold text-white mb-1 flex items-start">
                                                            {weather.temperature}
                                                            <span className="text-3xl text-blue-300 mt-2">°C</span>
                                                        </div>
                                                        <div className="text-sm text-blue-200 uppercase tracking-widest font-semibold">Temperature</div>
                                                    </div>
                                                    <div className="w-full h-px bg-white/10 my-2" />
                                                    <div>
                                                        <div className="text-4xl font-bold text-white mb-1">
                                                            {weather.windSpeed} <span className="text-xl text-gray-400">km/h</span>
                                                        </div>
                                                        <div className="text-sm text-blue-200 uppercase tracking-widest font-semibold">Wind Speed</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-full flex items-center justify-center text-red-400 font-medium">Weather Data Unavailable</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* POI Popup - Keeping as popup or change to card? Let's keep strict to request to just change balloon click */}
                {/* POI Popup */}
                {poiHover && (
                    <Popup
                        longitude={poiHover.lon}
                        latitude={poiHover.lat}
                        closeButton={true}
                        closeOnClick={false}
                        onClose={() => setPoiHover(null)}
                        anchor="bottom"
                        className="text-black popup-dark"
                        maxWidth="320px"
                    >
                        <div className="bg-gray-900 text-white rounded overflow-hidden shadow-2xl border border-white/10">
                            <div className="h-32 w-full relative">
                                {/* Use Next Image if configured, or just img tag for ext url */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={poiHover.image}
                                    alt={poiHover.name}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
                                <h3 className="absolute bottom-2 left-3 font-bold text-xl text-white shadow-black drop-shadow-md">{poiHover.name}</h3>
                            </div>
                            <div className="p-3">
                                <p className="text-sm text-gray-300 leading-relaxed">{poiHover.desc}</p>
                                <button className="mt-3 w-full py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold uppercase tracking-wide transition-colors">
                                    Explore Location
                                </button>
                            </div>
                        </div>
                    </Popup>
                )}

            </Map>
            <style jsx global>{`
        .mapboxgl-popup-content { background: transparent !important; padding: 0 !important; box-shadow: none !important; }
        .mapboxgl-popup-tip { border-top-color: #111827 !important; }
      `}</style>
        </div>
    );
}
