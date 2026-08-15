"""
Grounding tests for Vicky-AI — run from backend/:
  python -m pytest tests/test_grounding.py -q
or:
  python tests/test_grounding.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Ensure no legacy NVIDIA default leaks
os.environ.pop("NVIDIA_NIM_URL", None)
os.environ["BEDROCK_ENABLED"] = "true"
os.environ["BEDROCK_AGENT_MODEL"] = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
os.environ["BALLOONS_ENABLED"] = "false"

from services.ai_config import get_ai_config, friendly_model_name
from services import ai_tools
from services.bedrock import BedrockChatService, SYSTEM_PROMPT


def test_no_nemotron_in_config():
    cfg = get_ai_config()
    assert "nemotron" not in cfg["AI_MODEL"].lower()
    assert "nvidia" not in cfg["AI_MODEL"].lower()
    assert cfg["AI_PROVIDER"] == "Amazon Bedrock"
    assert "Nemotron" not in cfg["AI_MODEL_DISPLAY_NAME"]
    assert cfg["BALLOONS_ENABLED"] is False


def test_legacy_nemotron_env_is_replaced():
    os.environ["BEDROCK_AGENT_MODEL"] = "nvidia/nemotron-nano-3-30b"
    cfg = get_ai_config()
    assert "nemotron" not in cfg["AI_MODEL"].lower()
    os.environ["BEDROCK_AGENT_MODEL"] = "us.anthropic.claude-haiku-4-5-20251001-v1:0"


def test_system_prompt_forbids_invention():
    assert "NO independent knowledge" in SYSTEM_PROMPT
    assert "Never estimate" in SYSTEM_PROMPT
    assert "1000 balloons" not in SYSTEM_PROMPT or "Never" in SYSTEM_PROMPT


def test_fleet_stats_deterministic():
    balloons = [
        {
            "id": "WB-1",
            "path": [
                {"lat": 1, "lon": 1, "alt": 12000, "time": 1},
                {"lat": 1.1, "lon": 1.1, "alt": 12500, "time": 3_600_000},
            ],
        },
        {
            "id": "WB-2",
            "path": [{"lat": 2, "lon": 2, "alt": 19000, "time": 1}],
        },
    ]
    stats = ai_tools.compute_fleet_stats(balloons)
    assert stats["ok"] is True
    assert stats["total"] == 2
    assert stats["highAltitude"] == 1
    assert stats["highest"]["id"] == "WB-2"
    assert stats["dataQuality"] == "unverified_public_feed"


def test_bare_location_heuristic():
    assert ai_tools.look_like_bare_location("fairfax") is True
    assert ai_tools.look_like_bare_location("Tokyo") is True
    assert ai_tools.look_like_bare_location("how many balloons are active?") is False
    # Place + weather should route to geocode (not invent coords in Bedrock)
    assert ai_tools.look_like_bare_location("weather in fairfax") is True
    assert ai_tools.look_like_place_weather_query(
        "redwood city california usa check weather"
    )
    assert ai_tools.look_like_bare_location("What is a solar terminator?") is False
    assert ai_tools.look_like_bare_location("cyclones list") is False
    assert ai_tools.look_like_bare_location("active hurricanes") is False
    assert ai_tools.look_like_cyclone_query("cyclones list") is True
    assert ai_tools.look_like_cyclone_query("Where are the tropical cyclones?") is True
    assert ai_tools.look_like_cyclone_query("fairfax") is False


def test_bedrock_unavailable_does_not_invent_fleet():
    svc = BedrockChatService(weather_client=None, telemetry_loader=None)
    svc.client = None
    svc.enabled = True
    svc.last_error = "test"
    # Prevent re-init from picking up real AWS creds during unit test
    svc._init_client = lambda: None  # type: ignore

    async def run():
        out = await svc.generate_response(
            [{"role": "user", "content": "How many balloons are active?"}]
        )
        assert out.get("ai_unavailable") is True
        assert "1000" not in out["reply"]
        assert "AI service unavailable" in out["reply"]
        assert out.get("is_fallback") is False

    asyncio.run(run())


def test_friendly_names():
    assert "Haiku" in friendly_model_name("us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert "Nova" in friendly_model_name("us.amazon.nova-2-lite-v1:0")


def test_tools_for_config_disabled_by_default():
    tools = ai_tools.tools_for_config(False)
    assert all(t["toolSpec"]["name"] not in ("get_fleet_status", "get_balloon") for t in tools)


if __name__ == "__main__":
    tests = [
        test_no_nemotron_in_config,
        test_legacy_nemotron_env_is_replaced,
        test_system_prompt_forbids_invention,
        test_fleet_stats_deterministic,
        test_bare_location_heuristic,
        test_bedrock_unavailable_does_not_invent_fleet,
        test_friendly_names,
        test_tools_for_config_disabled_by_default,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    if failed:
        raise SystemExit(1)
    print(f"\n{len(tests)} tests passed")
