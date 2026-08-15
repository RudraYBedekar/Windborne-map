'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Bot,
    Send,
    X,
    Minimize2,
    Maximize2,
    Sparkles,
    Trash2,
    Radio,
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
    modelDisplayName?: string;
    isFallback?: boolean;
    aiUnavailable?: boolean;
    sources?: Array<{ type?: string; provider?: string; isFallback?: boolean }>;
}

interface AiStatus {
    provider?: string;
    model_id?: string | null;
    model_display_name?: string | null;
    AI_PROVIDER?: string;
    AI_MODEL?: string | null;
    AI_MODEL_DISPLAY_NAME?: string | null;
    bedrock_ready?: boolean;
    balloons_enabled?: boolean;
}

interface VickyChatProps {
    balloons: Balloon[];
    selectedBalloon?: Balloon | null;
    weather?: WeatherData | null;
    isOpen: boolean;
    onToggle: () => void;
    onAction?: (action: any) => void;
}

export default function VickyChat({
    balloons,
    selectedBalloon,
    weather,
    isOpen,
    onToggle,
    onAction,
}: VickyChatProps) {
    const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const welcomeSeeded = useRef(false);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/chat', { cache: 'no-store' })
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) setAiStatus(data);
            })
            .catch(() => {
                if (!cancelled) setAiStatus({ bedrock_ready: false });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (welcomeSeeded.current || !aiStatus) return;
        welcomeSeeded.current = true;
        setMessages([
            {
                id: 'welcome-msg',
                role: 'assistant',
                content:
                    `**Vicky-AI** — WindBorne Mission Operations Copilot.\n\n` +
                    `I answer from live tools only (WeatherMesh weather, tropical cyclones, location search). ` +
                    `I will not invent storm positions or forecast numbers.\n\n` +
                    `Try: *Where are the active tropical cyclones?*, *weather in Fairfax*, or *forecast for LALA at +24h*.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
        ]);
    }, [aiStatus]);
    useEffect(() => {
        if (isOpen && !isMinimized) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen, isMinimized]);

    // Optional context hints only — backend still must verify via tools
    const fleetContext = useMemo(() => {
        if (!balloons || balloons.length === 0) return null;
        return { total_balloons_hint: balloons.length, note: 'hint_only_verify_via_tools' };
    }, [balloons]);

    const selectedBalloonContext = useMemo(() => {
        if (!selectedBalloon?.latestPoint) return null;
        return { id: selectedBalloon.id };
    }, [selectedBalloon]);

    const weatherContext = useMemo(() => {
        if (!weather) return null;
        return {
            provider: weather.provider,
            note: 'hint_only_verify_via_get_weather',
        };
    }, [weather]);

    const handleSendMessage = async (textToSend?: string) => {
        const queryText = (textToSend || input).trim();
        if (!queryText || loading) return;

        const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: queryText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        const updatedMessages = [...messages, userMsg];
        setMessages(updatedMessages);
        setInput('');
        setLoading(true);

        try {
            const apiMessages = updatedMessages
                .filter((m) => m.id !== 'welcome-msg' && m.id !== 'welcome-reset')
                .map((m) => ({ role: m.role, content: m.content }));

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: apiMessages.length ? apiMessages : [{ role: 'user', content: queryText }],
                    fleet_context: fleetContext,
                    selected_balloon: selectedBalloonContext,
                    weather_context: weatherContext,
                }),
            });

            if (!response.ok) throw new Error(`Chat API ${response.status}`);

            const data = await response.json();
            const botMsg: ChatMessage = {
                id: `bot-${Date.now()}`,
                role: 'assistant',
                content: data.reply || 'I could not form a grounded answer.',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isFallback: Boolean(data.is_fallback),
                aiUnavailable: Boolean(data.ai_unavailable),
                sources: data.sources || [],
            };
            setMessages((prev) => [...prev, botMsg]);

            if (Array.isArray(data.actions) && onAction) {
                data.actions.forEach((a: any) => onAction(a));
            }
        } catch (err) {
            console.error('Vicky-AI Chat error:', err);
            setMessages((prev) => [
                ...prev,
                {
                    id: `bot-err-${Date.now()}`,
                    role: 'assistant',
                    content:
                        '⚠️ **AI service unavailable.** I will not invent fleet or weather numbers. Please check that the API backend is running.',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    aiUnavailable: true,
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleClearChat = () => {
        setMessages([
            {
                id: 'welcome-reset',
                role: 'assistant',
                content: '🧹 Chat cleared. Ask a grounded weather, location, or concept question.',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
        ]);
    };

    if (!isOpen) return null;

    return (
        <div
            className={cn(
                'fixed z-40 transition-all duration-200 font-mono select-none',
                isMinimized
                    ? 'bottom-4 right-4 w-72 h-12'
                    : 'bottom-4 right-4 md:right-6 w-[94vw] max-w-lg md:w-[440px] h-[580px] max-h-[85vh]',
                'bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl shadow-2xl shadow-cyan-950/60 flex flex-col overflow-hidden'
            )}
        >
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/50 border-b border-cyan-500/20 text-slate-200">
                <div className="flex items-center gap-2.5">
                    <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/50 text-cyan-300">
                        <Bot className="w-4 h-4 text-cyan-300" />
                        <span
                            className={cn(
                                'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full',
                                aiStatus?.bedrock_ready ? 'bg-emerald-400' : 'bg-amber-400'
                            )}
                        />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs md:text-sm tracking-wider text-slate-100 flex items-center gap-1">
                                Vicky-AI
                                <Sparkles className="w-3 h-3 text-cyan-400 inline" />
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
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                    >
                        {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={onToggle}
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {isMinimized ? (
                <div
                    onClick={() => setIsMinimized(false)}
                    className="flex-1 px-3 flex items-center justify-between text-xs text-cyan-300/90 cursor-pointer hover:bg-slate-900/50"
                >
                    <span className="truncate">Vicky-AI · grounded tools</span>
                    <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse shrink-0" />
                </div>
            ) : (
                <>
                    <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                        <div className="truncate">
                            <span className="text-cyan-400 font-bold">GROUNDED</span>
                            <span className="ml-2">WeatherMesh tools only</span>
                        </div>
                    </div>

                    <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
                        {messages.map((m) => {
                            const isUser = m.role === 'user';
                            const weatherSource = m.sources?.find((s) => s.type === 'weather');
                            return (
                                <div
                                    key={m.id}
                                    className={cn(
                                        'flex flex-col max-w-[88%] rounded-xl p-3 shadow-lg select-text',
                                        isUser
                                            ? 'ml-auto bg-cyan-950/90 border border-cyan-700/80 text-cyan-100 rounded-tr-none'
                                            : 'mr-auto bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-none'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[9px] text-slate-400 border-b border-slate-700/40 pb-1">
                                        <span className="font-bold text-cyan-400">
                                            {isUser ? 'OPERATOR' : 'VICKY-AI'}
                                        </span>
                                        <span className="text-slate-500">{m.timestamp}</span>
                                    </div>

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
                                            return (
                                                <p key={idx} className="min-h-[1rem]">
                                                    {renderFormattedText(line)}
                                                </p>
                                            );
                                        })}
                                    </div>

                                    {!isUser && (m.aiUnavailable || weatherSource || m.sources?.some((s) => s.type === 'fleet_telemetry')) && (
                                        <div className="mt-2 pt-1 border-t border-slate-800 text-[8px] text-slate-500 flex flex-col gap-0.5">
                                            {m.aiUnavailable && (
                                                <span className="text-amber-500">AI unavailable</span>
                                            )}
                                            {weatherSource && (
                                                <span>
                                                    Weather:{' '}
                                                    {weatherSource.isFallback
                                                        ? 'Open-Meteo fallback'
                                                        : weatherSource.provider || 'WeatherMesh'}
                                                </span>
                                            )}
                                            {m.sources?.some((s) => s.type === 'fleet_telemetry') && (
                                                <span>Data: WindBorne Treasure (unverified feed)</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex items-center gap-2 text-cyan-400 bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl mr-auto text-xs animate-pulse">
                                <Bot className="w-4 h-4 text-cyan-400" />
                                <span>Thinking…</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Ask about weather, locations, or atmospheric concepts…"
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
                            className="p-2.5 bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 text-slate-950 font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function renderFormattedText(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return (
                <strong key={i} className="font-bold text-cyan-300">
                    {part.slice(2, -2)}
                </strong>
            );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return (
                <code
                    key={i}
                    className="px-1 py-0.5 rounded bg-slate-950 border border-slate-700/60 text-cyan-300 font-mono text-[11px]"
                >
                    {part.slice(1, -1)}
                </code>
            );
        }
        return part;
    });
}
