# WindBorne API Check Commands

Use this file to verify that the official WindBorne WeatherMesh forecast API and our local app are working.

**Never paste your API key into git, chat, or logs.**  
Put it only in `backend/.env`.

---

## 0. One-time setup

### Backend env

```powershell
cd backend
copy .env.example .env
notepad .env
```

Set:

```env
WB_API_KEY=your_real_key_here
WINDBORNE_BASE_URL=https://api.windbornesystems.com
```

### Install + start both servers

**Terminal 1 — FastAPI**

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Next.js**

```powershell
cd C:\Users\rudra\OneDrive\Desktop\githubproject\windbrone
npm install
# To clear Next.js crash locks (if unable to acquire lock)
Remove-Item -Path .next\dev\lock -Force -ErrorAction SilentlyContinue
# Start dev server (defaults to port 3000)
npm run dev
```

### Port 3000 Troubleshooting

If port 3000 is in use:
1. **Find what process is using port 3000**:
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, State, OwningProcess
   ```
2. **Kill the process** (replace `<PID>` with the `OwningProcess` ID from above):
   ```powershell
   Stop-Process -Id <PID> -Force
   ```
3. **Alternatively, run on a custom port**:
   ```powershell
   npx next dev -p 3003
   ```

Expected:

| Service | URL |
|---|---|
| FastAPI | http://127.0.0.1:8000 |
| Next.js | http://localhost:3000 |

---

## 1. Check FastAPI is up

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

or:

```powershell
curl.exe http://127.0.0.1:8000/health
```

**Pass:** `"status": "online"` and `"has_wb_key": true`

---

## 2. Check WindBorne API key auth

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/weather/auth-status
```

or:

```powershell
curl.exe http://127.0.0.1:8000/debug/v1/auth_status
```

**Pass:** `"authenticated": true`  
**Fail:** 401/403 or `"authenticated": false` → check `WB_API_KEY` in `backend/.env`

---

## 3. Call the official WindBorne endpoint directly

This is the only forecast endpoint we use:

```text
https://api.windbornesystems.com/forecasts/v1/mm/point_forecast?coordinates=<lat>,<lon>
```

### PowerShell

```powershell
$envFile = Get-Content backend\.env
$key = ($envFile | Where-Object { $_ -match '^WB_API_KEY=' }) -replace '^WB_API_KEY=',''
$headers = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$uri = "https://api.windbornesystems.com/forecasts/v1/mm/point_forecast?coordinates=38.84,-77.30"
$r = Invoke-WebRequest -Uri $uri -Headers $headers -TimeoutSec 30
Write-Host "HTTP status:" $r.StatusCode
$r.Content.Substring(0, [Math]::Min(500, $r.Content.Length))
```

### curl (Windows)

```powershell
curl.exe -s -D - -o wb_forecast.json -H "Authorization: Bearer YOUR_KEY" -H "Accept: application/json" "https://api.windbornesystems.com/forecasts/v1/mm/point_forecast?coordinates=38.84,-77.30"
```

Replace `YOUR_KEY` locally. Do not commit that command with a real key.

**Pass:** HTTP `200` and JSON like:

```json
{
  "forecast_zero": "2026-08-13T12:00:00Z",
  "initialization_time": "2026-08-13T12:00:00Z",
  "forecasts": [ [ { "time": "...", "temperature_2m": 32.18, "pressure_msl": 1012.09, "wind_speed_10m": 2.02 } ] ]
}
```

Hourly record fields we use:

```text
latitude
longitude
time
temperature_2m
dewpoint_2m
pressure_msl
precipitation
wind_speed_10m
wind_speed_100m
wind_u_10m
wind_v_10m
wind_u_100m
wind_v_100m
```

---

## 4. Check FastAPI weather proxy (this is what the website uses)

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/weather?lat=38.84&lon=-77.30"
```

Pretty print:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/weather?lat=38.84&lon=-77.30" | ConvertTo-Json -Depth 6
```

curl:

```powershell
curl.exe "http://127.0.0.1:8000/api/weather?lat=38.84&lon=-77.30"
```

**Pass — WindBorne is working:**

```json
{
  "provider": "WindBorne WeatherMesh",
  "model": "WeatherMesh",
  "forecastTime": "2026-08-13T21:00:00Z",
  "current": {
    "temperature": 32.2,
    "pressure": 1012.1,
    "windSpeed": 2.0
  }
}
```

**Fail — fallback kicked in:**

```json
{
  "provider": "Open-Meteo (Fallback)",
  "model": "open-meteo-v1"
}
```

If you see Open-Meteo, read the FastAPI terminal. You should see why:

```text
[WindBorne] coordinates=38.84,-77.3
[WindBorne] status=...
[WindBorne] error=...
[WindBorne] activating Open-Meteo fallback
```

---

## 5. Check Next.js `/api/weather` (browser path)

```powershell
Invoke-RestMethod "http://localhost:3000/api/weather?lat=38.84&lon=-77.30" | ConvertTo-Json -Depth 6
```

```powershell
curl.exe "http://localhost:3000/api/weather?lat=38.84&lon=-77.30"
```

**Pass:** same payload as FastAPI, `"provider": "WindBorne WeatherMesh"`

---

## 6. Check balloon telemetry

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/windborne" | Select-Object -First 1
```

```powershell
curl.exe "http://127.0.0.1:8000/windborne"
```

```powershell
curl.exe "http://localhost:3000/api/windborne"
```

**Pass:** JSON array of balloons with `id`, `path`, `color`

---

## 7. Check Next.js → FastAPI health

```powershell
Invoke-RestMethod "http://localhost:3000/api/health"
```

**Pass:** `"status": "ONLINE"`

---

## 8. Check in the website UI

1. Open http://localhost:3000
2. Search a city or click a balloon
3. Weather card should show **WindBorne WeatherMesh** (not Open-Meteo)
4. Layers panel (bottom-right): Earth / Hybrid / Radar still work

---

## 9. Python one-shot test (no servers)

From the `backend` folder:

```powershell
cd backend
python -c "import asyncio, json; from services.windborne import WindBorneClient
async def main():
    c = WindBorneClient()
    print('has_key', bool(c.api_key))
    r = await c.get_forecast(38.84, -77.30)
    print(json.dumps(r, indent=2))
asyncio.run(main())"
```

**Pass:** `"provider": "WindBorne WeatherMesh"`

---

## Success checklist

Copy this after a successful run:

```text
Endpoint used: https://api.windbornesystems.com/forecasts/v1/mm/point_forecast
HTTP status: 200
Provider returned: WindBorne WeatherMesh
Forecast timestamp: (from forecastTime)
Temperature: (from current.temperature)
Pressure: (from current.pressure)
Wind speed: (from current.windSpeed)
Fallback used: NO
```

Last verified locally (2026-08-13):

```text
Endpoint used: https://api.windbornesystems.com/forecasts/v1/mm/point_forecast?coordinates=38.84,-77.3
HTTP status: 200
Provider returned: WindBorne WeatherMesh
Forecast timestamp: 2026-08-13T21:00:00Z
Temperature: 32.2
Pressure: 1012.1
Wind speed: 2.0
Fallback used: NO
```
