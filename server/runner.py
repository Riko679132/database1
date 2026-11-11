"""任务运行器：线程执行、日志追加、取消、运行记录落盘。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

from .settings import ROOT

RUNS_DIR = ROOT / "data" / "control" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

MAX_LOGS = 4000


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Run:
    def __init__(self, task_id: str, title: str, params: dict):
        self.id = f"{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}"
        self.task_id = task_id
        self.title = title
        self.params = params
        self.status = "pending"
        self.created_at = _now()
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.result: dict | None = None
        self.error: str | None = None
        self.logs: list[dict] = []
        self.proc: subprocess.Popen | None = None
        self.cancelled = False
        self._lock = threading.Lock()

    # ---- logging ----
    def log(self, line: str) -> None:
        with self._lock:
            if len(self.logs) >= MAX_LOGS:
                return
            self.logs.append({"i": len(self.logs), "t": time.strftime("%H:%M:%S"), "line": str(line)})
            should_flush = len(self.logs) % 25 == 0
        if should_flush:
            self.persist()

    def step(self, title: str) -> None:
        self.log("")
        self.log(f"=== {title} ===")

    # ---- state ----
    def to_dict(self, since: int = 0, include_logs: bool = True) -> dict:
        with self._lock:
            logs = [l for l in self.logs if l["i"] >= since] if include_logs else []
            total = len(self.logs)
        return {
            "id": self.id,
            "task_id": self.task_id,
            "title": self.title,
            "params": self.params,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error": self.error,
            "logs": logs,
            "log_cursor": total,
        }

    def persist(self) -> None:
        try:
            (RUNS_DIR / f"{self.id}.json").write_text(
                json.dumps(self.to_dict(), ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            pass


class Runner:
    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}
        self._lock = threading.Lock()
        self._load_history()

    def _load_history(self) -> None:
        files = sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files[:60]:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            run = Run(data["task_id"], data.get("title", ""), data.get("params") or {})
            run.id = data["id"]
            run.status = data.get("status", "failed")
            if run.status in ("running", "pending"):
                run.status = "failed"
                run.error = "服务重启，任务已中断"
            run.created_at = data.get("created_at") or run.created_at
            run.started_at = data.get("started_at")
            run.finished_at = data.get("finished_at")
            run.result = data.get("result")
            run.error = data.get("error") or run.error
            run.logs = data.get("logs") or []
            self.runs[run.id] = run

    def start(self, task_id: str, title: str, params: dict, fn: Callable[[Run], dict]) -> Run:
        run = Run(task_id, title, params)
        with self._lock:
            self.runs[run.id] = run
        run.status = "running"
        run.started_at = _now()
        run.persist()

        def _worker() -> None:
            try:
                result = fn(run) or {}
                run.result = result
                run.status = "cancelled" if run.cancelled else "success"
            except Exception as exc:  # noqa: BLE001 - 任务错误需要原样回传前端
                run.error = str(exc)
                run.status = "cancelled" if run.cancelled else "failed"
                run.log(f"[ERROR] {exc}")
            finally:
                run.finished_at = _now()
                run.proc = None
                run.persist()

        threading.Thread(target=_worker, name=f"run-{run.id}", daemon=True).start()
        return run

    def get(self, run_id: str) -> Run | None:
        return self.runs.get(run_id)

    def list(self, limit: int = 20) -> list[dict]:
        runs = sorted(self.runs.values(), key=lambda r: r.created_at, reverse=True)
        return [r.to_dict(include_logs=False) for r in runs[:limit]]

    def cancel(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if not run or run.status != "running":
            return False
        run.cancelled = True
        run.status = "cancelled"
        proc = run.proc
        if proc and proc.poll() is None:
            try:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        capture_output=True,
                    )
                else:
                    proc.terminate()
            except Exception:
                pass
        run.log("[CANCELLED] 用户取消")
        run.persist()
        return True


def run_script(
    run: Run,
    args: list[str],
    *,
    python: str | None = None,
    env: dict | None = None,
    cwd: Path | None = None,
    check: bool = True,
) -> int:
    """在项目根目录执行脚本，逐行把输出写进 run.log。"""
    exe = python or sys.executable
    full_env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    if env:
        full_env.update(env)
    run.log(f"$ {Path(exe).name} {' '.join(args)}")
    proc = subprocess.Popen(
        [exe, *args],
        cwd=str(cwd or ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=full_env,
    )
    run.proc = proc
    assert proc.stdout is not None
    for line in proc.stdout:
        run.log(line.rstrip("\n"))
        if run.cancelled:
            break
    code = proc.wait()
    run.proc = None
    if code != 0:
        run.log(f"[exit {code}]")
        if check:
            raise RuntimeError(f"命令执行失败（退出码 {code}），详见日志")
    return code
