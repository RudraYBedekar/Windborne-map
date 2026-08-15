"""
Vicky-AI Mission Operations Copilot — Amazon Bedrock grounded chat service.

Principle: The LLM explains the data. The application provides the truth.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.ai_config import get_ai_config
from services import ai_tools

logger = logging.getLogger("bedrock_service")
logging.basicConfig(level=logging.INFO)


SYSTEM_PROMPT = """You are Vicky-AI, the WindBorne Mission Operations Copilot powered by Amazon Bedrock.

## Grounding policy (mandatory)
You have NO independent knowledge of the current balloon fleet, live weather, or operational status.
Any claim about balloon counts, positions, altitudes, speeds, trajectories, telemetry age, fleet averages,
anomalies, or location-specific weather MUST come from a tool result in THIS request.

Never estimate, assume, invent, or recycle example numbers.
Never claim NOAA solar-terminator validation, "1000 balloons", or other demo facts unless a tool returned them.

If required data cannot be retrieved, say exactly one of:
- "I couldn't verify that from the current telemetry."
- "The WeatherMesh service did not return enough information to answer that reliably."
- "AI service tools could not complete this request."

Never silently substitute fictional data.

## Balloons / Treasure feed
Balloon markers may be disabled in the UI because the public Treasure feed is not operationally accurate.
If get_fleet_status returns dataQuality=unverified_public_feed or balloonsEnabledInUI=false, say so clearly.
Do not present Treasure index IDs as certified mission truth.

## Weather
Use get_weather for atmospheric conditions. Respect provider and isFallback fields.
If isFallback is true, label the source as Open-Meteo fallback — never call it WeatherMesh.

## Locations
Bare place names (e.g. "fairfax") are LOCATION_SEARCH. Use search_location.
After resolving, ask whether the user wants weather, balloons nearby, or a globe fly-to —
do NOT dump unrelated fleet statistics.

## Tropical cyclones / gridded forecasts
Use list_tropical_cyclones, get_tropical_cyclone, get_cyclone_forecast for storm questions.
Use get_gridded_forecast_summary for regional grid statistics.
Never invent cyclone position, intensity, landfall, track, cone, or grid values.
If a field is null, say it is unavailable from WeatherMesh.
Forecast Cone = ensemble-supported range of plausible positions — NOT a guaranteed impact region.

## Conceptual knowledge
You MAY explain general concepts (what pressure means, what a stratospheric balloon is, solar terminator)
without tools. Operational claims always need tools.

## Style
Be concise, mission-focused, and honest about uncertainty. Use short markdown.
When tools return numbers, quote those exact numbers — do not alter them.
"""


class BedrockChatService:
    def __init__(self, weather_client=None, telemetry_loader=None, cyclone_service=None, gridded_service=None):
        self.weather_client = weather_client
        self.telemetry_loader = telemetry_loader  # async callable -> list[balloon]
        self.cyclone_service = cyclone_service
        self.gridded_service = gridded_service
        self.client = None
        self.last_error: Optional[str] = None
        self._refresh_config()
        if self.enabled:
            self._init_client()

    def _refresh_config(self):
        cfg = get_ai_config()
        self.enabled = cfg["BEDROCK_ENABLED"]
        self.region = cfg["AWS_REGION"]
        self.model_id = cfg["AI_MODEL"]
        self.display_name = cfg["AI_MODEL_DISPLAY_NAME"]
        self.provider_name = cfg["AI_PROVIDER"]
        self.balloons_enabled = cfg["BALLOONS_ENABLED"]
        self.cyclones_enabled = cfg.get("CYCLONES_ENABLED", True)
        self.gridded_enabled = cfg.get("GRIDDED_FORECASTS_ENABLED", True)

    def _init_client(self):
        try:
            import boto3
            import os
            from botocore.config import Config

            config = Config(
                region_name=self.region,
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=5,
                read_timeout=45,
            )
            aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
            aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
            aws_session_token = os.getenv("AWS_SESSION_TOKEN")

            kwargs = {"region_name": self.region, "config": config}
            if aws_access_key and aws_secret_key:
                kwargs.update(
                    {
                        "aws_access_key_id": aws_access_key,
                        "aws_secret_access_key": aws_secret_key,
                        "aws_session_token": aws_session_token,
                    }
                )
            self.client = boto3.client("bedrock-runtime", **kwargs)
            self.last_error = None
            logger.info(
                "[Vicky-AI] Bedrock ready provider=%s model=%s display=%s",
                self.provider_name,
                self.model_id,
                self.display_name,
            )
        except Exception as e:
            self.client = None
            self.last_error = f"{type(e).__name__}: {e}"
            logger.warning("[Vicky-AI] Bedrock init failed: %s", self.last_error)

    def get_status(self) -> Dict[str, Any]:
        self._refresh_config()
        import os

        has_keys = bool(os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"))
        return {
            "enabled": self.enabled,
            "bedrock_ready": self.client is not None,
            "provider": self.provider_name,
            "model_id": self.model_id,
            "model_display_name": self.display_name,
            "AI_PROVIDER": self.provider_name,
            "AI_MODEL": self.model_id,
            "AI_MODEL_DISPLAY_NAME": self.display_name,
            "region": self.region,
            "auth_method": "Explicit API Keys" if has_keys else "IAM Role / Default Credential Chain",
            "last_error": self.last_error,
            "balloons_enabled": self.balloons_enabled,
            "cyclones_enabled": self.cyclones_enabled,
            "gridded_enabled": self.gridded_enabled,
            "fallback_available": False,  # no inventing local engine
            "grounded": True,
        }

    async def _load_balloons(self) -> List[Dict[str, Any]]:
        if not self.telemetry_loader:
            return []
        try:
            data = await self.telemetry_loader()
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.warning("[Vicky-AI] telemetry_loader failed: %s", type(e).__name__)
            return []

    async def _execute_tool(self, name: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
        t0 = time.time()
        logger.info("[Vicky-AI] tool=%s params=%s", name, json.dumps(tool_input, default=str)[:300])

        if name == "search_location":
            out = await ai_tools.search_location(tool_input.get("query", ""))
        elif name == "get_weather":
            if not self.weather_client:
                out = {"ok": False, "error": "WEATHER_CLIENT_MISSING"}
            else:
                out = await ai_tools.get_weather(
                    float(tool_input["latitude"]),
                    float(tool_input["longitude"]),
                    self.weather_client,
                )
        elif name == "get_fleet_status":
            balloons = await self._load_balloons()
            out = ai_tools.compute_fleet_stats(balloons)
        elif name == "get_balloon":
            balloons = await self._load_balloons()
            out = ai_tools.find_balloon(balloons, tool_input.get("balloon_id", ""))
        elif name == "list_tropical_cyclones":
            if not self.cyclone_service or not self.cyclones_enabled:
                out = {"ok": False, "error": "CYCLONES_UNAVAILABLE"}
            else:
                payload = await self.cyclone_service.fetch_cyclones(include_details=True)
                if not payload.get("ok"):
                    out = payload
                else:
                    storms = []
                    for cid, s in (payload.get("tropical_cyclones") or {}).items():
                        storms.append(
                            {
                                "tropical_cyclone_id": cid,
                                "storm_name": s.get("storm_name"),
                                "basins": s.get("basins"),
                                "max_wind_kt": s.get("max_wind_kt"),
                                "min_mslp_hpa": s.get("min_mslp_hpa"),
                                "start_time": s.get("start_time"),
                                "end_time": s.get("end_time"),
                                "path_points": len(s.get("path") or []),
                                "has_cone": bool(s.get("cone") and s["cone"].get("geometry")),
                                "landfall_count": len(s.get("landfalls") or []),
                            }
                        )
                    # strongest by max_wind_kt when available
                    ranked = [s for s in storms if isinstance(s.get("max_wind_kt"), (int, float))]
                    strongest = max(ranked, key=lambda s: s["max_wind_kt"]) if ranked else None
                    out = {
                        "ok": True,
                        "initialization_time": payload.get("initialization_time"),
                        "forecast_zero": payload.get("forecast_zero"),
                        "total": payload.get("total"),
                        "cyclones": storms,
                        "strongest": strongest,
                        "from_cache": payload.get("from_cache"),
                        "provider": payload.get("provider"),
                        "model": payload.get("model"),
                    }
        elif name == "get_tropical_cyclone":
            if not self.cyclone_service or not self.cyclones_enabled:
                out = {"ok": False, "error": "CYCLONES_UNAVAILABLE"}
            else:
                payload = await self.cyclone_service.fetch_cyclones(include_details=True)
                storm = self.cyclone_service.get_storm(payload, tool_input.get("cyclone_id", ""))
                if not storm:
                    out = {"ok": False, "error": "NOT_FOUND", "cyclone_id": tool_input.get("cyclone_id")}
                else:
                    out = {
                        "ok": True,
                        "cyclone": storm,
                        "initialization_time": payload.get("initialization_time"),
                        "provider": payload.get("provider"),
                        "model": payload.get("model"),
                        "from_cache": payload.get("from_cache"),
                    }
        elif name == "get_cyclone_forecast":
            if not self.cyclone_service or not self.cyclones_enabled:
                out = {"ok": False, "error": "CYCLONES_UNAVAILABLE"}
            else:
                hour = int(tool_input.get("forecast_hour", 0))
                payload = await self.cyclone_service.fetch_cyclones(include_details=True)
                storm = self.cyclone_service.get_storm(payload, tool_input.get("cyclone_id", ""))
                if not storm:
                    out = {"ok": False, "error": "NOT_FOUND"}
                else:
                    point = self.cyclone_service.point_at_hour(storm, hour)
                    out = {
                        "ok": True,
                        "cyclone_id": storm.get("tropical_cyclone_id"),
                        "storm_name": storm.get("storm_name"),
                        "forecast_hour": hour,
                        "point": point,
                        "has_cone": bool(storm.get("cone") and storm["cone"].get("geometry")),
                        "landfall_count": len(storm.get("landfalls") or []),
                        "cone_note": (
                            "Forecast cone is the WeatherMesh ensemble-supported range of "
                            "plausible cyclone positions — not a guaranteed impact region."
                        ),
                        "provider": payload.get("provider"),
                        "model": payload.get("model"),
                    }
        elif name == "get_gridded_forecast_summary":
            if not self.gridded_service or not self.gridded_enabled:
                out = {"ok": False, "error": "GRIDDED_UNAVAILABLE"}
            else:
                out = await self.gridded_service.get_summary(
                    tool_input.get("variable", "temperature_2m"),
                    tool_input.get("bbox", "-130,20,-60,55"),
                    int(tool_input.get("forecast_hour", 0) or 0),
                )
        else:
            out = {"ok": False, "error": "UNKNOWN_TOOL", "name": name}

        ms = int((time.time() - t0) * 1000)
        logger.info(
            "[Vicky-AI] tool=%s ok=%s latency_ms=%s",
            name,
            out.get("ok"),
            ms,
        )
        return out

    def _unavailable_response(self, reason: str) -> Dict[str, Any]:
        return {
            "reply": (
                "⚠️ **AI service unavailable.** "
                "I can't generate mission intelligence without Amazon Bedrock right now. "
                "WeatherMesh and dashboard tools may still work independently.\n\n"
                f"_Reason: {reason}_"
            ),
            "provider": self.provider_name,
            "model": self.model_id,
            "model_display_name": self.display_name,
            "is_fallback": False,
            "ai_unavailable": True,
            "sources": [],
            "toolCalls": [],
            "actions": [],
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "last_error": self.last_error,
        }

    async def _location_first_path(self, query: str) -> Optional[Dict[str, Any]]:
        """Deterministic routing for bare place names — never invent fleet facts."""
        if not ai_tools.look_like_bare_location(query):
            return None

        loc = await ai_tools.search_location(query)
        if not loc.get("ok") or not loc.get("results"):
            return {
                "reply": (
                    f"I couldn't resolve **{query}** to a map location. "
                    "Try a more specific place name (city + state/country)."
                ),
                "provider": self.provider_name,
                "model": self.model_id,
                "model_display_name": self.display_name,
                "is_fallback": False,
                "sources": [
                    {
                        "type": "geocoder",
                        "provider": "OpenStreetMap Nominatim",
                        "retrievedAt": loc.get("retrievedAt"),
                    }
                ],
                "toolCalls": [{"name": "search_location", "input": {"query": query}, "result": loc}],
                "actions": [],
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }

        top = loc["results"][0]
        lat, lon = top["latitude"], top["longitude"]
        actions = [
            {
                "type": "FLY_TO_LOCATION",
                "latitude": lat,
                "longitude": lon,
                "name": top.get("name"),
            }
        ]

        # Optionally attach weather for stronger UX
        weather_bit = ""
        weather_src = None
        tool_calls = [{"name": "search_location", "input": {"query": query}, "result": loc}]
        if self.weather_client:
            wx = await ai_tools.get_weather(lat, lon, self.weather_client)
            tool_calls.append(
                {"name": "get_weather", "input": {"latitude": lat, "longitude": lon}, "result": wx}
            )
            if wx.get("ok"):
                cur = wx.get("current") or {}
                label = wx.get("provider")
                if wx.get("isFallback"):
                    label = f"{label} (fallback)"
                weather_bit = (
                    f"\n\n**Current conditions** ({label}):\n"
                    f"- Temp: `{cur.get('temperature')} °C`\n"
                    f"- Pressure: `{cur.get('pressure')} hPa`\n"
                    f"- Wind: `{cur.get('windSpeed')} km/h` @ `{cur.get('windDirection')}°`\n"
                    f"- Precip: `{cur.get('precipitation')} mm/h`"
                )
                weather_src = {
                    "type": "weather",
                    "provider": wx.get("provider"),
                    "isFallback": wx.get("isFallback"),
                    "retrievedAt": wx.get("retrievedAt"),
                }

        reply = (
            f"📍 I found **{top.get('name')}** "
            f"(`{lat:.4f}°, {lon:.4f}°`).\n\n"
            f"Would you like me to:\n"
            f"- check WeatherMesh conditions here,\n"
            f"- move the globe to this location,\n"
            f"- or look for nearby balloons "
            f"(note: balloon markers are currently hidden because the public Treasure feed is not operationally accurate)?"
            f"{weather_bit}"
        )
        sources = [
            {
                "type": "geocoder",
                "provider": "OpenStreetMap Nominatim",
                "retrievedAt": loc.get("retrievedAt"),
            }
        ]
        if weather_src:
            sources.append(weather_src)

        return {
            "reply": reply,
            "provider": self.provider_name,
            "model": "deterministic-router",
            "model_display_name": self.display_name,
            "is_fallback": False,
            "sources": sources,
            "toolCalls": tool_calls,
            "actions": actions,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    async def generate_response(
        self,
        messages: List[Dict[str, str]],
        fleet_context: Optional[Dict[str, Any]] = None,
        selected_balloon: Optional[Dict[str, Any]] = None,
        weather_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self._refresh_config()
        user_message = messages[-1].get("content", "") if messages else ""
        t0 = time.time()
        logger.info("[Vicky-AI] query=%s", user_message[:200])

        # 1) Deterministic location routing (fixes "fairfax" → random fleet rant)
        routed = await self._location_first_path(user_message)
        if routed:
            logger.info(
                "[Vicky-AI] intent=LOCATION_SEARCH latency_ms=%s",
                int((time.time() - t0) * 1000),
            )
            return routed

        # 2) Bedrock required for LLM answers — no inventing local engine
        if not self.client and self.enabled:
            self._init_client()
        if not self.client:
            return self._unavailable_response(self.last_error or "Bedrock client not initialized")

        # Bound payload size / token cost (prompt-injection & abuse mitigation)
        max_chars = int(os.getenv("CHAT_MAX_MESSAGE_CHARS", "2000") or "2000")
        sanitized: List[Dict[str, str]] = []
        for m in messages[-12:]:
            content = (m.get("content") or "")[:max_chars]
            role = m.get("role") or "user"
            if role not in ("user", "assistant"):
                role = "user"
            sanitized.append({"role": role, "content": content})
        messages = sanitized
        user_message = messages[-1].get("content", "") if messages else ""

        # Inject light session context (facts only if provided by app — still prefer tools)
        context_bits = []
        if selected_balloon and self.balloons_enabled:
            context_bits.append(f"UI selected balloon id hint: {selected_balloon.get('id')}")
        if weather_context and weather_context.get("provider"):
            context_bits.append(
                f"UI last weather provider hint: {weather_context.get('provider')} "
                "(verify with get_weather before citing numbers)"
            )
        if not self.balloons_enabled:
            context_bits.append(
                "BALLOONS_ENABLED=false — fleet tools are unavailable; do not invent balloon data."
            )

        system = SYSTEM_PROMPT
        if context_bits:
            system += "\n\n## Session hints\n- " + "\n- ".join(context_bits)

        bedrock_messages = []
        for m in messages:
            role = "user" if m.get("role") == "user" else "assistant"
            bedrock_messages.append(
                {"role": role, "content": [{"text": m.get("content", "")}]}
            )

        tool_trace: List[Dict[str, Any]] = []
        sources: List[Dict[str, Any]] = []
        actions: List[Dict[str, Any]] = []
        active_tools = ai_tools.tools_for_config(
            balloons_enabled=self.balloons_enabled,
            cyclones_enabled=self.cyclones_enabled,
            gridded_enabled=self.gridded_enabled,
        )

        try:
            # Tool loop (max 3 rounds)
            for _round in range(3):
                converse_kwargs: Dict[str, Any] = {
                    "modelId": self.model_id,
                    "messages": bedrock_messages,
                    "system": [{"text": system}],
                    # Haiku 4.5 rejects temperature + topP together — use temperature only
                    "inferenceConfig": {"maxTokens": 1024, "temperature": 0.2},
                }
                if active_tools:
                    converse_kwargs["toolConfig"] = {"tools": active_tools}
                response = self.client.converse(**converse_kwargs)
                stop = response.get("stopReason")
                output_msg = response["output"]["message"]
                bedrock_messages.append(output_msg)

                if stop != "tool_use":
                    texts = [
                        c.get("text", "")
                        for c in output_msg.get("content", [])
                        if "text" in c
                    ]
                    reply = "\n".join(t for t in texts if t).strip() or (
                        "I couldn't form a grounded answer from the available tools."
                    )
                    logger.info(
                        "[Vicky-AI] model=%s stop=%s tools=%s latency_ms=%s",
                        self.model_id,
                        stop,
                        len(tool_trace),
                        int((time.time() - t0) * 1000),
                    )
                    return {
                        "reply": reply,
                        "provider": self.provider_name,
                        "model": self.model_id,
                        "model_display_name": self.display_name,
                        "is_fallback": False,
                        "sources": sources,
                        "toolCalls": tool_trace,
                        "actions": actions,
                        "timestamp": datetime.now(timezone.utc).isoformat().replace(
                            "+00:00", "Z"
                        ),
                    }

                # Execute tool uses
                tool_results_content = []
                for block in output_msg.get("content", []):
                    if "toolUse" not in block:
                        continue
                    tu = block["toolUse"]
                    name = tu["name"]
                    tool_input = tu.get("input") or {}
                    tool_use_id = tu["toolUseId"]
                    if name in ("get_fleet_status", "get_balloon") and not self.balloons_enabled:
                        result = {
                            "ok": False,
                            "error": "FLEET_TOOLS_DISABLED",
                            "message": "Balloon/fleet tools are disabled (BALLOONS_ENABLED=false).",
                        }
                    else:
                        result = await self._execute_tool(name, tool_input)
                    tool_trace.append(
                        {"name": name, "input": tool_input, "result": result}
                    )

                    if name == "search_location" and result.get("ok") and result.get("results"):
                        top = result["results"][0]
                        actions.append(
                            {
                                "type": "FLY_TO_LOCATION",
                                "latitude": top["latitude"],
                                "longitude": top["longitude"],
                                "name": top.get("name"),
                            }
                        )
                        sources.append(
                            {
                                "type": "geocoder",
                                "provider": result.get("provider"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                    elif name == "get_weather" and result.get("ok"):
                        sources.append(
                            {
                                "type": "weather",
                                "provider": result.get("provider"),
                                "isFallback": result.get("isFallback"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                    elif name == "get_fleet_status" and result.get("ok"):
                        sources.append(
                            {
                                "type": "fleet_telemetry",
                                "provider": result.get("provider", "WindBorne Treasure"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                    elif name == "get_balloon" and result.get("ok") and result.get("balloon"):
                        sources.append(
                            {
                                "type": "fleet_telemetry",
                                "provider": result.get("provider", "WindBorne Treasure"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                        actions.append(
                            {
                                "type": "SELECT_BALLOON",
                                "balloonId": result["balloon"]["id"],
                            }
                        )
                    elif name == "list_tropical_cyclones" and result.get("ok"):
                        sources.append(
                            {
                                "type": "tropical_cyclones",
                                "provider": result.get("provider"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                        strongest = result.get("strongest")
                        if strongest and strongest.get("tropical_cyclone_id"):
                            actions.append(
                                {
                                    "type": "SELECT_CYCLONE",
                                    "cycloneId": strongest["tropical_cyclone_id"],
                                }
                            )
                            actions.append(
                                {
                                    "type": "FLY_TO_CYCLONE",
                                    "cycloneId": strongest["tropical_cyclone_id"],
                                }
                            )
                    elif name in ("get_tropical_cyclone", "get_cyclone_forecast") and result.get("ok"):
                        sources.append(
                            {
                                "type": "tropical_cyclone",
                                "provider": result.get("provider"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )
                        cid = (
                            (result.get("cyclone") or {}).get("tropical_cyclone_id")
                            or result.get("cyclone_id")
                        )
                        if cid:
                            actions.append({"type": "SELECT_CYCLONE", "cycloneId": cid})
                            actions.append({"type": "FLY_TO_CYCLONE", "cycloneId": cid})
                        if name == "get_cyclone_forecast" and result.get("forecast_hour") is not None:
                            actions.append(
                                {
                                    "type": "SET_CYCLONE_FORECAST_HOUR",
                                    "hour": int(result["forecast_hour"]),
                                }
                            )
                    elif name == "get_gridded_forecast_summary" and result.get("ok"):
                        sources.append(
                            {
                                "type": "gridded_forecast",
                                "provider": result.get("provider"),
                                "variable": result.get("variable"),
                                "retrievedAt": result.get("retrievedAt"),
                            }
                        )

                    tool_results_content.append(
                        {
                            "toolResult": {
                                "toolUseId": tool_use_id,
                                "content": [{"json": result}],
                            }
                        }
                    )

                bedrock_messages.append({"role": "user", "content": tool_results_content})

            return self._unavailable_response("Tool loop exceeded without a final answer")
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {e}"
            logger.error("[Vicky-AI] Bedrock converse failed: %s", self.last_error)
            return self._unavailable_response(self.last_error)
