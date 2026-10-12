"""The run's record on disk: options.json (every option, offered or dropped, with what Task 7 needs to feed prior_runs), spent.json,
per-option measurements.json, the kept renders per size and the pictures with their job ids."""
from __future__ import annotations

import json
import shutil
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from ..gate.distinct import signature


def _jsonable(v: Any) -> Any:
    if is_dataclass(v) and not isinstance(v, type):
        return _jsonable(asdict(v))
    if isinstance(v, Path):
        return str(v)
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def option_record(run_id: str, opt: Any, run_dir: Path, copy_files: bool = True) -> dict:
    """One options.json entry. Renders are copied as design-<run>-<option>-<WxH>.png and pictures as picture-<job>.png into the option's dir."""
    opt_dir = run_dir / opt.id
    opt_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, dict] = {}
    measurements: dict[str, dict] = {}
    sig = opt.distinct_signature
    for size_name, rec in opt.renders.items():
        r, g = rec["rendered"], rec["gate"]
        w, h = (round(r.boxes.get("picture", [0, 0, 0, 0])[2]), round(r.boxes.get("picture", [0, 0, 0, 0])[3])) if r.boxes.get("picture") else (None, None)
        with_size = f"{int(w)}x{int(h)}" if w and h else size_name
        target = opt_dir / f"design-{run_id}-{opt.id}-{with_size}.png"
        if copy_files and Path(r.png).exists() and Path(r.png).resolve() != target.resolve():
            shutil.copyfile(r.png, target)
        files[size_name] = {"png": str(target.relative_to(run_dir)), "source": str(r.png), "w": w, "h": h, "passed": g.passed, "failures": g.failures,
                            "arrangement": rec.get("arrangement"), "picture_index": rec.get("picture_index"), "picture_sha": rec.get("picture_sha"),
                            "margin": rec.get("margin"), "text_px": r.text_px, "pair": r.spec.pair, "logo_variant": r.spec.logo_variant,
                            "boxes": r.boxes}
        measurements[size_name] = {"passed": g.passed, "failures": g.failures, "warnings": g.warnings, "measurements": g.measurements,
                                   "margin": rec.get("margin")}
        size_wh = (g.measurements or {}).get("size")
        if sig is None and r.boxes and size_wh:
            sig = signature(r.boxes, {"w": size_wh[0], "h": size_wh[1]})
    pictures = []
    for p in opt.pictures:
        entry = {"status": p.status, "job_ids": p.job_ids, "credits": p.credits, "spent": p.spent, "prompts": p.prompts,
                 "zone_reads": [{"salient_share": z.salient_share, "ok": z.ok, "floor": z.floor} for z in p.zone_reads], "path": None}
        if p.path and Path(p.path).exists():
            target = opt_dir / f"picture-{p.job_ids[-1] if p.job_ids else Path(p.path).stem}.png"
            if copy_files and Path(p.path).resolve() != target.resolve():
                shutil.copyfile(p.path, target)
            entry["path"] = str(target.relative_to(run_dir))
        pictures.append(entry)
    (opt_dir / "measurements.json").write_text(json.dumps(_jsonable(measurements), indent=1))
    return {"id": opt.id, "run_id": run_id, "status": opt.status, "rank": opt.rank, "family_key": opt.family_key or opt.family.get("key"),
            "arrangement": opt.arrangement, "parts": opt.parts, "bands": opt.bands, "headline": opt.headline, "subline": opt.subline, "footer": getattr(opt, "footer", None), "cta": getattr(opt, "cta", None),
            "picture_concept": opt.picture_brief, "picture_job_ids": opt.job_ids, "credits": opt.credits, "fix_rounds": opt.fix_rounds,
            "dropped_reason": opt.dropped_reason, "signature": sig, "files": files, "pictures": pictures, "unrendered": opt.failures,
            "kind": getattr(opt, "kind", "static"), "slides": list(getattr(opt, "slides", []) or []), "parent": getattr(opt, "parent", None),
            "slide_role": getattr(opt, "slide_role", None)}


def write(run_dir: Path, result: Any) -> dict:
    """Write options.json, spent.json and every option's measurements.json, copying renders and pictures. Returns counts."""
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    run_id = run_dir.name
    states = list(getattr(result, "states", None) or result.options)
    records = [option_record(run_id, o, run_dir) for o in states]
    records.sort(key=lambda r: (r["status"] != "offered", r["rank"] if r["rank"] is not None else 99, r["id"]))
    (run_dir / "options.json").write_text(json.dumps(_jsonable(records), indent=1))
    spent = {**_jsonable(result.spent), "turns": result.turns, "dropped": _jsonable(result.dropped), "offered": [o.id for o in result.options],
             "transcript": str(result.transcript_path) if result.transcript_path else None}
    (run_dir / "spent.json").write_text(json.dumps(spent, indent=1))
    return {"options": len(result.options), "recorded": len(records), "dropped": len(result.dropped), "run_dir": str(run_dir)}


def prior_runs_from(runs_dir: Path) -> list[dict]:
    """What Task 7 feeds `RunContext.prior_runs`: one entry per offered option of every earlier run under work/<slug>/runs, oldest first."""
    out: list[dict] = []
    runs_dir = Path(runs_dir)
    if not runs_dir.exists():
        return out
    for run in sorted(p for p in runs_dir.iterdir() if p.is_dir()):
        f = run / "options.json"
        if not f.exists():
            continue
        for rec in json.loads(f.read_text()):
            if rec.get("status") != "offered":
                continue
            out.append({"run_id": rec.get("run_id") or run.name, "option_id": rec.get("id"), "family_key": rec.get("family_key"),
                        "picture_concept": rec.get("picture_concept"), "signature": rec.get("signature"),
                        "files": [str(run / v["png"]) for v in (rec.get("files") or {}).values() if v.get("png")]})
    return out


__all__ = ["option_record", "prior_runs_from", "write"]
