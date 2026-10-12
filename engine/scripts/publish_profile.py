"""Publish a learned brand profile to Socialytics (brand_profiles) through the design store.

    uv run python scripts/publish_profile.py --client "Bader Law" --client-id <uuid> [--version 1] [--confirm]

The profile is the learner's out/profile.json with per-band provenance lists shortened (the full file stays on disk with the
workspace); families keep their slots, bands, exemplars and parameters. --confirm marks it confirmed by the user the store acts for.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_post import slugify

from design_engine.config import settings
from design_engine.worker.store import BridgeStore


def band(b):
    return {k: b[k] for k in ("p25", "p50", "p75", "n") if k in b} if isinstance(b, dict) else b


def compact(p: dict, client_id: str, version: int) -> dict:
    fams = []
    for f in p.get("families") or []:
        if f.get("status") != "family":
            continue
        t = f["template"]
        params = {k: (band(v) if isinstance(v, dict) and "p50" in v else v) for k, v in (f.get("parameters") or {}).items() if k != "ground_hex"}
        params["ground_hex"] = (f.get("parameters") or {}).get("ground_hex", [])[:3]
        slots = {k: {kk: vv for kk, vv in s.items() if kk in ("x", "y", "w", "h", "n", "exemplar", "band")} for k, s in t["slots"].items()}
        fams.append({"key": f["key"], "status": f["status"], "seen_count": f["seen_count"], "post_ids": (f.get("post_ids") or [])[:6],
                     "source": (f.get("source") or [])[:3], "parameters": params,
                     "template": {"slots": slots, "ground": {"kinds": t["ground"].get("kinds"), "hex": t["ground"].get("hex")},
                                  "devices": t.get("devices") or [], "alignment": t.get("alignment"), "picture_role": t.get("picture_role"),
                                  "logo_corner": t.get("logo_corner")}})
    cal = {k: (band(v) if isinstance(v, dict) and "p50" in v else v) for k, v in (p.get("calibration") or {}).items() if k != "measured_on"}
    im = dict(p.get("imagery") or {})
    im["items"] = [{k: v for k, v in it.items() if k != "evidence_post_ids"} for it in im.get("items", [])]
    typ = {k: v for k, v in (p.get("type") or {}).items() if k != "candidates"} | {"candidates": (p.get("type") or {}).get("candidates", [])[:3]}
    car = p.get("carousel") or {}
    return {"client_id": client_id, "client_name": p["client_name"], "version": version, "status": "confirmed", "built_at": p.get("built_at"),
            "palette": p.get("palette"), "observed_pairs": (p.get("observed_pairs") or [])[:12], "type": typ, "logo": p.get("logo"),
            "grammar": {k: (band(v) if isinstance(v, dict) and "p50" in v else v) for k, v in (p.get("grammar") or {}).items()},
            "families": fams, "imagery": im, "calibration": cal,
            "carousel": {"albums": car.get("albums"), "slide_count": band(car.get("slide_count")), "roles": car.get("roles"), "source": car.get("source")},
            "classification": p.get("classification")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", required=True)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument("--confirm", action="store_true")
    args = ap.parse_args()
    ws = settings().work_dir / slugify(args.client)
    profile = json.loads((ws / "out" / "profile.json").read_text())
    body = compact(profile, args.client_id, args.version)
    store = BridgeStore.from_env()
    sources = profile.get("sources") or []
    sources = sources[:20] if isinstance(sources, list) else [sources]
    out = store.publish_profile(args.client_id, body, args.version, args.confirm, sources)
    print(f"published {args.client} v{args.version}: {out.get('profile')} ({len(json.dumps(body))} bytes)")


if __name__ == "__main__":
    main()
