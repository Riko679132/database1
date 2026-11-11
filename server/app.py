"""控制台 HTTP 服务：任务执行、运行日志、密钥设置、静态托管。

启动：.venv\\Scripts\\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8765
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import llm, settings, tasks
from .runner import Runner

ROOT = settings.ROOT
DIST = ROOT / "web" / "dist"
PUBLIC_META = ROOT / "web" / "public" / "data" / "meta.json"
DIST_META = DIST / "data" / "meta.json"
DB_FILE = ROOT / "data" / "ccus.sqlite"

runner = Runner()
app = FastAPI(title="CCUS 数据控制台", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    params: dict = {}


class SettingsPayload(BaseModel):
    ai: dict | None = None
    elsevier: dict | None = None
    unpaywall: dict | None = None


class AiTestPayload(BaseModel):
    ai: dict | None = None


class ElsevierTestPayload(BaseModel):
    api_key: str | None = None


class UnpaywallTestPayload(BaseModel):
    email: str | None = None


def _served_snapshot() -> tuple[Path, str]:
    """站点由本服务托管时读 dist/data，开发模式读 public/data。"""
    dist_snap = DIST / "data" / "ccus_public.sqlite"
    if dist_snap.exists():
        return dist_snap, "dist"
    return ROOT / "web" / "public" / "data" / "ccus_public.sqlite", "public"


def _snapshot_meta() -> dict:
    meta = DIST_META if DIST_META.exists() else PUBLIC_META
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def _coerce(task: dict, raw: dict) -> dict:
    values: dict = {}
    for spec in task.get("params") or []:
        key = spec["key"]
        value = raw.get(key, spec.get("default"))
        if spec["type"] == "bool":
            values[key] = bool(value)
        elif spec["type"] == "int":
            try:
                values[key] = int(value)
            except (TypeError, ValueError):
                raise HTTPException(400, f"参数 {spec['label']} 需要整数") from None
        else:
            values[key] = "" if value is None else str(value).strip()
        if spec.get("required") and not values[key]:
            raise HTTPException(400, f"缺少必填参数：{spec['label']}")
    return values


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "time": time.strftime("%Y-%m-%d %H:%M:%S")}


@app.get("/api/status")
def status() -> dict:
    meta = _snapshot_meta()
    ai = settings.ai_config()
    served, served_from = _served_snapshot()
    stale = False
    if DB_FILE.exists() and served.exists():
        stale = DB_FILE.stat().st_mtime > served.stat().st_mtime + 2
    return {
        "snapshot": {
            "tests": meta.get("test_count"),
            "performance": meta.get("performance_count"),
            "l2": meta.get("literature_l2"),
            "simulation": meta.get("simulation"),
            "generated_at": meta.get("generated_at"),
            "sha": (meta.get("source_sha256") or "")[:12],
            "served_from": served_from,
            "stale": stale,
        },
        "keys": {
            "ai": bool(ai.get("api_key")),
            "ai_model": ai.get("model"),
            "elsevier": bool(settings.elsevier_key()),
            "unpaywall": bool(settings.unpaywall_email()),
        },
        "recent_runs": runner.list(5),
        "batches": tasks.list_batches(5),
        "server_time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.get("/api/tasks")
def list_tasks() -> dict:
    return {"tasks": tasks.public_tasks()}


@app.post("/api/tasks/{task_id}/run")
def run_task(task_id: str, req: RunRequest) -> dict:
    task = tasks.get_task(task_id)
    if not task:
        raise HTTPException(404, f"未知任务：{task_id}")
    params = _coerce(task, req.params or {})
    run = runner.start(task_id, task["title"], params, task["run"])
    return run.to_dict(include_logs=False)


@app.get("/api/runs")
def list_runs(limit: int = 20) -> dict:
    return {"runs": runner.list(limit)}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, since: int = 0) -> dict:
    run = runner.get(run_id)
    if not run:
        raise HTTPException(404, "运行记录不存在")
    return run.to_dict(since=since)


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict:
    ok = runner.cancel(run_id)
    if not ok:
        raise HTTPException(400, "任务未在运行中")
    return {"ok": True}


@app.get("/api/batches")
def list_batches(limit: int = 30) -> dict:
    return {"batches": tasks.list_batches(limit)}


@app.get("/api/batches/{batch_id}")
def get_batch(batch_id: str) -> dict:
    try:
        return tasks.batch_records(batch_id)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/settings")
def get_settings() -> dict:
    return settings.public()


@app.put("/api/settings")
def put_settings(payload: SettingsPayload) -> dict:
    data = payload.model_dump(exclude_none=True)
    return settings.save(data)


@app.post("/api/settings/test/ai")
def test_ai(payload: AiTestPayload) -> dict:
    try:
        return llm.test_connection(payload.ai)
    except llm.LLMError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/models")
def models(provider: str | None = None) -> dict:
    override = {"provider": provider} if provider else None
    try:
        return {"models": llm.list_models(override)}
    except llm.LLMError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/settings/test/elsevier")
def test_elsevier(payload: ElsevierTestPayload) -> dict:
    key = (payload.api_key or settings.elsevier_key()).strip()
    if not key:
        raise HTTPException(400, "未填写 Elsevier API Key")
    try:
        resp = requests.get(
            "https://api.elsevier.com/content/search/scopus",
            params={"query": "all:CO2 capture", "count": 1},
            headers={"X-ELS-APIKey": key, "Accept": "application/json"},
            timeout=25,
        )
    except requests.RequestException as exc:
        raise HTTPException(400, f"网络请求失败：{exc}") from exc
    if resp.status_code != 200:
        raise HTTPException(400, f"Elsevier 返回 HTTP {resp.status_code}")
    return {"ok": True, "status": resp.status_code}


@app.post("/api/settings/test/unpaywall")
def test_unpaywall(payload: UnpaywallTestPayload) -> dict:
    email = (payload.email or settings.unpaywall_email()).strip()
    if not email:
        raise HTTPException(400, "未填写 Unpaywall 邮箱")
    try:
        resp = requests.get(
            "https://api.unpaywall.org/v2/10.1021/acs.est.0c02123",
            params={"email": email},
            timeout=25,
        )
    except requests.RequestException as exc:
        raise HTTPException(400, f"网络请求失败：{exc}") from exc
    if resp.status_code != 200:
        raise HTTPException(400, f"Unpaywall 返回 HTTP {resp.status_code}")
    data = resp.json()
    return {"ok": True, "doi": data.get("doi"), "is_oa": data.get("is_oa")}


if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="ui")


def main() -> None:
    import uvicorn

    uvicorn.run("server.app:app", host="127.0.0.1", port=8765, reload=False)


if __name__ == "__main__":
    main()
