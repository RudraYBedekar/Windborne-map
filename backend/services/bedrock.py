import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger("bedrock_service")

class BedrockChatService:
    def __init__(self):
        self.region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION", "us-east-1")
        self.model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0")
        self.client = None
        self._init_client()

    def _init_client(self):
        try:
            import boto3
            from botocore.config import Config

            config = Config(
                region_name=self.region,
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=30
            )

            # Check if explicit keys exist in env, else let boto3 use EC2 IAM instance profile / credentials chain
            aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
            aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
            aws_session_token = os.getenv("AWS_SESSION_TOKEN")

            if aws_access_key and aws_secret_key:
                self.client = boto3.client(
                    "bedrock-runtime",
                    region_name=self.region,
                    aws_access_key_id=aws_access_key,
                    aws_secret_access_key=aws_secret_key,
                    aws_session_token=aws_session_token,
                    config=config
                )
            else:
                # Uses default credential chain (e.g., EC2 IAM Role, ~/.aws/credentials, or env)
                self.client = boto3.client("bedrock-runtime", region_name=self.region, config=config)
                
            logger.info(f"Bedrock client initialized for region {self.region} with model {self.model_id}")
        except Exception as e:
            logger.warning(f"Could not initialize AWS Bedrock client: {e}. Falling back to local intelligence mode.")
            self.client = None

    def get_status(self) -> Dict[str, Any]:
        has_aws_keys = bool(os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"))
        return {
            "bedrock_ready": self.client is not None,
            "region": self.region,
            "model_id": self.model_id,
            "auth_method": "Explicit API Keys" if has_aws_keys else "IAM Role / Default Credential Chain",
            "fallback_available": True
        }

    async def generate_response(
        self,
        messages: List[Dict[str, str]],
        fleet_context: Optional[Dict[str, Any]] = None,
        selected_balloon: Optional[Dict[str, Any]] = None,
        weather_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate response from Vicky-AI using Amazon Bedrock (Nemotron / Claude / Nova)
        or intelligent contextual fallback.
        """
        system_prompt = self._build_system_prompt(fleet_context, selected_balloon, weather_context)
        user_message = messages[-1].get("content", "") if messages else ""

        # 1. Attempt NVIDIA NIM / OpenAI-compatible endpoint if configured (e.g. self-hosted Nemotron on EC2)
        nim_url = os.getenv("NVIDIA_NIM_URL")
        if nim_url:
            try:
                import httpx
                headers = {"Content-Type": "application/json"}
                nim_api_key = os.getenv("NVIDIA_API_KEY")
                if nim_api_key:
                    headers["Authorization"] = f"Bearer {nim_api_key}"

                nim_messages = [{"role": "system", "content": system_prompt}]
                for m in messages:
                    nim_messages.append({"role": m.get("role", "user"), "content": m.get("content", "")})

                async with httpx.AsyncClient(timeout=30.0) as http_client:
                    res = await http_client.post(
                        f"{nim_url.rstrip('/')}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model": self.model_id or "nvidia/nemotron-nano-3-30b",
                            "messages": nim_messages,
                            "temperature": 0.4,
                            "max_tokens": 1024
                        }
                    )
                    if res.status_code == 200:
                        data = res.json()
                        reply = data["choices"][0]["message"]["content"]
                        return {
                            "reply": reply,
                            "provider": f"NVIDIA Nemotron ({self.model_id})",
                            "model": self.model_id,
                            "is_fallback": False,
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
            except Exception as e:
                logger.warning(f"NVIDIA NIM call failed: {e}")

        # 2. Attempt Bedrock invocation
        if self.client:
            try:
                # Use Converse API for modern multi-turn & multi-model support
                bedrock_messages = []
                for m in messages:
                    role = "user" if m.get("role") == "user" else "assistant"
                    bedrock_messages.append({
                        "role": role,
                        "content": [{"text": m.get("content", "")}]
                    })

                response = self.client.converse(
                    modelId=self.model_id,
                    messages=bedrock_messages,
                    system=[{"text": system_prompt}],
                    inferenceConfig={
                        "maxTokens": 1024,
                        "temperature": 0.4,
                        "topP": 0.9
                    }
                )

                output_text = response["output"]["message"]["content"][0]["text"]
                model_display = "NVIDIA Nemotron" if "nemotron" in self.model_id.lower() else self.model_id.split(':')[-2] if ':' in self.model_id else self.model_id
                return {
                    "reply": output_text,
                    "provider": f"Amazon Bedrock ({model_display})",
                    "model": self.model_id,
                    "is_fallback": False,
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
            except Exception as e:
                logger.error(f"Bedrock invocation failed with {self.model_id}: {e}. Utilizing contextual local intelligence.")

        # Fallback to rich contextual local engine
        reply = self._generate_local_reply(user_message, fleet_context, selected_balloon, weather_context)
        return {
            "reply": reply,
            "provider": f"Vicky-AI ({'Nemotron Nano' if 'nemotron' in self.model_id.lower() else 'Local Engine'})",
            "model": self.model_id or "nemotron-nano-3-30b-local",
            "is_fallback": True,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }


    def _build_system_prompt(
        self,
        fleet_context: Optional[Dict[str, Any]],
        selected_balloon: Optional[Dict[str, Any]],
        weather_context: Optional[Dict[str, Any]]
    ) -> str:
        prompt = (
            "You are Vicky-AI, the Lead AI Flight Operations Director and Stratospheric Meteorologist for the "
            "WindBorne Systems balloon tracking operations platform.\n"
            "You are precise, mission-focused, helpful, and highly knowledgeable about atmospheric physics, "
            "high-altitude soundings, WindBorne WeatherMesh AI models, and real-time balloon constellation dynamics.\n"
            "Keep answers concise, clear, and formatted nicely in GitHub Markdown with emojis, bullets, and stats where suitable.\n\n"
            "--- CURRENT MISSION CONTEXT ---\n"
        )

        if fleet_context:
            total = fleet_context.get("total_balloons", 0)
            high_alt = fleet_context.get("high_altitude_count", 0)
            avg_alt = fleet_context.get("avg_altitude_m", 0)
            highest = fleet_context.get("highest_balloon", {})
            fastest = fleet_context.get("fastest_balloon", {})
            prompt += (
                f"- Total Active Constellation Balloons: {total}\n"
                f"- High-Altitude Balloons (>=18,000m): {high_alt}\n"
                f"- Fleet Average Altitude: {avg_alt:.0f} meters\n"
            )
            if highest:
                prompt += f"- Highest Balloon: {highest.get('id')} at {highest.get('alt', 0):.0f}m ({highest.get('alt_ft', 0):.0f} ft)\n"
            if fastest:
                prompt += f"- Fastest Balloon: {fastest.get('id')} at {fastest.get('speed_kmh', 0):.1f} km/h\n"

        if selected_balloon:
            prompt += (
                f"\n--- CURRENTLY SELECTED BALLOON ---\n"
                f"- Balloon ID: {selected_balloon.get('id')}\n"
                f"- Coordinates: Lat {selected_balloon.get('lat')}, Lon {selected_balloon.get('lon')}\n"
                f"- Altitude: {selected_balloon.get('alt', 0):.0f}m ({selected_balloon.get('alt_ft', 0):.0f} ft)\n"
                f"- Speed: {selected_balloon.get('speed_kmh', 0):.1f} km/h\n"
                f"- Heading: {selected_balloon.get('heading', 'N/A')}\n"
                f"- Flight Duration: {selected_balloon.get('duration_hours', 'N/A')} hours\n"
            )

        if weather_context:
            prompt += (
                f"\n--- LOCAL WEATHERMESH DATA ---\n"
                f"- Provider: {weather_context.get('provider', 'WindBorne WeatherMesh')}\n"
                f"- Temperature: {weather_context.get('temperature', 'N/A')} °C\n"
                f"- Pressure MSL: {weather_context.get('pressure', 'N/A')} hPa\n"
                f"- Wind: {weather_context.get('windSpeed', 'N/A')} km/h at {weather_context.get('windDirection', 'N/A')}°\n"
                f"- Precipitation: {weather_context.get('precipitation', 0)} mm/h\n"
            )

        return prompt

    def _generate_local_reply(
        self,
        query: str,
        fleet_context: Optional[Dict[str, Any]],
        selected_balloon: Optional[Dict[str, Any]],
        weather_context: Optional[Dict[str, Any]]
    ) -> str:
        q = query.lower()

        # 1. Greetings
        if any(g in q for g in ["hello", "hi", "hey", "who are you", "what can you do"]):
            return (
                "👋 **Greetings! I am Vicky-AI**, your Lead Flight Operations & Meteorological Co-Pilot for the WindBorne balloon constellation.\n\n"
                "I monitor real-time stratospheric soundings, track fleet trajectories, analyze WindBorne WeatherMesh forecasts, and evaluate atmospheric conditions.\n\n"
                "Here are some quick inquiries you can ask me:\n"
                "- 📊 *\"Summarize the current fleet status\"*\n"
                "- 🚀 *\"Which balloon is flying at the highest altitude?\"*\n"
                "- 💨 *\"What are the fastest balloons in the air?\"*\n"
                "- 🌤️ *\"Explain the WeatherMesh atmospheric forecast\"*\n"
                "- 🎈 *\"Analyze the currently selected balloon\"*"
            )

        # 2. Selected Balloon Query
        if any(w in q for w in ["selected", "this balloon", "current balloon", "details", "selected balloon"]) and selected_balloon:
            b_id = selected_balloon.get("id", "Unknown")
            alt_m = selected_balloon.get("alt", 0)
            alt_ft = selected_balloon.get("alt_ft", alt_m * 3.28084)
            speed = selected_balloon.get("speed_kmh", 0)
            lat = selected_balloon.get("lat", 0)
            lon = selected_balloon.get("lon", 0)
            heading = selected_balloon.get("heading", "N/A")
            return (
                f"🎈 **Telemetry Analysis for Balloon `{b_id}`**\n\n"
                f"- **Altitude:** `{alt_m:,.0f} m` ({alt_ft:,.0f} ft) — {'✈️ Stratospheric (FL' + str(int(alt_ft/100)) + ')' if alt_m >= 12000 else 'Tropospheric'}\n"
                f"- **Ground Speed:** `{speed:.1f} km/h` ({speed * 0.539957:.1f} kts)\n"
                f"- **Heading / Bearing:** `{heading}`\n"
                f"- **Coordinates:** `{lat:.4f}°, {lon:.4f}°`\n"
                f"- **Telemetry Freshness:** Live within 24h constellation track\n\n"
                f"💡 *Tip: You can export this balloon's full 24h trajectory as **GPX** or **GeoJSON** in the Balloon Details panel.*"
            )

        # 3. Highest Balloon
        if any(w in q for w in ["highest", "max altitude", "top balloon", "ceiling"]):
            if fleet_context and "highest_balloon" in fleet_context:
                h = fleet_context["highest_balloon"]
                return (
                    f"🏔️ **Highest Balloon in the Constellation**\n\n"
                    f"The highest tracked balloon is **`{h.get('id')}`** cruising at an altitude of **`{h.get('alt', 0):,.0f} meters`** ({h.get('alt_ft', 0):,.0f} ft).\n\n"
                    f"- **Coordinates:** `{h.get('lat', 0):.3f}°, {h.get('lon', 0):.3f}°`\n"
                    f"- **Ground Speed:** `{h.get('speed_kmh', 0):.1f} km/h`\n"
                    f"- **Status:** Stratospheric sounding flight profile"
                )
            return "📡 Scanning constellation telemetry... Please ensure live fleet data is synced."

        # 4. Fastest Balloon
        if any(w in q for w in ["fastest", "top speed", "max speed", "wind speed"]):
            if fleet_context and "fastest_balloon" in fleet_context:
                f = fleet_context["fastest_balloon"]
                return (
                    f"⚡ **Fastest Balloon in the Constellation**\n\n"
                    f"The fastest moving balloon is **`{f.get('id')}`** traveling at **`{f.get('speed_kmh', 0):.1f} km/h`** ({f.get('speed_kmh', 0) * 0.539957:.1f} knots).\n\n"
                    f"- **Altitude:** `{f.get('alt', 0):,.0f} m` ({f.get('alt_ft', 0):,.0f} ft)\n"
                    f"- **Coordinates:** `{f.get('lat', 0):.3f}°, {f.get('lon', 0):.3f}°`\n"
                    f"- **Atmospheric Factor:** Propelled by stratospheric jetstream corridors."
                )

        # 5. Fleet Summary
        if any(w in q for w in ["fleet", "summary", "overview", "constellation", "how many", "all balloons"]):
            total = fleet_context.get("total_balloons", 0) if fleet_context else 0
            high_alt = fleet_context.get("high_altitude_count", 0) if fleet_context else 0
            avg_alt = fleet_context.get("avg_altitude_m", 0) if fleet_context else 0
            return (
                f"🌐 **WindBorne Constellation Fleet Summary**\n\n"
                f"- **Total Active Balloons:** `{total}`\n"
                f"- **High-Altitude Craft ($\ge$18,000m):** `{high_alt}`\n"
                f"- **Average Fleet Altitude:** `{avg_alt:,.0f} m` ({avg_alt * 3.28084:,.0f} ft)\n"
                f"- **Data Ingestion:** 24-hour continuous rolling telemetry (`00.json`–`23.json`)\n"
                f"- **Atmospheric Model:** WindBorne WeatherMesh AI Weather Model\n\n"
                f"You can use the **Timeline Scrubber** at the bottom to scrub 24 hours back in time, or select any balloon on the 3D globe for micro-diagnostics."
            )

        # 6. Weather & WeatherMesh
        if any(w in q for w in ["weather", "forecast", "weathermesh", "temperature", "pressure", "radar"]):
            if weather_context:
                temp = weather_context.get("temperature", "N/A")
                pressure = weather_context.get("pressure", "N/A")
                wind_spd = weather_context.get("windSpeed", "N/A")
                wind_dir = weather_context.get("windDirection", "N/A")
                provider = weather_context.get("provider", "WindBorne WeatherMesh")
                precip = weather_context.get("precipitation", 0)
                temp_f_str = f"({float(temp)*9/5+32:.1f}°F)" if isinstance(temp, (int, float)) else ""
                return (
                    f"🌤️ **Active Atmospheric Weather Assessment**\n\n"
                    f"- **Provider:** `{provider}`\n"
                    f"- **Temperature:** `{temp} °C` {temp_f_str}\n"
                    f"- **Sea-Level Pressure:** `{pressure} hPa`\n"
                    f"- **Surface/Flight Wind:** `{wind_spd} km/h` heading `{wind_dir}°`\n"
                    f"- **Precipitation Rate:** `{precip} mm/h`\n\n"
                    f"💨 *WeatherMesh AI leverages stratospheric planetary sounding data to deliver higher-precision atmospheric models than conventional GFS grids.*"
                )
            return (
                "🌤️ **WindBorne WeatherMesh Engine**\n\n"
                "WindBorne WeatherMesh is an advanced AI-powered numerical weather prediction model trained on dense stratospheric balloon soundings.\n\n"
                "Click on any city via the search bar or select an active balloon marker to pull live point forecasts."
            )


        # 7. Bedrock / AWS Deployment
        if any(w in q for w in ["bedrock", "aws", "ec2", "deploy", "setup"]):
            return (
                "☁️ **Amazon Bedrock & EC2 Deployment**\n\n"
                "I can run directly on **Amazon Bedrock** (Anthropic Claude 3.5 Sonnet, Claude 3 Haiku, or Amazon Nova) deployed on AWS EC2!\n\n"
                "Check out the newly generated **`AWS_BEDROCK_EC2_GUIDE.md`** in the project root for complete setup instructions:\n"
                "1. Enable Bedrock Foundation Models in AWS Console.\n"
                "2. Attach IAM Role with Bedrock invoke policies to your EC2 instance.\n"
                "3. Launch FastAPI backend + Next.js frontend with Nginx & PM2."
            )

        # Default Helpful Response
        return (
            f"🤖 **Vicky-AI Mission Intelligence Received:** *\"{query}\"*\n\n"
            f"Based on our active 3D constellation monitoring:\n"
            f"- We have `{fleet_context.get('total_balloons', 0) if fleet_context else 'active'}` balloons transmitting real-time telemetry.\n"
            f"- All flight trajectories are validated against NOAA solar terminator calculations.\n\n"
            f"Feel free to ask me to analyze any specific balloon, examine WeatherMesh forecasts, or explore flight routes!"
        )
