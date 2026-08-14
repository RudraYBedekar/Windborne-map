# Vicky-AI Grounding & Branding Fix Report

## A. Root-cause report

### Why the wrong model name was showing
1. **`VickyChat.tsx` hardcoded** the welcome message and provider as `NVIDIA Nemotron Nano 3 30B`.
2. **`backend/.env.example` defaulted** `BEDROCK_MODEL_ID=nvidia/nemotron-nano-3-30b`.
3. **`bedrock.py` still preferred NVIDIA NIM** (`NVIDIA_NIM_URL`) and labeled responses `NVIDIA Nemotron (...)`.
4. UI badges did **not** read `/api/chat/status` — branding was duplicated in the frontend.

### Why "Local Fallback" appeared
1. When Bedrock failed (missing keys, wrong model ID, IAM, etc.), `BedrockChatService._generate_local_reply()` ran a **keyword script**.
2. That path returned `provider: "Vicky-AI (Local Engine)"` and `is_fallback: true`.
3. `VickyChat` rendered the amber **Local Fallback** badge whenever `isFallback` was true.
4. Separately, `src/app/api/chat/route.ts` had its **own Next.js rule-based fallback** inventing fleet answers if FastAPI was down.

### Why the chatbot generated inaccurate facts
1. The **default local reply** for unknown queries contained canned text:
   - “We have `{N}` balloons transmitting real-time telemetry.”
   - “All flight trajectories are validated against NOAA solar terminator calculations.”
2. If `fleet_context` was missing, it still sounded authoritative (`active` / demo narrative).
3. Bedrock (when connected) received a system prompt that **encouraged mission theater** without a hard “tools only for ops facts” rule — so the LLM could invent.
4. Bare queries like **`fairfax`** were treated as general chat → dumped fleet chatter instead of geocoding.

### Which APIs were not used correctly
| Need | Existing API | Before | After |
|---|---|---|---|
| Weather | `/api/weather` + WeatherMesh | Often unused by chat; local prose invented weather | `get_weather` tool |
| Location | Nominatim (frontend only) | Chat ignored geocoder | `search_location` + bare-name router |
| Fleet | `/windborne` Treasure | Counts came from UI props / LLM imagination | `get_fleet_status` / `get_balloon` (deterministic) |
| Model status | `/api/chat/status` | Unused by UI | Powers Vicky badge |

### Balloons removed from website
Treasure public feed (`a.windbornesystems.com/treasure/{00-23}.json`) indexes points by array position (`WB-1`…), not certified mission IDs. Markers are **hidden by default** (`NEXT_PUBLIC_SHOW_BALLOONS=false`, `BALLOONS_ENABLED=false`).

---

## B. Files changed

| File | Why |
|---|---|
| `backend/services/ai_config.py` | **New** single source of truth for provider/model/display/balloons flag |
| `backend/services/ai_tools.py` | **New** geocode/weather/fleet tools + Bedrock tool schemas |
| `backend/services/bedrock.py` | **Rewritten** grounded Converse+tools; removed Nemotron/NIM; removed inventing local engine |
| `backend/main.py` | Wire weather + telemetry loader into Bedrock; shared Treasure loader |
| `backend/.env.example` | Claude Haiku / Nova defaults; no Nemotron |
| `backend/tests/test_grounding.py` | **New** grounding / branding tests |
| `src/app/api/chat/route.ts` | No inventing fallback; GET status proxy |
| `src/components/VickyChat.tsx` | Dynamic model badge; provenance footer; no Nemotron welcome |
| `src/app/page.tsx` | Hide balloons; AI `FLY_TO_LOCATION` actions |
| `.env.example` | `NEXT_PUBLIC_SHOW_BALLOONS=false` |
| `VICKY_AI_GROUNDING_REPORT.md` | This report |

---

## C. Final architecture

```text
User
 ↓
Vicky-AI (VickyChat.tsx)
 ↓
Next.js /api/chat
 ↓
FastAPI /api/chat
 ↓
Amazon Bedrock Converse (AI_MODEL from ai_config)
 ↓
Tool selection (or deterministic LOCATION_SEARCH for bare place names)
 ↓
Application tools
 ├── search_location → Nominatim
 ├── get_weather → WeatherMesh → Open-Meteo fallback (labeled)
 ├── get_fleet_status / get_balloon → Treasure telemetry (math in Python)
 ↓
Structured tool result
 ↓
Bedrock explanation (numbers unchanged)
 ↓
Validated UI actions (FLY_TO_LOCATION, …)
 ↓
UI + provenance footer
```

**Principle:** The LLM explains the data. The application provides the truth.

If Bedrock is down → **AI unavailable** message. No fake mission intelligence.

---

## D. Verification

### Unit tests (`backend/tests/test_grounding.py`)
- No Nemotron in config
- Legacy Nemotron env IDs replaced
- System prompt forbids invention
- Fleet stats are deterministic
- `fairfax` classified as location
- Bedrock-down path does not invent “1000 balloons”

### Manual checks
```powershell
# Model branding
Invoke-RestMethod http://127.0.0.1:8000/api/chat/status | ConvertTo-Json

# Expect AI_PROVIDER=Amazon Bedrock, AI_MODEL_DISPLAY_NAME like Claude Haiku 4.5
# Expect no Nemotron

# Location grounding
$body = @{ messages = @(@{ role = "user"; content = "fairfax" }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/chat -ContentType "application/json" -Body $body
# Expect location resolve + weather/options — NOT fleet rant
```

### Remaining intentional mentions of “Nemotron”
Only in guards/comments/tests that **reject** legacy IDs — not user-facing branding.

### Re-enable balloons later (optional)
```env
# backend/.env
BALLOONS_ENABLED=true

# frontend .env.local
NEXT_PUBLIC_SHOW_BALLOONS=true
```
