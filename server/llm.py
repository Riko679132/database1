"""OpenAI 兼容的大模型客户端（默认 DeepSeek）。"""
from __future__ import annotations

from typing import Any

import requests

from . import settings


class LLMError(RuntimeError):
    pass


def _cfg(override: dict | None = None) -> dict:
    cfg = settings.ai_config()
    if override:
        cfg.update({k: v for k, v in override.items() if v})
        cfg["base_url"] = str(cfg.get("base_url") or "").rstrip("/")
    if not cfg.get("api_key"):
        raise LLMError("尚未配置 AI 模型 API Key，请到「设置」页填写")
    return cfg


def _redact(text: str, secret: str) -> str:
    if secret and secret in text:
        text = text.replace(secret, "sk-***")
    return text[:400]


def chat(
    messages: list[dict],
    *,
    json_mode: bool = True,
    temperature: float = 0.1,
    max_tokens: int = 8192,
    timeout: int = 300,
    model: str | None = None,
    override: dict | None = None,
) -> str:
    cfg = _cfg(override)
    url = f"{cfg['base_url']}/chat/completions"
    payload: dict[str, Any] = {
        "model": model or cfg["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {cfg['api_key']}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise LLMError(f"请求失败：{exc}") from exc
    if resp.status_code != 200:
        raise LLMError(
            f"模型返回 HTTP {resp.status_code}：{_redact(resp.text, cfg['api_key'])}"
        )
    try:
        data = resp.json()
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError(f"响应格式异常：{exc}") from exc


def list_models(override: dict | None = None) -> list[dict]:
    cfg = _cfg(override)
    try:
        resp = requests.get(
            f"{cfg['base_url']}/models",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise LLMError(f"请求失败：{exc}") from exc
    if resp.status_code != 200:
        raise LLMError(
            f"模型返回 HTTP {resp.status_code}：{_redact(resp.text, cfg['api_key'])}"
        )
    try:
        items = resp.json().get("data") or []
        return sorted(
            ({"id": m.get("id"), "owned_by": m.get("owned_by")} for m in items if m.get("id")),
            key=lambda m: m["id"],
        )
    except ValueError as exc:
        raise LLMError("模型列表解析失败") from exc


def test_connection(override: dict | None = None) -> dict:
    cfg = _cfg(override)
    reply = chat(
        [{"role": "user", "content": "只回复两个字：可用"}],
        json_mode=False,
        max_tokens=16,
        timeout=40,
        override=override,
    )
    return {"ok": True, "model": cfg["model"], "reply": reply.strip()[:40]}
