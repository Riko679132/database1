"""配置与密钥：config.yaml（项目基础配置）+ config.local.yaml（本地密钥，已 gitignore）。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
BASE_CFG = ROOT / "config.yaml"
LOCAL_CFG = ROOT / "config.local.yaml"

AI_DEFAULTS: dict[str, Any] = {
    "provider": "deepseek",
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "",
    "model": "deepseek-chat",
}

PROVIDERS = [
    {"id": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1"},
    {"id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1"},
    {
        "id": "dashscope",
        "name": "通义千问（DashScope 兼容）",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {"id": "moonshot", "name": "Kimi（Moonshot）", "base_url": "https://api.moonshot.cn/v1"},
    {"id": "zhipu", "name": "智谱 GLM", "base_url": "https://open.bigmodel.cn/api/paas/v4"},
    {"id": "custom", "name": "自定义（OpenAI 兼容）", "base_url": ""},
]


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        elif value is not None:
            out[key] = value
    return out


def merged() -> dict:
    return _merge(_read(BASE_CFG), _read(LOCAL_CFG))


def ai_config() -> dict:
    cfg = dict(AI_DEFAULTS)
    cfg.update({k: v for k, v in (merged().get("ai") or {}).items() if v is not None})
    cfg["base_url"] = str(cfg.get("base_url") or AI_DEFAULTS["base_url"]).rstrip("/")
    return cfg


def elsevier_key() -> str:
    return str((merged().get("elsevier") or {}).get("api_key") or "").strip()


def unpaywall_email() -> str:
    return str((merged().get("unpaywall") or {}).get("email") or "").strip()


def mask(secret: str) -> str:
    if not secret:
        return ""
    return f"…{secret[-4:]}" if len(secret) >= 8 else "已配置"


def public() -> dict:
    ai = ai_config()
    return {
        "ai": {
            "provider": ai["provider"],
            "base_url": ai["base_url"],
            "model": ai["model"],
            "api_key_mask": mask(ai["api_key"]),
            "api_key_set": bool(ai["api_key"]),
        },
        "elsevier": {
            "api_key_mask": mask(elsevier_key()),
            "api_key_set": bool(elsevier_key()),
        },
        "unpaywall": {
            "email": unpaywall_email(),
            "email_set": bool(unpaywall_email()),
        },
        "providers": PROVIDERS,
        "local_config": LOCAL_CFG.name,
    }


def save(payload: dict) -> dict:
    """只更新白名单字段；空字符串表示"保持不变"，显式清除用 null。"""
    local = _read(LOCAL_CFG)
    local.setdefault("ai", {})
    local.setdefault("elsevier", {})
    local.setdefault("unpaywall", {})

    ai = payload.get("ai") or {}
    if ai.get("provider"):
        local["ai"]["provider"] = str(ai["provider"])
    if ai.get("base_url"):
        local["ai"]["base_url"] = str(ai["base_url"]).rstrip("/")
    if ai.get("model"):
        local["ai"]["model"] = str(ai["model"])
    if ai.get("api_key"):
        local["ai"]["api_key"] = str(ai["api_key"]).strip()

    els = payload.get("elsevier") or {}
    if els.get("api_key"):
        local["elsevier"]["api_key"] = str(els["api_key"]).strip()

    up = payload.get("unpaywall") or {}
    if "email" in up and up["email"] is not None:
        local["unpaywall"]["email"] = str(up["email"]).strip()

    LOCAL_CFG.write_text(
        "# 本地密钥与模型设置 —— 由控制台「设置」页维护，已在 .gitignore 中排除\n"
        + yaml.safe_dump(local, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return public()
