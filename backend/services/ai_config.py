"""
Single source of truth for Vicky-AI provider / model branding.
All UI and API responses must read from get_ai_config() — never hardcode model names.
"""
from __future__ import annotations

import os
from typing import Any, Dict


def _first_env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def friendly_model_name(model_id: str) -> str:
    mid = (model_id or "").lower()
    if "haiku-4-5" in mid or "claude-haiku-4" in mid:
        return "Claude Haiku 4.5"
    if "claude-3-5-sonnet" in mid or "claude-3.5-sonnet" in mid:
        return "Claude 3.5 Sonnet"
    if "claude-3-haiku" in mid:
        return "Claude 3 Haiku"
    if "claude-3-sonnet" in mid:
        return "Claude 3 Sonnet"
    if "nova-2-lite" in mid:
        return "Amazon Nova 2 Lite"
    if "nova-micro" in mid:
        return "Amazon Nova Micro"
    if "nova-lite" in mid:
        return "Amazon Nova Lite"
    if "nova-pro" in mid:
        return "Amazon Nova Pro"
    if "titan-embed" in mid:
        return "Amazon Titan Embeddings"
    # Never surface legacy NVIDIA branding
    if "nemotron" in mid or "nvidia" in mid:
        return "Amazon Bedrock (reconfigure model — legacy Nemotron ID detected)"
    # Truncate raw IDs for display
    short = model_id.split("/")[-1]
    if len(short) > 42:
        short = short[:39] + "..."
    return short or "Amazon Bedrock"


def get_ai_config() -> Dict[str, Any]:
    """
    Canonical AI configuration used by Bedrock service, status endpoints, and UI.
    Prefer BEDROCK_AGENT_MODEL (matches current .env), then LLM / MODEL_ID.
    """
    enabled = _first_env("BEDROCK_ENABLED", default="true").lower() in ("true", "1", "yes")
    region = _first_env("AWS_REGION", "AWS_DEFAULT_REGION", default="us-east-1")
    model_id = _first_env(
        "BEDROCK_AGENT_MODEL",
        "BEDROCK_LLM_MODEL",
        "BEDROCK_MODEL_ID",
        default="us.anthropic.claude-haiku-4-5-20251001-v1:0",
    )
    # Strip legacy NVIDIA defaults if someone left them in env
    if "nemotron" in model_id.lower() or model_id.lower().startswith("nvidia"):
        model_id = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    display = _first_env("AI_MODEL_DISPLAY_NAME") or friendly_model_name(model_id)
    provider = _first_env("AI_PROVIDER", default="Amazon Bedrock")
    embed_model = _first_env("BEDROCK_EMBED_MODEL", default="")

    return {
        "AI_PROVIDER": provider,
        "AI_MODEL": model_id,
        "AI_MODEL_DISPLAY_NAME": display,
        "BEDROCK_ENABLED": enabled,
        "AWS_REGION": region,
        "BEDROCK_EMBED_MODEL": embed_model or None,
        # Balloons hidden from UI — Treasure feed not operationally accurate
        "BALLOONS_ENABLED": _first_env("BALLOONS_ENABLED", default="false").lower()
        in ("true", "1", "yes"),
    }
