from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import time
import os
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from services.windborne import WindBorneClient

try:
    from dotenv import load_dotenv
    base_dir = Path(__file__).resolve().parent
    load_dotenv(base_dir / ".env")
    load_dotenv(base_dir.parent / ".env")
except ImportError:
    pass

def load_env_files():
    base_dir = Path(__file__).resolve().parent
    env_paths = [
        base_dir / ".env",
        base_dir / ".env.local",
        base_dir.parent / ".env",
        base_dir.parent / ".env.local",
    ]
    for path in env_paths:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and not os.getenv(k):
                            os.environ[k] = v

load_env_files()

app = FastAPI(title="Windborne API Service")
wb_client = WindBorneClient()

WINDBORNE_TOKEN = os.getenv("WB_API_KEY") or os.getenv("WINDBORNE_TOKEN") or os.getenv("WINDBORNE_API_KEY")

allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COLORS = [
    '#00ffea', '#ff0055', '#ccff00', '#bf00ff', '#00ccff', '#ffaa00'
]

class BalloonPoint(BaseModel):
    lat: float
    lon: float
    alt: float
    time: int

class Balloon(BaseModel):
    id: str
    path: List[BalloonPoint]
    color: str

@app.get("/")
@app.get("/health")
def read_root():
    return {
        "status": "online",
        "service": "Windborne FastAPI Ingestion Engine",
        "version": "2.0.0",
        "has_wb_key": bool(WINDBORNE_TOKEN)
    }

@app.get("/debug/v1/auth_status")
@app.get("/api/weather/auth-status")
async def get_auth_status():
    """Debug / Auth check endpoint for WindBorne API key status."""
    return await wb_client.check_auth()

@app.get("/api/weather")
async def get_weather(lat: float, lon: float):
    """
    Fetch weather forecast for given coordinates using WindBorne WeatherMesh.
    Validates lat (-90 to 90) and lon (-180 to 180).
    """
    if not (-90.0 <= lat <= 90.0):
        raise HTTPException(
            status_code=400,
            detail="Latitude must be between -90 and 90 degrees."
        )
    if not (-180.0 <= lon <= 180.0):
        raise HTTPException(
            status_code=400,
            detail="Longitude must be between -180 and 180 degrees."
        )

    result = await wb_client.get_forecast(lat, lon)
    
    if isinstance(result, dict) and "error" in result:
        status_code = result.get("status_code", 500)
        if status_code == 429:
            raise HTTPException(
                status_code=429,
                detail=result.get("message", "Weather data request limit reached. Please try again shortly.")
            )
        elif status_code in (401, 403):
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "Invalid or missing WindBorne API key.")
            )
        elif status_code in (500, 503, 504):
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "WindBorne weather data is temporarily unavailable.")
            )

    return result


async def fetch_url(client: httpx.AsyncClient, url: str) -> Optional[Any]:
    try:
        headers = {}
        if WINDBORNE_TOKEN:
            headers["Authorization"] = f"Bearer {WINDBORNE_TOKEN}"
        resp = await client.get(url, headers=headers, timeout=10.0)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return None


@app.get("/windborne")
async def get_windborne_data():
    hours = list(range(24))
    urls = [f"https://a.windbornesystems.com/treasure/{str(h).zfill(2)}.json" for h in hours]
    
    async with httpx.AsyncClient() as client:
        tasks = [fetch_url(client, url) for url in urls]
        fetched_data = await asyncio.gather(*tasks)
    
    balloons: Dict[str, Dict[str, Any]] = {}
    now = int(time.time() * 1000) # milliseconds
    
    for hour_index, hour_data in enumerate(fetched_data):
        if not hour_data or not isinstance(hour_data, list):
            continue
            
        # 00.json = Current, ..., 23.json = 23 hours ago
        # Actually based on observation logic in previous TS file:
        # hourIndex matches the file number (0 to 23)
        hours_ago = hour_index
        timestamp = now - (hours_ago * 60 * 60 * 1000)
        
        for balloon_index, point in enumerate(hour_data):
            if not isinstance(point, list) or len(point) < 3:
                continue
                
            lat, lon, alt = point[0], point[1], point[2]
            
            # Validation
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            
            # Handle alt
            valid_alt = alt if isinstance(alt, (int, float)) else 0.0
            
            balloon_id = f"WB-{balloon_index + 1}"
            
            if balloon_id not in balloons:
                balloons[balloon_id] = {
                    "id": balloon_id,
                    "path": [],
                    "color": COLORS[balloon_index % len(COLORS)]
                }
            
            balloons[balloon_id]["path"].append({
                "lat": lat,
                "lon": lon,
                "alt": valid_alt,
                "time": timestamp
            })
    
    # Sort paths by time and filter empty
    results = []
    for b in balloons.values():
        b["path"].sort(key=lambda x: x["time"])
        if b["path"]:
            results.append(b)
            
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
