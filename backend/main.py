from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import time
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

app = FastAPI()

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend
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
def read_root():
    return {"status": "Windborne Python Backend Running"}

async def fetch_url(client: httpx.AsyncClient, url: str) -> Optional[Any]:
    try:
        resp = await client.get(url, timeout=10.0)
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
