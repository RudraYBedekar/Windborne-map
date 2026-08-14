'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Bot,
    Send,
    X,
    Minimize2,
    Maximize2,
    Sparkles,
    RefreshCw,
    Compass,
    Cloud,
    TrendingUp,
    Shield,
    Trash2,
    Radio
} from 'lucide-react';
import { Balloon } from '@/services/windborne';
import { WeatherData } from '@/services/weather';
import { cn } from '@/lib/utils';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    provider?: string;
    isFallback?: boolean;
}

interface VickyChatProps {
    balloons: Balloon[];
    selectedBalloon?: Balloon | null;
    weather?: WeatherData | null;
    isOpen: boolean;
    onToggle: () => void;
}

const QUICK_PROMPTS = [
    { label: "Fleet Summary", prompt: "Summarize current fleet intelligence and active constellation status." },
    { label: "Highest Altitude", prompt: "Which balloon is currently flying at the highest altitude?" },
    { label: "Fastest Balloon", prompt: "What is the fastest moving balloon and what are its coordinates?" },
    { label: "WeatherMesh Insight", prompt: "Analyze the current atmospheric weather conditions and WeatherMesh forecast." },
    { label: "Selected Balloon", prompt: "Give me an operational flight analysis for the currently selected balloon." }
];

export default function VickyChat({
    balloons,
    selectedBalloon,
    weather,
    isOpen,
    onToggle
}: VickyChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: 'welcome-msg',
            role: 'assistant',
            content: "👋 **Greetings! I am Vicky-AI**, your Lead Flight Operations & Meteorological Co-Pilot for the WindBorne stratospheric balloon constellation.\n\nPowered by **NVIDIA Nemotron Nano 3 30B** on Amazon Bedrock, I monitor high-altitude trajectories, evaluate WeatherMesh AI forecasts, and analyze real-time fleet dynamics. How can I assist your mission today?",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            provider: 'NVIDIA Nemotron (Bedrock)'
        }
    ]);

    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of messages
    useEffect(() => {
        if (isOpen && !isMinimized) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen, isMinimized]);

    // Build real-time contextual snapshot from active app props
    const fleetContext = useMemo(() => {
        if (!balloons || balloons.length === 0) return null;
        const total = balloons.length;
        const highAlt = balloons.filter(b => (b.latestPoint?.alt || 0) >= 18000).length;
        const avgAlt = Math.round(balloons.reduce((acc, b) => acc + (b.latestPoint?.alt || 0), 0) / total);

        let highest: any = null;
        let fastest: any = null;

        for (const b of balloons) {
            const alt = b.latestPoint?.alt || 0;
            const speed = b.currentSpeedKmh || 0;
            if (!highest || alt > (highest.alt || 0)) {
                highest = {
                    id: b.id,
                    alt,
                    alt_ft: alt * 3.28084,
                    lat: b.latestPoint?.lat,
                    lon: b.latestPoint?.lon,
                    speed_kmh: speed
                };
            }
            if (!fastest || speed > (fastest.speed_kmh || 0)) {
                fastest = {
                    id: b.id,
                    alt,
                    alt_ft: alt * 3.28084,
                    lat: b.latestPoint?.lat,
                    lon: b.latestPoint?.lon,
                    speed_kmh: speed
                };
            }
        }

        return {
            total_balloons: total,
            high_altitude_count: highAlt,
            avg_altitude_m: avgAlt,
            highest_balloon: highest,
            fastest_balloon: fastest
        };
    }, [balloons]);

    const selectedBalloonContext = useMemo(() => {
        if (!selectedBalloon || !selectedBalloon.latestPoint) return null;
        const pt = selectedBalloon.latestPoint;
        return {
            id: selectedBalloon.id,
            lat: pt.lat,
            lon: pt.lon,
            alt: pt.alt,
            alt_ft: pt.alt * 3.28084,
            speed_kmh: selectedBalloon.currentSpeedKmh,
            heading: selectedBalloon.headingDeg ? `${Math.round(selectedBalloon.headingDeg)}°` : 'N/A',
            duration_hours: selectedBalloon.flightDurationHours?.toFixed(1) || 'N/A'
        };
    }, [selectedBalloon]);

    const weatherContext = useMemo(() => {
        if (!weather) return null;
        return {
            provider: weather.provider,
            temperature: weather.temperature,
            pressure: weather.pressure,
            windSpeed: weather.windSpeed,
            windDirection: weather.windDirection,
            precipitation: weather.precipitation,
            cloudCover: weather.cloudCover
        };
    }, [weather]);


    const handleSendMessage = async (textToSend?: string) => {
        const queryText = (textToSend || input).trim();
        if (!queryText || loading) return;

        const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: queryText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        const updatedMessages = [...messages, userMsg];
        setMessages(updatedMessages);
        setInput('');
        setLoading(true);

        try {
            const apiMessages = updatedMessages.map(m => ({
                role: m.role,
                content: m.content
            }));

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: apiMessages,
                    fleet_context: fleetContext,
                    selected_balloon: selectedBalloonContext,
                    weather_context: weatherContext
                })
            });

            if (!response.ok) {
                throw new Error(`Chat API responded with status ${response.status}`);
            }

            const data = await response.json();
            const botMsg: ChatMessage = {
                id: `bot-${Date.now()}`,
                role: 'assistant',
                content: data.reply || "Telemetry analysis completed.",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                provider: data.provider,
                isFallback: data.is_fallback
            };

            setMessages(prev => [...prev, botMsg]);
        } catch (err) {
            console.error("Vicky-AI Chat error:", err);
            const errorMsg: ChatMessage = {
                id: `bot-err-${Date.now()}`,
                role: 'assistant',
                content: "⚠️ **Telemetry Link Interruption**: Unable to contact Bedrock AI service. Please verify your connection or check backend logs.",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isFallback: true
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const handleClearChat = () => {
        setMessages([
            {
                id: 'welcome-reset',
                role: 'assistant',
                content: "🧹 Flight log reset. Ready for new mission inquiries!",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        ]);
    };

    if (!isOpen) return null;

    return (
        <div
            className={cn(
                "fixed z-40 transition-all duration-200 font-mono select-none",
                isMinimized
                    ? "bottom-4 right-4 w-72 h-12"
                    : "bottom-4 right-4 md:right-6 w-[94vw] max-w-lg md:w-[440px] h-[580px] max-h-[85vh]",
                "bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl shadow-2xl shadow-cyan-950/60 flex flex-col overflow-hidden"
            )}
        >
            {/* Header Bar */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/50 border-b border-cyan-500/20 text-slate-200">
                <div className="flex items-center gap-2.5">
                    <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 shadow-md shadow-cyan-500/20">
                        <Bot className="w-4 h-4 text-cyan-300 animate-pulse" />
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs md:text-sm tracking-wider text-slate-100 flex items-center gap-1">
                                Vicky-AI
                                <Sparkles className="w-3 h-3 text-cyan-400 inline" />
                            </span>
                            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-semibold">
                                BEDROCK CO-PILOT
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {!isMinimized && (
                        <button
                            onClick={handleClearChat}
                            title="Clear Chat History"
                            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        title={isMinimized ? "Expand Vicky-AI" : "Minimize Vicky-AI"}
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                    >
                        {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={onToggle}
                        title="Close Chat"
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Minimized Bar Preview */}
            {isMinimized ? (
                <div
                    onClick={() => setIsMinimized(false)}
                    className="flex-1 px-3 flex items-center justify-between text-xs text-cyan-300/90 cursor-pointer hover:bg-slate-900/50"
                >
                    <span className="truncate">Click to resume flight intelligence chat</span>
                    <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse shrink-0" />
                </div>
            ) : (
                <>
                    {/* Live Context Ribbon */}
                    <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                        <div className="flex items-center gap-2 truncate">
                            <span className="text-cyan-400 font-bold">LIVE CONTEXT:</span>
                            <span>Fleet: {fleetContext?.total_balloons || 0} Craft</span>
                            {selectedBalloon && (
                                <span className="text-amber-300 font-bold">• Lock: {selectedBalloon.id}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-slate-500">
                            <span>AWS Bedrock</span>
                        </div>
                    </div>

                    {/* Messages Scroll Area */}
                    <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
                        {messages.map((m) => {
                            const isUser = m.role === 'user';
                            return (
                                <div
                                    key={m.id}
                                    className={cn(
                                        "flex flex-col max-w-[88%] rounded-xl p-3 shadow-lg select-text",
                                        isUser
                                            ? "ml-auto bg-cyan-950/90 border border-cyan-700/80 text-cyan-100 rounded-tr-none"
                                            : "mr-auto bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-none"
                                    )}
                                >
                                    {/* Message Header */}
                                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[9px] text-slate-400 border-b border-slate-700/40 pb-1">
                                        <span className="font-bold flex items-center gap-1 text-cyan-400">
                                            {isUser ? 'FLIGHT OPERATOR' : 'VICKY-AI'}
                                        </span>
                                        <span className="text-slate-500">{m.timestamp}</span>
                                    </div>

                                    {/* Message Body (Markdown formatted) */}
                                    <div className="leading-relaxed whitespace-pre-wrap font-sans text-xs space-y-1">
                                        {m.content.split('\n').map((line, idx) => {
                                            if (line.startsWith('- ')) {
                                                return (
                                                    <div key={idx} className="flex items-start gap-1.5 pl-1 my-0.5">
                                                        <span className="text-cyan-400">•</span>
                                                        <span>{renderFormattedText(line.replace('- ', ''))}</span>
                                                    </div>
                                                );
                                            }
                                            return <p key={idx} className="min-h-[1rem]">{renderFormattedText(line)}</p>;
                                        })}
                                    </div>

                                    {/* Provider Tag */}
                                    {m.provider && (
                                        <div className="mt-2 pt-1 border-t border-slate-800 text-[8px] text-slate-500 flex items-center justify-between">
                                            <span>Engine: {m.provider}</span>
                                            {m.isFallback && <span className="text-amber-500">Local Fallback</span>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex items-center gap-2 text-cyan-400 bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl mr-auto text-xs animate-pulse">
                                <Bot className="w-4 h-4 animate-spin text-cyan-400" />
                                <span>Vicky-AI is analyzing atmospheric soundings & Bedrock model...</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Quick Suggestion Pills */}
                    <div className="px-2.5 py-1.5 bg-slate-950/80 border-t border-slate-800/80 overflow-x-auto flex gap-1.5 no-scrollbar shrink-0">
                        {QUICK_PROMPTS.map((qp, idx) => (
                            <button
                                key={idx}
                                onClick={() => handleSendMessage(qp.prompt)}
                                disabled={loading}
                                className="px-2 py-1 bg-slate-900/90 hover:bg-cyan-950 hover:border-cyan-700 text-slate-300 hover:text-cyan-300 border border-slate-800 rounded-md text-[10px] whitespace-nowrap transition-all flex items-center gap-1 disabled:opacity-50"
                            >
                                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                                {qp.label}
                            </button>
                        ))}
                    </div>

                    {/* Input Field */}
                    <div className="p-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Ask Vicky-AI about fleet telemetry, WeatherMesh, or stratospheric dynamics..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            disabled={loading}
                            className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition-all font-mono"
                        />
                        <button
                            onClick={() => handleSendMessage()}
                            disabled={!input.trim() || loading}
                            className="p-2.5 bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-cyan-950/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                            title="Send Mission Inquiry"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// Simple bold and code formatter helper
function renderFormattedText(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-cyan-300">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return (
                <code key={i} className="px-1 py-0.5 rounded bg-slate-950 border border-slate-700/60 text-cyan-300 font-mono text-[11px]">
                    {part.slice(1, -1)}
                </code>
            );
        }
        return part;
    });
}
