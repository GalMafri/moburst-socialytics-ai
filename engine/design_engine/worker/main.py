"""The design worker: one process on the Socialytics box, one run at a time. It leases a queued run, builds the run context from the
client's confirmed profile and local workspace (fonts, logo files, reads), runs the per-post loop, uploads the passing renders to the
generated-media bucket, writes the options and finishes the run with what was spent. A run with no confirmed brand fails with that
reason and nothing is shown. Everything the gate refused stays refused: the worker publishes only offered options."""
from __future__ import annotations

import json
import logging
import re
import os
import sys
import time
import contextlib
from dataclasses import replace
import threading
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
LEASE_SECONDS = 300  # an abandoned run is picked up again within five minutes
SECOND_PASS_MIN_CREDITS = 8.0  # a run whose first pass offered nothing gets a fresh plan when this many credits remain
KEEPALIVE_SECONDS = 60.0  # the lease is extended this often while a run is in flight, whatever its turns are doing


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

    families = [f for f in profile.get("families") or [] if f.get("status", "family") in ("family", "unrenderable") and "headline" in ((f.get("template") or {}).get("slots") or {})]
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


VIDEO_FORMATS = re.compile(r"\b(video|reel|reels|short|shorts|clip)\b", re.IGNORECASE)


def is_video_format(fmt: str | None) -> bool:
    return bool(VIDEO_FORMATS.search(str(fmt or "")))


def card_assets(profile: dict, ws: Path) -> tuple[dict, list[dict]]:
    """The fonts and logo files the brand cards (video and the fallback stills) are set with."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from run_post import choose_fonts  # noqa: E402

    typ = profile.get("type") or {}
    stand_in = typ.get("accepted_stand_in") or os.environ.get("DESIGN_STAND_IN_FONT")
    if typ.get("status") != "resolved" and not stand_in:
        cands = [c for c in (typ.get("candidates") or []) if c.get("file") and Path(str(c["file"])).exists()]
        stand_in = str(cands[0]["file"]) if cands else None
    headline_font, subline_font, _ = choose_fonts(profile, stand_in, ws / "website" / "fonts")
    logo_files = [{**f, "path": str(ws / f["path"]) if not Path(str(f["path"])).is_absolute() else f["path"]} for f in (profile.get("logo") or {}).get("files") or []]
    return {"headline": headline_font, "subline": subline_font}, logo_files


FALLBACK_KEY = "T"  # the brand text cards, offered when no composed option passes


def fallback_rows(store: Any, run: Run, ctx: RunContext, profile: dict, ws: Path) -> tuple[list[dict], str | None]:
    """The guaranteed deliverable: the brand's text cards (the video's own composition and frame gate) as stills at every size of the
    run. A static run offers the first card as option T; a carousel offers every card as the slides of T. Returns (rows, failure)."""
    from ..video.make import make_card_stills

    fonts, logo_files = card_assets(profile, ws)
    out_dir = ctx.run_dir / "fallback"
    per_size: dict[str, list] = {}
    for size in ctx.size_list:
        stills, fail = make_card_stills(profile, run.copy, size, fonts, logo_files, out_dir / size.name, only_first=not ctx.is_carousel)
        if fail or not stills:
            return [], fail or "no card could be rendered"
        per_size[size.name] = stills
    n_cards = min(len(v) for v in per_size.values())
    if n_cards == 0 or any(not s.passed for v in per_size.values() for s in v[:n_cards]):
        fails = [f"{name} card {s.index + 1}: {'; '.join(s.failures[:2])}" for name, v in per_size.items() for s in v[:n_cards] if not s.passed]
        return [], "the brand cards failed the frame checks: " + "; ".join(fails)[:600]

    def files_for(card_index: int) -> dict:
        files = {}
        for size in ctx.size_list:
            still = per_size[size.name][card_index]
            name = f"{FALLBACK_KEY}{'' if n_cards == 1 and not ctx.is_carousel else '.' + str(card_index + 1)}-{size.name}.png"
            url = store.upload(run.client_id, run.id, Path(still.png), name)
            files[size.name] = {"url": url, "path": f"designs/{run.client_id}/{run.id}/{name}", "w": size.w, "h": size.h, "passed": True}
        return files

    base = {"run_id": run.id, "client_id": run.client_id, "family_key": None, "arrangement": "cards", "picture_jobs": [], "status": "offered"}
    rank = 1 + sum(1 for o in ctx.options.values() if o.status == "offered" and not o.parent)
    if not ctx.is_carousel:
        return [{**base, "option_key": FALLBACK_KEY, "rank": rank, "kind": "static", "parent_key": None, "slide_role": None, "files": files_for(0),
                 "measurements": {"fallback": True, "copy": per_size[ctx.size_list[0].name][0].headline}}], None
    rows = [{**base, "option_key": FALLBACK_KEY, "rank": rank, "kind": "carousel", "parent_key": None, "slide_role": None, "files": {},
             "measurements": {"fallback": True, "slides": n_cards}}]
    for i in range(n_cards):
        role = "cover" if i == 0 else "closing" if i == n_cards - 1 else "body"
        rows.append({**base, "option_key": f"{FALLBACK_KEY}.{i + 1}", "rank": i + 1, "kind": "slide", "parent_key": FALLBACK_KEY, "slide_role": role,
                     "files": files_for(i), "measurements": {"fallback": True, "copy": per_size[ctx.size_list[0].name][i].headline}})
    return rows, None


def process_video(store: Any, run: Run, profile: dict, ws: Path) -> dict:
    """A video run: text cards from the post copy in the brand, rendered and gated; one option row with the mp4 and a poster."""
    from ..video.make import make_video

    platform, size_list = sizes_for(run.platform, run.format)
    size = size_list[0]
    fonts, logo_files = card_assets(profile, ws)
    out_dir = ws / "video" / f"{time.strftime('%Y%m%d-%H%M%S')}-{run.id[:8]}"
    store.heartbeat(run.id, LEASE_SECONDS, plan={"stage": "pictures", "turn": 1, "options": 1, "pictures": 0, "composed": 0, "passed": 0, "sizes": [size.name]})
    res = make_video(profile, run.copy, size, fonts, logo_files, out_dir)
    sizes = [{"name": size.name, "w": size.w, "h": size.h}]
    if res.status != "ok" or not res.mp4:
        return {"status": "dropped", "spent": {"usd": 0.0, "credits": 0.0}, "sizes": sizes, "failure": res.failure or "the video did not pass the checks",
                "plan": {"stage": "finished", "offered": [], "dropped": [{"id": "V", "reason": res.failure}], "run_dir": str(out_dir)}}
    store.heartbeat(run.id, LEASE_SECONDS, plan={"stage": "checking", "turn": 2, "options": 1, "pictures": 1, "composed": 1, "passed": 1, "sizes": [size.name]})
    mp4_url = store.upload(run.client_id, run.id, res.mp4, f"V-{size.name}.mp4")
    poster_url = store.upload(run.client_id, run.id, res.poster, f"V-{size.name}-poster.jpg") if res.poster else None
    files = {size.name: {"url": mp4_url, "path": f"designs/{run.client_id}/{run.id}/V-{size.name}.mp4", "w": size.w, "h": size.h, "passed": True,
                         "video": True, "seconds": res.seconds, "poster": poster_url}}
    store.write_options([{"run_id": run.id, "client_id": run.client_id, "option_key": "V", "rank": 1, "kind": "video", "family_key": res.family_key,
                          "arrangement": "cards", "files": files, "picture_jobs": [], "measurements": {"video": res.gate, "seconds": res.seconds},
                          "status": "offered"}])
    return {"status": "offered", "spent": {"usd": 0.0, "credits": 0.0}, "sizes": sizes, "failure": None,
            "plan": {"stage": "finished", "offered": ["V"], "dropped": [], "run_dir": str(out_dir)}}


def process(store: Any, run: Run, browser: Any, clients: dict) -> dict:
    """One run end to end; returns the finish payload. Never raises past a run: a failure finishes the run as failed with the reason."""
    try:
        profile = store.confirmed_profile(run.client_id)
        if profile is None:
            raise StoreError("no confirmed brand profile for this client; confirm the brand on the Setup screen first")
        ws = workspace_for(run, profile)
        if is_video_format(run.format):
            with keepalive(store, run.id):
                payload = process_video(store, run, profile, ws)
            store.finish(run.id, payload["status"], payload["spent"], payload["sizes"], payload["failure"], payload["plan"])
            return payload
        ctx = build_context(run, profile, store.rules(run.client_id), store.prior_runs(run.client_id), ws, browser, clients)
        store.heartbeat(run.id, LEASE_SECONDS, plan={"stage": "reading", "sizes": [s.name for s in ctx.size_list]})
        ctx.on_progress = lambda p: store.heartbeat(run.id, LEASE_SECONDS, plan=p)
        with keepalive(store, run.id):  # a turn whose pictures outlast the lease must not be picked up by a second worker
            result = loop.run_post(ctx)
            if not result.options and ctx.budget.max_credits - ctx.spent["credits"] >= SECOND_PASS_MIN_CREDITS:
                # a second pass with a fresh plan: the first pass's reasons become rules it must design around
                reasons = "; ".join(f"{d['id']}: {d['reason']}" for d in result.dropped)[:800] or "nothing passed the gate"
                rules = store.rules(run.client_id) + [f"The previous attempt on this post dropped every option ({reasons}). Choose other families, "
                                                      "calmer picture concepts (plain or softly graded grounds under the copy) and shorter lines."]
                ctx2 = build_context(run, profile, rules, store.prior_runs(run.client_id), ws, browser, clients)
                ctx2.budget = replace(ctx2.budget, max_credits=max(0.0, ctx.budget.max_credits - ctx.spent["credits"]),
                                      max_usd=max(0.5, ctx.budget.max_usd - ctx.spent["usd"]))
                ctx2.run_dir = ctx.run_dir / "pass-2"
                ctx2.on_progress = ctx.on_progress
                result2 = loop.run_post(ctx2)
                first_spent = dict(ctx.spent)
                ctx, result = ctx2, result2
                ctx.spent["credits"] += first_spent.get("credits", 0.0)
                ctx.spent["usd"] = round(ctx.spent["usd"] + first_spent.get("usd", 0.0), 6)
                ctx.spent["turns"] += first_spent.get("turns", 0)
                ctx.spent["first_pass"] = {"credits": first_spent.get("credits", 0.0), "usd": first_spent.get("usd", 0.0), "reasons": reasons}
        rows = option_rows(store, run, ctx, result)
        offered = [o.id for o in result.options]
        reasons = "; ".join(f"{d['id']}: {d['reason']}" for d in result.dropped)[:1000] or "nothing passed the gate"
        note = None
        if not rows:  # nothing composed passed: the brand's own text cards are offered, through the video's renderer and frame gate
            store.heartbeat(run.id, LEASE_SECONDS, plan={**ctx.progress(ctx.spent.get("turns", 0)), "stage": "checking"})
            rows, fb_failure = fallback_rows(store, run, ctx, profile, ws)
            if rows:
                offered = [FALLBACK_KEY]
                note = f"composed options dropped ({reasons}); the brand cards were offered"
            else:
                reasons = f"{reasons}; brand cards: {fb_failure}"
        store.write_options(rows)
        status = "offered" if rows else "dropped"
        payload = {"status": status, "spent": {k: v for k, v in ctx.spent.items() if k != "model_calls"} | {"model_calls": len(ctx.spent.get("model_calls") or [])},
                   "sizes": [{"name": s.name, "w": s.w, "h": s.h} for s in ctx.size_list], "failure": None if rows else reasons,
                   "plan": {"stage": "finished", "offered": offered, "dropped": result.dropped, "run_dir": str(ctx.run_dir), "note": note}}
    except Exception as e:  # noqa: BLE001  the run row carries the reason; the worker lives on
        log.error("run %s failed: %s\n%s", run.id, e, traceback.format_exc())
        payload = {"status": "failed", "spent": {}, "sizes": [], "failure": f"{type(e).__name__}: {e}"[:1000], "plan": {"stage": "failed"}}
    store.finish(run.id, payload["status"], payload["spent"], payload["sizes"], payload["failure"], payload["plan"])
    return payload


@contextlib.contextmanager
def keepalive(store: Any, run_id: str, every: float = KEEPALIVE_SECONDS):
    """Extends the run's lease in the background while the body runs; the plan is left to the per-turn progress heartbeat."""
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(every):
            try:
                store.heartbeat(run_id, LEASE_SECONDS, plan=None)
            except Exception as e:  # noqa: BLE001  a missed beat is logged; the next one may land
                log.warning("keepalive for run %s failed: %s", run_id, e)

    t = threading.Thread(target=beat, name=f"keepalive-{run_id[:8]}", daemon=True)
    t.start()
    try:
        yield
    finally:
        stop.set()
        t.join(timeout=5)


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
