"""The design worker: one process on the Socialytics box, one run at a time. It leases a queued run, builds the run context from the
client's confirmed profile and local workspace (fonts, logo files, reads), runs the per-post loop, uploads the passing renders to the
generated-media bucket, writes the options and finishes the run with what was spent. A run with no confirmed brand fails with that
reason and nothing is shown. Everything the gate refused stays refused: the worker publishes only offered options."""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from ..config import settings
from ..platform import specs
from ..run import loop
from ..run.tools import Budget, RunContext
from .store import FakeStore, Run, StoreError, SupabaseStore

log = logging.getLogger("design_worker")
POLL_SECONDS = 15
LEASE_SECONDS = 900


def slugify(name: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def sizes_for(platform: str, fmt: str) -> tuple[str, list[specs.Size]]:
    tried = [platform.strip()] + [p.strip() for p in platform.split("/") if p.strip()]
    last: Exception | None = None
    for name in tried:
        try:
            return name, specs.sizes_for(name, fmt)
        except KeyError as e:
            last = e
    raise StoreError(f"no sizes for platform {platform!r} and format {fmt!r}: {last}")


def workspace_for(run: Run, profile: dict) -> Path:
    """The client's learned workspace on this host (fonts, logo files, reads, posts): the learner fills it; a run without it fails."""
    slug = slugify(str(profile.get("client_name") or run.client_id))
    ws = settings().work_dir / slug
    if not (ws / "out" / "profile.json").exists():
        raise StoreError(f"brand not learned on this host for {profile.get('client_name') or run.client_id}: no workspace at {ws}")
    return ws


def build_context(run: Run, profile: dict, rules: list[str], prior: list[dict], ws: Path, browser: Any, clients: dict) -> RunContext:
    """The same context scripts/run_post.py builds, from the run row instead of a calendar file."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from learn_client import is_designed, load_reads  # noqa: E402
    from run_post import choose_fonts, picture_crops  # noqa: E402

    families = [f for f in profile.get("families") or [] if "headline" in ((f.get("template") or {}).get("slots") or {})]
    if not families:
        raise StoreError("the confirmed profile has no family with a headline slot")
    reads_path = ws / "out" / "reads.json"
    reads = load_reads(reads_path) if reads_path.exists() else []
    designed = [r for r in reads if is_designed(r)]
    platform, size_list = sizes_for(run.platform, run.format)
    # an unresolved type (the site serves no font file) runs on the library's best match, recorded on the run; the Setup screen shows it
    typ = profile.get("type") or {}
    stand_in = typ.get("accepted_stand_in") or os.environ.get("DESIGN_STAND_IN_FONT")
    if typ.get("status") != "resolved" and not stand_in:
        cands = [c for c in (typ.get("candidates") or []) if c.get("file") and Path(str(c["file"])).exists()]
        if cands:
            stand_in = str(cands[0]["file"])
    headline_font, subline_font, used_stand_in = choose_fonts(profile, stand_in, ws / "website" / "fonts")
    if used_stand_in:
        profile = dict(profile)
        profile.setdefault("type", {})["accepted_stand_in"] = str(headline_font)
    logo_files = [f for f in (profile.get("logo") or {}).get("files") or []
                  if f.get("path") and (Path(f["path"]) if Path(f["path"]).is_absolute() else ws / f["path"]).exists()]
    if not logo_files:
        raise StoreError("the profile carries no logo file that exists on this host")
    profile = dict(profile)
    profile["rules"] = list(rules)
    budget = Budget(max_turns=int(run.budget.get("max_turns", 24)), max_usd=float(run.budget.get("max_usd", 6.0)),
                    max_credits=float(run.budget.get("max_credits", 30)))
    run_dir = ws / "runs" / f"{time.strftime('%Y%m%d-%H%M%S')}-{run.id[:8]}"
    return RunContext(profile=profile, families=families, reads=reads, workspace=ws, size_list=size_list, platform=platform,
                      post={"copy": run.copy, "format": run.format, "pillar": run.pillar, "post_key": run.post_key, "run_id": run.id},
                      prior_runs=prior, budget=budget, clients=clients, fonts={"headline": headline_font, "subline": subline_font},
                      logo_files=logo_files, run_dir=run_dir, browser=browser, references=[r.path for r in designed],
                      picture_references=picture_crops(designed, ws / "out" / "picture_crops"), model=os.environ.get("DESIGN_MODEL", loop.DEFAULT_MODEL))


def option_rows(store: Any, run: Run, ctx: RunContext, result: Any) -> list[dict]:
    """design_options rows for every offered option and its slides, renders uploaded to the bucket."""
    rows: list[dict] = []
    offered = {o.id for o in result.options}
    states = {o.id: o for o in result.states}
    for o in result.states:
        if o.status != "offered" or (o.parent and o.parent not in offered) or (not o.parent and o.id not in offered):
            continue
        files: dict[str, dict] = {}
        for size_name, rec in o.renders.items():
            r = rec["rendered"]
            name = f"{o.id}-{size_name}.png"
            url = store.upload(run.client_id, run.id, Path(r.png), name)
            files[size_name] = {"url": url, "path": f"designs/{run.client_id}/{run.id}/{name}", "w": ctx_size(ctx, size_name).w, "h": ctx_size(ctx, size_name).h,
                                "passed": rec["gate"].passed}
        measurements = {size_name: {"passed": rec["gate"].passed, "measurements": rec["gate"].measurements, "warnings": rec["gate"].warnings}
                        for size_name, rec in o.renders.items()}
        measurements["picture_concept"] = o.picture_brief
        measurements["signature"] = o.distinct_signature
        measurements["copy"] = o.copy
        rows.append({"run_id": run.id, "client_id": run.client_id, "option_key": o.id, "rank": o.rank,
                     "kind": "slide" if o.parent else o.kind, "parent_key": o.parent, "slide_role": o.slide_role,
                     "family_key": o.family_key or (o.family or {}).get("key"), "arrangement": o.arrangement, "files": files,
                     "picture_jobs": [{"job_ids": p.job_ids, "credits": p.credits} for p in o.pictures], "measurements": measurements,
                     "status": "offered"})
    del states
    return rows


def ctx_size(ctx: RunContext, name: str) -> specs.Size:
    return next(s for s in ctx.size_list if s.name == name)


def process(store: Any, run: Run, browser: Any, clients: dict) -> dict:
    """One run end to end; returns the finish payload. Never raises past a run: a failure finishes the run as failed with the reason."""
    try:
        profile = store.confirmed_profile(run.client_id)
        if profile is None:
            raise StoreError("no confirmed brand profile for this client; confirm the brand on the Setup screen first")
        ws = workspace_for(run, profile)
        ctx = build_context(run, profile, store.rules(run.client_id), store.prior_runs(run.client_id), ws, browser, clients)
        store.heartbeat(run.id, LEASE_SECONDS, plan={"stage": "running", "sizes": [s.name for s in ctx.size_list]})
        result = loop.run_post(ctx)
        rows = option_rows(store, run, ctx, result)
        store.write_options(rows)
        status = "offered" if result.options else "dropped"
        failure = None if result.options else "; ".join(f"{d['id']}: {d['reason']}" for d in result.dropped)[:1000] or "nothing passed the gate"
        payload = {"status": status, "spent": {k: v for k, v in ctx.spent.items() if k != "model_calls"} | {"model_calls": len(ctx.spent.get("model_calls") or [])},
                   "sizes": [{"name": s.name, "w": s.w, "h": s.h} for s in ctx.size_list], "failure": failure,
                   "plan": {"stage": "finished", "offered": [o.id for o in result.options], "dropped": result.dropped, "run_dir": str(ctx.run_dir)}}
    except Exception as e:  # noqa: BLE001  the run row carries the reason; the worker lives on
        log.error("run %s failed: %s\n%s", run.id, e, traceback.format_exc())
        payload = {"status": "failed", "spent": {}, "sizes": [], "failure": f"{type(e).__name__}: {e}"[:1000], "plan": {"stage": "failed"}}
    store.finish(run.id, payload["status"], payload["spent"], payload["sizes"], payload["failure"], payload["plan"])
    return payload


def serve(store: Any, browser_factory: Any, clients: dict, once: bool = False, poll: float = POLL_SECONDS) -> int:
    """Poll for runs forever (or once); returns how many runs were processed."""
    done = 0
    while True:
        run = store.lease(LEASE_SECONDS)
        if run is None:
            if once:
                return done
            time.sleep(poll)
            continue
        log.info("run %s leased for client %s post %s", run.id, run.client_id, run.post_key)
        with browser_factory() as browser:
            process(store, run, browser, clients)
        done += 1
        if once:
            return done


def status_payload(store: Any) -> dict:
    return {"mode": "status", "worker": "design", "pid": os.getpid(), "time": time.strftime("%Y-%m-%dT%H:%M:%S")}


__all__ = ["FakeStore", "SupabaseStore", "build_context", "option_rows", "process", "serve", "status_payload"]
