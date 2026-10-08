"""Higgsfield image generation over its MCP, with the call shapes the app measured on the live server (generate.ts, 2026-09-10).

What the app learned and this client keeps:

1. `use_unlim: false` goes on every generation and cost call. Left out, the server may answer with a question
   (`unlim_choice`), submit nothing, and look like a success. There is nobody here to answer it.
2. `medias[].value` is a media id, never a URL. References are imported first with `media_import_url`.
3. `generate_image_batch` is the headless tool; `generate_image` opens a widget in chat clients, so it is used here
   only with `get_cost: true`, which answers with the price and creates no job.
4. `jobs_wait` takes at most 12 jobs and long-polls for at most 15 seconds, so waiting means calling it repeatedly.

The transport is the `mcp` package's streamable-HTTP client; the bearer token travels on the `httpx2.AsyncClient`
the transport takes (mcp 2.x has no `headers=` argument on the transport itself). Every call opens one session,
which is simple and fine at the call rates a picture tool makes. `FakeClient` has the same surface for tests.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from ..config import ENGINE_ROOT

DEFAULT_URL = "https://mcp.higgsfield.ai/mcp"
TOKEN_ENV = "HIGGSFIELD_MCP_TOKEN"
IMAGE_MODEL = "nano_banana_pro"
MAX_WAIT_JOBS = 12
MAX_POLL_SECONDS = 15
REFERENCE_ROLE = "image_references"

# Read from models_explore on 2026-09-10 (generate.ts).
IMAGE_ASPECTS = ("1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9")


class HiggsfieldError(RuntimeError):
    pass


@dataclass(frozen=True)
class JobRef:
    index: int
    job_id: str


@dataclass(frozen=True)
class JobOutcome:
    index: int
    job_id: str
    status: str
    model: str | None = None
    result_url: str | None = None
    error: str | None = None


def nearest_aspect(ratio: float) -> str:
    """The supported image aspect closest in log-ratio to a W/H ratio (port of generate.ts imageAspect)."""
    import math

    best, best_gap = IMAGE_ASPECTS[0], float("inf")
    for cand in IMAGE_ASPECTS:
        w, h = (float(v) for v in cand.split(":"))
        gap = abs(math.log(w / h) - math.log(max(ratio, 1e-6)))
        if gap < best_gap:
            best, best_gap = cand, gap
    return best


def payload(result: Any, tool: str) -> Any:
    """Structured content if the tool gave any, else the JSON parsed out of its text; errors and the unlim question raise."""
    content = getattr(result, "content", None) or []
    text = "\n".join(c.text for c in content if getattr(c, "type", None) == "text" and isinstance(getattr(c, "text", None), str))
    if getattr(result, "is_error", False):
        raise HiggsfieldError(f"Higgsfield {tool} failed: {text[:300]}")
    data = getattr(result, "structured_content", None)
    if data is None and text:
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = None
    check_unlim(data, tool)
    return data


def check_unlim(data: Any, tool: str) -> None:
    if isinstance(data, dict) and "unlim_choice" in data:
        raise HiggsfieldError(f"Higgsfield asked which balance to spend instead of generating; use_unlim must be sent on every {tool} call")


def read_jobs(data: Any, tool: str) -> list[JobRef]:
    jobs = data.get("jobs") if isinstance(data, dict) and isinstance(data.get("jobs"), list) else []
    refs = [JobRef(int(j.get("index") or 0), str(j["job_id"])) for j in jobs
            if isinstance(j, dict) and isinstance(j.get("job_id"), str) and j.get("status") != "submission_failed"]
    if not refs:
        why = next((j.get("error") for j in jobs if isinstance(j, dict) and isinstance(j.get("error"), str)), None)
        raise HiggsfieldError(f"Higgsfield did not start the generation: {str(why)[:200]}" if why
                              else f"Higgsfield {tool} accepted the request but returned no job")
    return refs


def read_outcomes(data: Any) -> list[JobOutcome]:
    jobs = data.get("jobs") if isinstance(data, dict) and isinstance(data.get("jobs"), list) else []
    out = []
    for j in jobs:
        if not isinstance(j, dict):
            continue
        out.append(JobOutcome(int(j.get("index") or 0), str(j.get("job_id") or ""), str(j.get("status") or "unknown"),
                              j.get("model") if isinstance(j.get("model"), str) else None,
                              j.get("result_url") if isinstance(j.get("result_url"), str) else None,
                              j.get("error") if isinstance(j.get("error"), str) else None))
    return out


class Client:
    """Synchronous Higgsfield MCP client. One MCP session per call (asyncio.run), bearer token on the HTTP client."""

    def __init__(self, token: str, url: str = DEFAULT_URL, timeout: float = 60.0):
        if not token:
            raise HiggsfieldError(f"no Higgsfield MCP token; set {TOKEN_ENV} in engine/.env")
        self.token = token
        self.url = url
        self.timeout = timeout

    @classmethod
    def from_env(cls, url: str = DEFAULT_URL) -> Client:
        load_dotenv(ENGINE_ROOT / ".env")
        return cls(os.environ.get(TOKEN_ENV, ""), url)

    # -- transport --

    async def _acall(self, name: str, args: dict) -> Any:
        import httpx2
        from mcp import ClientSession
        from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

        headers = {"Authorization": f"Bearer {self.token}"}
        timeout = httpx2.Timeout(self.timeout, read=max(self.timeout, 300.0))
        async with (
            create_mcp_http_client(headers=headers, timeout=timeout) as http,
            streamable_http_client(self.url, http_client=http) as (read, write),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            return payload(await session.call_tool(name, args), name)

    def _call(self, name: str, args: dict) -> Any:
        return asyncio.run(self._acall(name, args))

    # -- tools --

    def import_url(self, url: str, type: str = "image") -> str | None:
        """Pull one reference into Higgsfield's storage; None when it would not load (one bad reference must not sink a generation)."""
        try:
            data = self._call("media_import_url", {"url": url, "type": type})
        except HiggsfieldError:
            return None
        media_id = data.get("media_id") if isinstance(data, dict) else None
        return media_id if isinstance(media_id, str) and media_id else None

    def upload(self, path: Path) -> str | None:
        """Push one local reference into Higgsfield's storage through media_upload's presigned URL and confirm it; the media id,
        or None when any step fails (a reference is help, never a reason to stop)."""
        path = Path(path)
        suffix = path.suffix.lower().lstrip(".") or "png"
        content_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(suffix, "image/png")
        try:
            data = self._call("media_upload", {"filename": path.name, "content_type": content_type, "method": "upload_url"})
            entry = data
            if isinstance(data, dict):
                for key in ("files", "uploads", "results"):
                    if isinstance(data.get(key), list) and data[key]:
                        entry = data[key][0]
                        break
            if not isinstance(entry, dict):
                return None
            upload_url = entry.get("upload_url") or entry.get("url")
            media_id = entry.get("media_id") or entry.get("id")
            if not (isinstance(upload_url, str) and isinstance(media_id, str)):
                return None
            import httpx

            resp = httpx.put(upload_url, content=path.read_bytes(), headers={"Content-Type": content_type}, timeout=self.timeout)
            if resp.status_code >= 300:
                return None
            self._call("media_confirm", {"media_id": media_id, "type": "image"})
            return media_id
        except (HiggsfieldError, OSError):
            return None

    def cost(self, model: str, params: dict) -> float | None:
        """What this exact generation would cost, without submitting it (generate_image with get_cost)."""
        try:
            data = self._call("generate_image", {"params": {**params, "model": model, "use_unlim": False, "get_cost": True}})
        except HiggsfieldError:
            return None
        cost = data.get("cost") if isinstance(data, dict) else None
        if not isinstance(cost, dict):
            return None
        value = cost.get("credits_exact", cost.get("credits"))
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def generate(self, requests: list[dict]) -> list[JobRef]:
        """Submit image requests headlessly: [{index, params}], every params carrying use_unlim False."""
        reqs = [{"index": int(r.get("index", i)), "params": {**r["params"], "use_unlim": False}} for i, r in enumerate(requests)]
        return read_jobs(self._call("generate_image_batch", {"requests": reqs}), "generate_image_batch")

    def wait(self, jobs: list[JobRef], timeout: float = MAX_POLL_SECONDS, budget: float = 600.0) -> list[JobOutcome]:
        """Poll jobs_wait (12 jobs and 15 s per call at most) until every job is terminal or the budget is spent."""
        poll = int(min(max(timeout, 1), MAX_POLL_SECONDS))
        outcomes: dict[str, JobOutcome] = {j.job_id: JobOutcome(j.index, j.job_id, "pending") for j in jobs}
        started = time.monotonic()
        while True:
            all_terminal = True
            for chunk in (jobs[i:i + MAX_WAIT_JOBS] for i in range(0, len(jobs), MAX_WAIT_JOBS)):
                data = self._call("jobs_wait", {"jobs": [{"index": j.index, "job_id": j.job_id} for j in chunk], "timeout_seconds": poll})
                for o in read_outcomes(data):
                    outcomes[o.job_id] = o
                if not (isinstance(data, dict) and data.get("all_terminal") is True):
                    all_terminal = False
            if all_terminal or time.monotonic() - started >= budget:
                return [outcomes[j.job_id] for j in jobs]

    def download(self, url: str, out: Path) -> Path:
        import httpx

        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(follow_redirects=True, timeout=self.timeout) as http:
            resp = http.get(url)
            resp.raise_for_status()
            out.write_bytes(resp.content)
        return out

    def balance(self) -> float | None:
        try:
            data = self._call("balance", {})
            return float(data["credits"]) if isinstance(data, dict) and data.get("credits") is not None else None
        except (HiggsfieldError, TypeError, ValueError):
            return None


PROBE_SECRET_ENV = "SOCIALYTICS_SERVER_SECRET"
PROBE_USER_ENV = "SOCIALYTICS_ACT_AS_USER"
PROBE_JWT_ENV = "SOCIALYTICS_STAFF_JWT"
PROBE_URL_ENV = "SOCIALYTICS_PROBE_URL"
DEFAULT_PROBE_URL = "https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/higgsfield-probe"
SUPABASE_ANON_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3b3V3eHFnZ2pqYWNicGJocXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjI5MjUsImV4cCI6MjA4NjI5ODkyNX0."
                     "MVh6NOBLeBFvgYlxa9Ye9y6fTX3fQrMuo-YcwwJL5hU")  # public by design (the app bundle inlines it)


class _ProbeResult:
    """The shape `payload` reads, built from the probe function's answer (`{mcp: "call", isError, data, text}`)."""

    def __init__(self, body: dict):
        self.is_error = bool(body.get("isError"))
        self.structured_content = body.get("data")
        text = body.get("text")
        self.content = [type("T", (), {"type": "text", "text": text})()] if isinstance(text, str) else []


class ProbeClient(Client):
    """The same surface as Client, but every MCP tool call goes through Socialytics's own `higgsfield-probe` edge function, which
    holds the team's linked Higgsfield session (the server-side OAuth refresh token in integration_tokens). This is the product's
    own access path: the worker on the Socialytics box will call the MCP with that session directly; from a laptop the function
    is the door. Auth is the project's server secret plus the user acted for, or a signed-in admin's JWT."""

    def __init__(self, url: str = DEFAULT_PROBE_URL, secret: str = "", act_as: str = "", jwt: str = "", timeout: float = 300.0):
        bridged = "n8n" in url  # the n8n bridge holds the secret itself; the laptop sends only the user acted for
        if not act_as and not jwt:
            raise HiggsfieldError(f"no Socialytics credential; set {PROBE_USER_ENV} (+ {PROBE_SECRET_ENV} unless bridged) or {PROBE_JWT_ENV} in engine/.env")
        if not bridged and not jwt and not secret:
            raise HiggsfieldError(f"calling the edge function directly needs {PROBE_SECRET_ENV} in engine/.env")
        self.url, self.secret, self.act_as, self.jwt, self.timeout, self.bridged = url, secret, act_as, jwt, timeout, bridged
        self.token = "probe"

    @classmethod
    def from_env(cls) -> ProbeClient:  # type: ignore[override]
        load_dotenv(ENGINE_ROOT / ".env")
        return cls(os.environ.get(PROBE_URL_ENV, DEFAULT_PROBE_URL), os.environ.get(PROBE_SECRET_ENV, ""), os.environ.get(PROBE_USER_ENV, ""),
                   os.environ.get(PROBE_JWT_ENV, ""))

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.bridged:
            return h
        h["apikey"] = SUPABASE_ANON_KEY
        if self.jwt:
            h["Authorization"] = f"Bearer {self.jwt}"
        else:
            h["Authorization"] = f"Bearer {SUPABASE_ANON_KEY}"
            h["x-socialytics-secret"] = self.secret
            h["x-socialytics-user"] = self.act_as
        return h

    def _call(self, name: str, args: dict) -> Any:
        import httpx

        resp = httpx.post(self.url, json={"mcp": "call", "tool": name, "args": args, "act_as": self.act_as}, headers=self._headers(), timeout=self.timeout)
        if resp.status_code >= 300:
            raise HiggsfieldError(f"higgsfield-probe {resp.status_code} on {name}: {resp.text[:300]}")
        body = resp.json()
        if isinstance(body, dict) and isinstance(body.get("status"), int) and body["status"] >= 300:
            raise HiggsfieldError(f"higgsfield-probe {body['status']} on {name}: {str(body.get('error') or body)[:300]}")
        if not isinstance(body, dict) or body.get("mcp") != "call":
            raise HiggsfieldError(f"higgsfield-probe answered without a tool result on {name}: {resp.text[:300]}")
        return payload(_ProbeResult(body), name)

    def list_tools(self) -> list[str]:
        import httpx

        resp = httpx.post(self.url, json={"mcp": "tools", "act_as": self.act_as}, headers=self._headers(), timeout=self.timeout)
        if resp.status_code >= 300:
            raise HiggsfieldError(f"higgsfield-probe {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        if isinstance(body, dict) and body.get("error"):
            raise HiggsfieldError(f"higgsfield-probe: {body['error']}")
        return list(body.get("tools") or [])


class FakeClient:
    """Scripted stand-in with the Client surface. `pictures` are the PNG bytes successive downloads write; `costs` the preflight answers;
    `media_ids` the import answers (None = would not load). Every call is recorded on `calls` as (tool, args)."""

    def __init__(self, pictures: list[bytes] | None = None, costs: list[float] | float | None = 6.0, media_ids: list[str | None] | None = None,
                 balance: float = 1000.0):
        self.pictures = list(pictures or [])
        self.costs = list(costs) if isinstance(costs, list) else costs
        self.media_ids = list(media_ids or [])
        self.credits = balance
        self.calls: list[tuple[str, dict]] = []
        self._jobs = 0
        self._downloads = 0

    def import_url(self, url: str, type: str = "image") -> str | None:
        self.calls.append(("media_import_url", {"url": url, "type": type}))
        return self.media_ids.pop(0) if self.media_ids else f"media-{len(self.calls)}"

    def upload(self, path: Path) -> str | None:
        self.calls.append(("media_upload", {"filename": Path(path).name}))
        return self.media_ids.pop(0) if self.media_ids else f"media-{len(self.calls)}"

    def cost(self, model: str, params: dict) -> float | None:
        self.calls.append(("cost", {"params": {**params, "model": model, "use_unlim": False, "get_cost": True}}))
        if isinstance(self.costs, list):
            return self.costs.pop(0) if self.costs else None
        return self.costs

    def generate(self, requests: list[dict]) -> list[JobRef]:
        reqs = [{"index": int(r.get("index", i)), "params": {**r["params"], "use_unlim": False}} for i, r in enumerate(requests)]
        self.calls.append(("generate_image_batch", {"requests": reqs}))
        refs = []
        for r in reqs:
            self._jobs += 1
            refs.append(JobRef(r["index"], f"job-{self._jobs}"))
        return refs

    def wait(self, jobs: list[JobRef], timeout: float = MAX_POLL_SECONDS, budget: float = 600.0) -> list[JobOutcome]:
        self.calls.append(("jobs_wait", {"jobs": [{"index": j.index, "job_id": j.job_id} for j in jobs], "timeout_seconds": min(timeout, 15)}))
        return [JobOutcome(j.index, j.job_id, "completed", IMAGE_MODEL, f"fake://{j.job_id}") for j in jobs]

    def download(self, url: str, out: Path) -> Path:
        self.calls.append(("download", {"url": url, "out": str(out)}))
        if not self.pictures:
            raise HiggsfieldError(f"FakeClient has no scripted picture left for {url}")
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(self.pictures.pop(0))
        self._downloads += 1
        return out

    def balance(self) -> float | None:
        self.calls.append(("balance", {}))
        return self.credits
