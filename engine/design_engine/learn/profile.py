"""Assemble a brand profile with a source on every token, and validate that no token is unsourced."""
from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from ..ingest.website import SiteRead
from .families import Family
from .grammar import Grammar
from .imagery import Imagery
from .layers import PostRead
from .palette import Pair, Swatch
from .typeface import TypeMatch

TOKEN_KEYS = ("value", "hex", "band", "p50", "files")


def _tok(value, source) -> dict:
    return {"value": value, "source": source}


def build(client: dict, site: SiteRead | None, uploads: list[dict], reads: list[PostRead], palette: list[Swatch], pairs: list[Pair],
          type_match: TypeMatch | None, grammar: Grammar, families: list[Family], imagery: Imagery | None, calibration: dict,
          logo_files: list[dict] | None = None, measured_on: list[str] | None = None) -> dict:
    post_sources = [r.source for r in reads]
    site_src = f"site:{site.url}" if site else None
    pal = []
    for s in palette:
        pal.append({"hex": s.hex, "role": s.role, "share": round(s.share, 4), "source": f"measured:palette over {len(reads)} posts"})
    observed = [{"ink_hex": p.ink_hex, "ground_hex": p.ground_hex, "contrast": round(p.contrast, 2), "source": p.source} for p in pairs]
    if type_match and type_match.verdict == "match":
        type_block = {"status": "resolved", "family": type_match.family, "file": type_match.file, "score": type_match.score,
                      "next_family": type_match.next_family, "next_score": type_match.next_score,
                      "source": f"measured:typeface match of {type_match.samples} headline lines against the brand's font files"}
    else:
        type_block = {"status": "unresolved", "family": None, "file": None,
                      "candidates": [{"family": r["family"], "score": r["score"], "file": r["file"]} for r in (type_match.ranking if type_match else [])][:5],
                      "tie": list(type_match.tie) if type_match else [],
                      "source": "measured:no font file matched the posts' headlines; the client must upload the file or accept a named stand-in"}
    logo_block = {
        "files": logo_files or [],
        "width_share": grammar.logo_width_share,
        "corner_counts": grammar.logo_corner_counts,
        "source": site_src or "upload" if (logo_files) else "measured:none",
    }
    fams = []
    for f in families:
        fams.append({"key": f.key, "status": f.status, "seen_count": f.seen_count, "post_ids": f.post_ids, "signature": asdict(f.signature),
                     "slots": f.slots, "parameters": f.parameters, "template": f.template, "source": f.sources})
    gram = {k: v for k, v in grammar.as_dict().items()}
    for k, v in gram.items():
        if isinstance(v, dict) and "p50" in v:
            v["source"] = v.get("sources", [])
    profile = {
        "client_id": client.get("id"), "client_name": client.get("name"), "version": 1, "status": "draft",
        "built_at": datetime.now(UTC).isoformat(),
        "sources": {"posts": post_sources, "site": site_src, "uploads": [u.get("source") for u in uploads], "measured_on": measured_on or post_sources},
        "palette": pal,
        "observed_pairs": observed,
        "type": type_block,
        "logo": logo_block,
        "grammar": gram,
        "families": fams,
        "imagery": ({"items": imagery.items, "people": imagery.people, "devices": imagery.devices, "grounds": imagery.grounds,
                     "never": imagery.never, "source": f"measured:vision read of {imagery.post_count} posts, items kept only with post evidence"}
                    if imagery else {"items": [], "people": "unknown", "source": "measured:not run"}),
        "voice": {"pillars": client.get("content_pillars") or [], "notes": client.get("brand_notes") or "", "source": "client:clients row"},
        "calibration": {**calibration, "source": f"measured:calibrate over {calibration.get('measured_on', 0)} posts"},
    }
    return profile


def validate(profile: dict) -> list[str]:
    """Paths of tokens that carry a value but no source. Empty means valid."""
    missing: list[str] = []

    def walk(node: Any, path: str):
        if isinstance(node, dict):
            is_token = any(k in node for k in TOKEN_KEYS) and path not in ("sources",)
            if is_token and "source" not in node and "sources" not in node:
                missing.append(path)
                return
            for k, v in node.items():
                if k in ("source", "sources", "band"):
                    continue
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    for key in ("palette", "observed_pairs", "type", "logo", "grammar", "families", "imagery", "calibration"):
        walk(profile.get(key), key)
    return missing
