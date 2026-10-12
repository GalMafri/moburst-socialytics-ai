"""The worker's view of the product database: lease a run, read the client's confirmed profile, write progress, options and files.
One small HTTP surface over PostgREST and Storage with the service role; a FakeStore stands in for tests. Nothing here decides
anything about design: the engine does, this only moves rows and files."""
from __future__ import annotations

import json
import mimetypes
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BUCKET = "generated-media"


class StoreError(RuntimeError):
    pass


@dataclass
class Run:
    id: str
    client_id: str
    post_key: str
    platform: str
    format: str
    copy: str
    pillar: str | None
    budget: dict
    report_id: str | None = None
    attempts: int = 0
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: dict) -> Run:
        return cls(str(row["id"]), str(row["client_id"]), str(row["post_key"]), str(row.get("platform") or "Instagram"),
                   str(row.get("format") or "Single Image"), str(row.get("copy") or ""), row.get("pillar"), dict(row.get("budget") or {}),
                   row.get("report_id"), int(row.get("attempts") or 0), dict(row))


class SupabaseStore:
    """PostgREST + Storage with the service role key (the worker runs on the Socialytics box; never a browser)."""

    def __init__(self, url: str, service_key: str, timeout: float = 60.0):
        if not url or not service_key:
            raise StoreError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.url, self.key, self.timeout = url.rstrip("/"), service_key, timeout

    @classmethod
    def from_env(cls) -> SupabaseStore:
        return cls(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))

    def _headers(self, **extra: str) -> dict:
        return {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json", **extra}

    def _rest(self, method: str, path: str, **kw: Any) -> Any:
        import httpx

        resp = httpx.request(method, f"{self.url}/rest/v1/{path}", headers=self._headers(**kw.pop("headers", {})), timeout=self.timeout, **kw)
        if resp.status_code >= 300:
            raise StoreError(f"{method} {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json() if resp.content else None

    # -- runs --

    def lease(self, seconds: int = 900) -> Run | None:
        rows = self._rest("POST", "rpc/design_runs_lease", json={"p_lease_seconds": seconds})
        return Run.from_row(rows[0]) if rows else None

    def heartbeat(self, run_id: str, seconds: int = 900, plan: dict | None = None) -> None:
        body: dict = {"lease_until": f"now() + interval '{int(seconds)} seconds'"}
        # PostgREST cannot evaluate now() in a PATCH body; extend through the rpc instead
        self._rest("POST", "rpc/design_runs_extend", json={"p_run_id": run_id, "p_lease_seconds": seconds})
        if plan is not None:
            self._rest("PATCH", f"design_runs?id=eq.{run_id}", json={"plan": plan}, headers={"Prefer": "return=minimal"})

    def finish(self, run_id: str, status: str, spent: dict, sizes: list[dict], failure: str | None = None, plan: dict | None = None) -> None:
        body = {"status": status, "spent": spent, "sizes": sizes, "failure": failure, "finished_at": "now()", "lease_until": None}
        if plan is not None:
            body["plan"] = plan
        self._rest("PATCH", f"design_runs?id=eq.{run_id}", json=body, headers={"Prefer": "return=minimal"})

    # -- profile and rules --

    def confirmed_profile(self, client_id: str) -> dict | None:
        rows = self._rest("GET", f"brand_profiles?client_id=eq.{client_id}&status=eq.confirmed&order=version.desc&limit=1")
        if not rows:
            return None
        row = rows[0]
        profile = dict(row.get("profile") or {})
        profile.setdefault("calibration", row.get("calibration") or {})
        profile.setdefault("families", row.get("families") or [])
        return profile

    def rules(self, client_id: str) -> list[str]:
        rows = self._rest("GET", f"design_rules?client_id=eq.{client_id}&status=eq.active&order=created_at")
        return [str(r["text"]) for r in rows or []]

    def prior_runs(self, client_id: str, limit: int = 3) -> list[dict]:
        rows = self._rest("GET", f"design_options?client_id=eq.{client_id}&status=in.(offered,picked)&kind=neq.slide&order=created_at.desc&limit={limit}")
        return [{"run_id": r["run_id"], "option_id": r["option_key"], "family_key": r.get("family_key"),
                 "picture_concept": (r.get("measurements") or {}).get("picture_concept"), "signature": (r.get("measurements") or {}).get("signature"),
                 "files": [f.get("url") for f in (r.get("files") or {}).values() if f.get("url")]} for r in rows or []]

    # -- files and options --

    def upload(self, client_id: str, run_id: str, path: Path, name: str) -> str:
        import httpx

        object_path = f"designs/{client_id}/{run_id}/{name}"
        ctype = mimetypes.guess_type(str(path))[0] or "image/png"
        resp = httpx.post(f"{self.url}/storage/v1/object/{BUCKET}/{object_path}", content=Path(path).read_bytes(),
                          headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": ctype, "x-upsert": "true"},
                          timeout=self.timeout)
        if resp.status_code >= 300:
            raise StoreError(f"upload {object_path} -> {resp.status_code}: {resp.text[:200]}")
        return f"{self.url}/storage/v1/object/public/{BUCKET}/{object_path}"

    def write_options(self, rows: list[dict]) -> None:
        if rows:
            self._rest("POST", "design_options", json=rows, headers={"Prefer": "return=minimal"})


class FakeStore:
    """In-memory stand-in with the same surface; records every call."""

    def __init__(self, runs: list[dict] | None = None, profile: dict | None = None, rules: list[str] | None = None):
        self.queue = [Run.from_row(r) for r in (runs or [])]
        self.profile = profile
        self._rules = list(rules or [])
        self.finished: list[dict] = []
        self.options: list[dict] = []
        self.uploads: list[tuple[str, str]] = []
        self.heartbeats = 0

    def lease(self, seconds: int = 900) -> Run | None:
        return self.queue.pop(0) if self.queue else None

    def heartbeat(self, run_id: str, seconds: int = 900, plan: dict | None = None) -> None:
        self.heartbeats += 1

    def finish(self, run_id: str, status: str, spent: dict, sizes: list[dict], failure: str | None = None, plan: dict | None = None) -> None:
        self.finished.append({"run_id": run_id, "status": status, "spent": spent, "sizes": sizes, "failure": failure, "plan": plan})

    def confirmed_profile(self, client_id: str) -> dict | None:
        return self.profile

    def rules(self, client_id: str) -> list[str]:
        return list(self._rules)

    def prior_runs(self, client_id: str, limit: int = 3) -> list[dict]:
        return []

    def upload(self, client_id: str, run_id: str, path: Path, name: str) -> str:
        self.uploads.append((name, str(path)))
        return f"fake://{BUCKET}/designs/{client_id}/{run_id}/{name}"

    def write_options(self, rows: list[dict]) -> None:
        self.options.extend(json.loads(json.dumps(rows, default=str)))


__all__ = ["BUCKET", "BridgeStore", "FakeStore", "Run", "StoreError", "SupabaseStore"]


class BridgeStore:
    """The same surface as SupabaseStore, through the project's own `design-store` edge function (reached directly with the server
    secret, or through the n8n bridge that holds it). The worker then needs no Supabase key at all."""

    def __init__(self, url: str, act_as: str, secret: str = "", timeout: float = 120.0):
        if not url or not act_as:
            raise StoreError("SOCIALYTICS_STORE_URL and SOCIALYTICS_ACT_AS_USER are required")
        self.url, self.act_as, self.secret, self.timeout = url, act_as, secret, timeout
        self.bridged = "n8n" in url

    @classmethod
    def from_env(cls) -> BridgeStore:
        return cls(os.environ.get("SOCIALYTICS_STORE_URL", ""), os.environ.get("SOCIALYTICS_ACT_AS_USER", ""), os.environ.get("SOCIALYTICS_SERVER_SECRET", ""))

    def _call(self, op: str, **args: Any) -> dict:
        import httpx

        headers = {"Content-Type": "application/json"}
        if not self.bridged:
            headers.update({"x-socialytics-secret": self.secret, "x-socialytics-user": self.act_as})
        resp = httpx.post(self.url, json={"op": op, "args": args, "act_as": self.act_as}, headers=headers, timeout=self.timeout)
        if resp.status_code >= 300:
            raise StoreError(f"design-store {op} -> {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        if isinstance(body, dict) and body.get("error"):
            raise StoreError(f"design-store {op}: {body['error']}")
        if isinstance(body, dict) and isinstance(body.get("status"), int) and body["status"] >= 300:
            raise StoreError(f"design-store {op} -> {body['status']}: {str(body)[:300]}")
        return body

    def lease(self, seconds: int = 900) -> Run | None:
        row = self._call("lease", seconds=seconds).get("run")
        return Run.from_row(row) if row else None

    def heartbeat(self, run_id: str, seconds: int = 900, plan: dict | None = None) -> None:
        self._call("extend", run_id=run_id, seconds=seconds, plan=plan)

    def finish(self, run_id: str, status: str, spent: dict, sizes: list[dict], failure: str | None = None, plan: dict | None = None) -> None:
        self._call("finish", run_id=run_id, status=status, spent=spent, sizes=sizes, failure=failure, plan=plan)

    def confirmed_profile(self, client_id: str) -> dict | None:
        row = self._call("profile", client_id=client_id).get("profile")
        if not row:
            return None
        profile = dict(row.get("profile") or {})
        profile.setdefault("calibration", row.get("calibration") or {})
        profile.setdefault("families", row.get("families") or [])
        return profile

    def rules(self, client_id: str) -> list[str]:
        return [str(t) for t in self._call("rules", client_id=client_id).get("rules") or []]

    def prior_runs(self, client_id: str, limit: int = 3) -> list[dict]:
        rows = self._call("prior", client_id=client_id, limit=limit).get("prior") or []
        return [{"run_id": r["run_id"], "option_id": r["option_key"], "family_key": r.get("family_key"),
                 "picture_concept": (r.get("measurements") or {}).get("picture_concept"), "signature": (r.get("measurements") or {}).get("signature"),
                 "files": [f.get("url") for f in (r.get("files") or {}).values() if f.get("url")]} for r in rows]

    def upload(self, client_id: str, run_id: str, path: Path, name: str) -> str:
        import base64

        data = base64.b64encode(Path(path).read_bytes()).decode("ascii")
        return str(self._call("upload", client_id=client_id, run_id=run_id, name=name, base64=data, content_type=mimetypes.guess_type(str(path))[0] or "image/png")["url"])

    def write_options(self, rows: list[dict]) -> None:
        if rows:
            self._call("write_options", rows=json.loads(json.dumps(rows, default=str)))
