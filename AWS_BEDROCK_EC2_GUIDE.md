# AWS EC2 + Amazon Bedrock (Vicky-AI)

Short guide to run WindBorne Weather & Mission Globe on EC2 with Bedrock via an IAM instance role (no long-lived access keys).

## 1. Bedrock model access

1. In the AWS Console, open **Amazon Bedrock → Model access** in your region (e.g. `us-east-1`).
2. Enable **Anthropic Claude Haiku 4.5** (or your chosen inference profile ID).
3. Note the model / inference profile ID for `BEDROCK_AGENT_MODEL`.

## 2. IAM role for the EC2 instance

Create an instance role with a policy that allows at least:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:Converse",
        "bedrock:ConverseStream"
      ],
      "Resource": "*"
    }
  ]
}
```

Attach the role to the EC2 instance. Leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` empty in `backend/.env`.

## 3. Security group

Open inbound:

| Port | Purpose |
|------|---------|
| 22 | SSH |
| 3000 | Next.js web UI |
| 8000 | FastAPI (or only via localhost if you put Nginx in front) |

Prefer locking sources to your IP or putting Nginx + TLS on 80/443.

## 4. App install (Ubuntu)

```bash
sudo apt update
sudo apt install -y git python3-venv python3-pip nodejs npm
# Node 20+ recommended (nodesource or nvm)

git clone https://github.com/RudraYBedekar/Windborne-map.git
cd Windborne-map

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: WB_API_KEY, AWS_REGION, BEDROCK_AGENT_MODEL, ALLOWED_ORIGINS, optional API_KEY

# Frontend
cd ..
cp .env.example .env.local
# Set NEXT_PUBLIC_OPENWEATHER_ENABLED=true if using backend OPENWEATHER_KEY
# Set FASTAPI_BACKEND_URL=http://127.0.0.1:8000 for Next API proxies
npm install
npm run build
```

## 5. Process manager (PM2)

```bash
npm install -g pm2
# API
cd backend && source venv/bin/activate
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name windborne-api
# Web
cd .. && pm2 start "npm run start" --name windborne-web
pm2 save
```

## 6. Environment checklist

```env
# backend/.env
WB_API_KEY=...
AWS_REGION=us-east-1
BEDROCK_AGENT_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
ALLOWED_ORIGINS=http://YOUR_EC2_IP:3000,http://localhost:3000
CHAT_RPM_LIMIT=10
API_KEY=           # optional; if set, require X-API-Key on /api/chat
OPENWEATHER_KEY=
OPENWEATHER_RPM_LIMIT=50
BALLOONS_ENABLED=false
```

```env
# .env.local
FASTAPI_BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SHOW_BALLOONS=false
NEXT_PUBLIC_OPENWEATHER_ENABLED=true
```

## 7. Verify

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/api/chat/status
curl -s "http://127.0.0.1:8000/api/weather?lat=38.85&lon=-77.31"
```

Open `http://YOUR_EC2_IP:3000` and confirm Vicky-AI answers without inventing fleet data when balloons are disabled.
