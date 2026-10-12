"""The seven tools of the per-post run and the context they close over. Each tool is a plain function `tool(ctx, ...)` that the loop
wraps for the model; every rule the spec gives the worker is enforced here, whatever the system prompt says:

- `plan`: at most three options; each names a family or a new arrangement with parts and bands; headline and subline are the post's
  own words; a family or picture concept used in the client's last three runs is refused; a brief naming a logo, text or the brand is
  refused; a headline longer than the family's headline_chars p75 x 1.3 is refused. A refused plan records nothing and spends nothing.
- `picture`: two pictures per option through Task 4's `make_picture` (quiet zone read, one regeneration, then dropped), credits recorded,
  the credit budget checked before every generation. Pictures are stored at the frame's pixel size for the primary platform size
  (object-fit cover), which is exactly what the composer draws, so the quiet zone can be read in frame pixels.
- `compose`: every size x every picture x the family's arrangements, keeping per size the candidate with the best gate margins.
- `measure`: the full gate over every size; one fix round, a second failure drops the option.
- `submit`: re-measures every file, accepts only when all pass, orders the set (margins, then the vision pass) and applies the
  set-level distinctness filter.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from ..compose import place
from ..compose.option import Rendered, assemble
from ..gate.check import (
    BUSY_MAX,
    CONTENT_SPAN_MIN,
    HEADLINE_SHORT_EDGE_SHARE_MIN,
    LOGO_CONTRAST_MIN,
    LOGO_MATCH_MIN,
    PIXEL_COPY_WHOLE,
    TEXT_CONTRAST_MIN,
    GateResult,
)
from ..gate.check import check as gate_check
from ..gate.distinct import Option, filter_set, signature
from ..measure.ocr import read_lines
from ..picture import PictureResult, make_picture
from ..picture import brief as brief_mod
from ..picture.brief import BriefRefused
from ..picture.zone import ZoneRead, floor_from_calibration
from ..platform.specs import Size

MAX_OPTIONS = 3
MAX_CAROUSEL_OPTIONS = 2
SLIDE_MIN_SHARE = 0.6  # a slide's copy length against the family's headline_chars p25
PICTURES_PER_SLIDE = 1
MIN_SLIDES = 2
LETTERING_CONFIDENCE = 0.6
LETTERING_MIN_CHARS = 3
PICTURES_PER_OPTION = 2
FIX_ROUNDS = 1
ROTATION_WINDOW = 3
HEADLINE_LENGTH_FACTOR = 1.3
TEXT_ROLES = ("headline", "subline", "footer")
NEW_ARRANGEMENT_PARTS = ("headline", "subline", "footer", "logo", "picture", "accent")
_QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})


class ToolRefused(ValueError):
    """A tool refused the model's request; the message names the rule and the number."""


class BudgetExceeded(ToolRefused):
    pass


@dataclass
class Budget:
    max_turns: int = 12
    max_usd: float = 5.0
    max_credits: float = 60.0


@dataclass
class OptionState:
    id: str
    family_key: str | None
    family: dict
    arrangement: str  # "family" | "new"
    headline: str
    subline: str | None
    picture_brief: str
    parts: list[str] = field(default_factory=list)
    bands: dict = field(default_factory=dict)
    footer: str | None = None  # the family's bottom-edge line, when it carries one
    kind: str = "static"  # static | carousel (a parent whose slides are child options "<id>.<n>")
    slides: list[str] = field(default_factory=list)  # child option ids, in slide order
    parent: str | None = None  # the carousel this slide belongs to
    slide_role: str | None = None  # cover | body | closing
    status: str = "planned"  # planned | pictured | composed | needs_fix | passed | offered | dropped
    pictures: list[PictureResult] = field(default_factory=list)
    renders: dict[str, dict] = field(default_factory=dict)  # size name -> {rendered, gate, picture, picture_sha, margin, arrangement}
    failures: dict[str, list[str]] = field(default_factory=dict)  # size name -> why nothing could be kept
    fix_rounds: int = 0
    credits: float = 0.0
    dropped_reason: str | None = None
    rank: int | None = None
    distinct_signature: str | None = None

    @property
    def copy(self) -> dict:
        return {"headline": self.headline, "subline": self.subline, "footer": self.footer}

    @property
    def ok_pictures(self) -> list[PictureResult]:
        return [p for p in self.pictures if p.status == "ok" and p.path]

    @property
    def png(self) -> Path | None:
        """The primary size's kept render, for the vision pass and the record."""
        first = next(iter(self.renders.values()), None)
        return first["rendered"].png if first else None

    @property
    def job_ids(self) -> list[str]:
        return [j for p in self.pictures for j in p.job_ids]


@dataclass
class RunContext:
    profile: dict
    families: list[dict]
    reads: list
    workspace: Path
    size_list: list[Size]
    platform: str
    post: dict  # copy, format, pillar, post_key, ...
    prior_runs: list[dict] = field(default_factory=list)  # {run_id, family_key, picture_concept, signature, files}
    budget: Budget = field(default_factory=Budget)
    clients: dict = field(default_factory=dict)  # "anthropic", "higgsfield"
    fonts: dict[str, Path] = field(default_factory=dict)
    logo_files: list[dict] = field(default_factory=list)
    run_dir: Path | None = None
    ocr: Callable = read_lines
    references: list[Path] = field(default_factory=list)  # the client's stored posts, for near-copy in measure and submit
    picture_references: list[Path] = field(default_factory=list)
    prior_files: list[Path] = field(default_factory=list)  # earlier deliveries
    browser: Any = None  # one Chromium for every render; assemble launches its own when None
    floor: float | None = None  # occlusion floor; from the calibration when None
    rank_with_vision: bool = True
    host_reference: Callable[[Path], str | None] | None = None  # a local crop -> a URL Higgsfield can import; None sends no references
    model: str = "claude-opus-5-5"
    # run state
    options: dict[str, OptionState] = field(default_factory=dict)
    spent: dict = field(default_factory=lambda: {"usd": 0.0, "credits": 0.0, "turns": 0, "warnings": [], "model_calls": []})
    dropped: list[dict] = field(default_factory=list)
    submitted: list[OptionState] | None = None
    done: bool = False
    files: dict[str, dict] = field(default_factory=dict)  # png path -> {option_id, size, boxes, copy, picture_sha}
    nearest: list[dict] = field(default_factory=list)
    transcript: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.workspace = Path(self.workspace)
        self.logo_files = [{**f, "path": str(self._abs(f["path"]))} for f in self.logo_files if f.get("path")]
        self.fonts = {k: Path(v) for k, v in self.fonts.items()}
        if self.run_dir is None:
            self.run_dir = self.workspace / "runs" / time.strftime("%Y%m%d-%H%M%S")
        self.run_dir = Path(self.run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        if self.floor is None:
            self.floor = floor_from_calibration(self.profile.get("calibration"))
        if not self.size_list:
            raise ValueError("a run needs at least one platform size")

    def _abs(self, p: str | Path) -> Path:
        p = Path(p)
        return p if p.is_absolute() else self.workspace / p

    @property
    def primary(self) -> Size:
        return self.size_list[0]

    @property
    def is_carousel(self) -> bool:
        return str(self.post.get("format") or "").strip().lower() == "carousel"

    def children(self, opt: OptionState) -> list[OptionState]:
        return [self.options[c] for c in opt.slides if c in self.options]

    @property
    def copy_text(self) -> str:
        return str(self.post.get("copy") or "")

    @property
    def brand_name(self) -> str | None:
        return self.profile.get("client_name") or None

    def recent_runs(self) -> list[dict]:
        return list(self.prior_runs)[-ROTATION_WINDOW:]

    def recent_signatures(self) -> list[str]:
        return [r["signature"] for r in self.recent_runs() if isinstance(r, dict) and r.get("signature")]

    def option_dir(self, option_id: str) -> Path:
        d = self.run_dir / option_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def drop(self, opt: OptionState, reason: str) -> None:
        opt.status = "dropped"
        opt.dropped_reason = reason
        if not any(d["id"] == opt.id for d in self.dropped):
            self.dropped.append({"id": opt.id, "reason": reason, "family_key": opt.family_key, "credits": opt.credits})
        for cid in opt.slides:
            child = self.options.get(cid)
            if child is not None and child.status != "dropped":
                child.status, child.dropped_reason = "dropped", f"its carousel {opt.id} was dropped: {reason}"


# ---- helpers ----


def _norm(text: str | None) -> str:
    return " ".join((text or "").translate(_QUOTES).split())


def reading_order(family: dict) -> str:
    """subline_first when the family's subline slot sits wholly above its headline slot (a kicker line), headline_first when wholly
    below, unknown otherwise (side by side, or no subline slot)."""
    slots = (family.get("template") or {}).get("slots") or {}
    h, s_ = slots.get("headline"), slots.get("subline")
    if not h or not s_:
        return "unknown"
    sc, hc = float(s_["y"]) + float(s_["h"]) / 2, float(h["y"]) + float(h["h"]) / 2
    if sc < float(h["y"]):  # the subline's centre is above the headline block: a kicker
        return "subline_first"
    if sc > float(h["y"]) + float(h["h"]):
        return "headline_first"
    return "unknown"


def _band(b: Mapping | None) -> dict | None:
    if not isinstance(b, Mapping):
        return None
    return {k: (round(b[k], 4) if isinstance(b.get(k), (int, float)) else b.get(k)) for k in ("p25", "p50", "p75", "n") if k in b}


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:12]


def _option(ctx: RunContext, option_id: str) -> OptionState:
    opt = ctx.options.get(str(option_id))
    if opt is None:
        raise ToolRefused(f"unknown option {option_id!r}; planned options are {', '.join(ctx.options) or 'none'}")
    if opt.status == "dropped":
        raise ToolRefused(f"option {opt.id} was dropped: {opt.dropped_reason}")
    return opt


def _family_summary(fam: dict) -> dict:
    params = fam.get("parameters") or {}
    tpl = fam.get("template") or {}
    chars = _band(params.get("headline_chars"))
    return {
        "key": fam.get("key"), "status": fam.get("status"), "seen_count": fam.get("seen_count"),
        "alignment": tpl.get("alignment"), "picture_role": tpl.get("picture_role"), "logo_corner": tpl.get("logo_corner"),
        "devices": tpl.get("devices") or [], "ground": {"kinds": (tpl.get("ground") or {}).get("kinds"), "hex": (tpl.get("ground") or {}).get("hex")},
        "slots": {s: {k: round(float(v[k]), 3) for k in ("x", "y", "w", "h") if isinstance(v.get(k), (int, float))}
                  for s, v in (tpl.get("slots") or {}).items()},
        "headline_chars": chars, "headline_lines": _band(params.get("headline_lines")),
        "headline_max_chars": math.floor(chars["p75"] * HEADLINE_LENGTH_FACTOR) if chars and isinstance(chars.get("p75"), (int, float)) else None,
    }


def _widest_headline_band(families: list[dict]) -> dict | None:
    bands = [f.get("parameters", {}).get("headline_chars") for f in families]
    bands = [b for b in bands if isinstance(b, Mapping) and isinstance(b.get("p75"), (int, float))]
    return max(bands, key=lambda b: b["p75"]) if bands else None


def _palette_hex(profile: dict, role: str) -> str | None:
    for s in profile.get("palette") or []:
        if s.get("role") == role and s.get("hex"):
            return s["hex"]
    return None


def _corner(band: Mapping) -> str:
    cx, cy = band["x"] + band["w"] / 2, band["y"] + band["h"] / 2
    return ("t" if cy < 0.4 else "b" if cy > 0.6 else "m") + ("l" if cx < 0.4 else "r" if cx > 0.6 else "c")


def new_family(ctx: RunContext, option_id: str, parts: list[str], bands: Mapping[str, Mapping], alignment: str | None = None) -> dict:
    """A one-off family for `arrangement: new`: slots from the model's bands, the brand's ground and accent, the widest observed
    headline band as its length cap. It renders through the same template as a learned family."""
    slots = {p: {k: float(bands[p][k]) for k in ("x", "y", "w", "h")} for p in parts}
    pic = slots.get("picture")
    if pic is None:
        role = "none"
    elif pic["w"] * pic["h"] > 0.8:
        role = "full"
    elif pic["w"] > 0.7:
        role = "top" if pic["y"] + pic["h"] / 2 < 0.5 else "bottom"
    else:
        role = "side" if pic["h"] > 0.5 else "inset"
    acc = slots.get("accent")
    side = ("left" if acc["x"] < 0.5 else "right") if acc and acc["h"] >= acc["w"] else ("top" if acc and acc["y"] < 0.5 else "bottom")
    ground = _palette_hex(ctx.profile, "ground") or "#000000"
    counts = (ctx.profile.get("grammar") or {}).get("alignment_counts") or {}
    align = alignment or (max(counts, key=counts.get) if counts else "left")
    key = f"new:{option_id}"
    return {
        "key": key, "status": "new", "seen_count": 0, "post_ids": [],
        "slots": slots,
        "parameters": {"alignment": align, "headline_chars": _widest_headline_band(ctx.families) or {}, "headline_lines": {},
                       "device_on": acc is not None, "ground_hex": [ground], "accent_hex": _palette_hex(ctx.profile, "accent"),
                       "aspect": ctx.primary.w / ctx.primary.h},
        "template": {"slots": slots, "ground": {"kinds": ["photo"] if pic else ["flat"], "hex": ground, "sources": []},
                     "devices": [{"kind": "accent", "side": side}] if acc else [], "alignment": align, "picture_role": role,
                     "logo_corner": _corner(slots["logo"]) if "logo" in slots else "none"},
    }


# ---- read_brand ----


def _carousel_brief(profile: dict) -> dict:
    c = profile.get("carousel") or {}
    sc = c.get("slide_count") or {}
    return {"albums": c.get("albums", 0), "slide_count": {k: sc.get(k) for k in ("p25", "p50", "p75")},
            "role_families": {role: [e["key"] for e in (c.get("roles") or {}).get(role, [])] for role in ("cover", "body", "closing")},
            "rules": ["one option = one set of slides; slide 1 uses a cover family, the last slide a closing family when the client has one, "
                      "every other slide one and the same body family (one grid); slide count inside the client's band; each slide's lines are the "
                      "post copy's own words in copy order; a slide on a family without a picture takes picture_brief null; one picture per slide"]}


def read_brand(ctx: RunContext) -> dict:
    """The confirmed profile in brief, the families, the floors, the standing rules, the post, the sizes and the last three runs."""
    p = ctx.profile
    grammar = p.get("grammar") or {}
    imagery = p.get("imagery") or {}
    cal = p.get("calibration") or {}
    return {
        "client": p.get("client_name"),
        "profile_status": p.get("status"),
        "type": {k: (p.get("type") or {}).get(k) for k in ("status", "family", "file", "accepted_stand_in")},
        "palette": [{"hex": s.get("hex"), "role": s.get("role")} for s in p.get("palette") or []],
        "observed_pairs": [{"ink_hex": q.get("ink_hex"), "ground_hex": q.get("ground_hex"), "contrast": q.get("contrast")} for q in (p.get("observed_pairs") or [])[:8]],
        "grammar": {k: _band(grammar.get(k)) for k in ("headline_h_share", "subline_h_share", "side_margin", "logo_width_share") if grammar.get(k)}
        | {"alignment_counts": grammar.get("alignment_counts"), "logo_corner_counts": grammar.get("logo_corner_counts")},
        "imagery": {"items": [{"kind": it.get("kind"), "description": it.get("description")} for it in imagery.get("items") or []],
                    "people": imagery.get("people"), "grounds": imagery.get("grounds"), "never": imagery.get("never")},
        "voice": p.get("voice"),
        "floors": cal.get("floors"),
        "carousel": _carousel_brief(p) if ctx.is_carousel else None,
        "occlusion_floor": ctx.floor,
        "families": [_family_summary(f) for f in ctx.families],
        "rules": list(p.get("rules") or p.get("design_rules") or []),
        "last_three_runs": [{"run_id": r.get("run_id"), "family_key": r.get("family_key") or r.get("family_id"),
                             "picture_concept": r.get("picture_concept") or r.get("picture_brief")} for r in ctx.recent_runs()],
        "post": {"copy": ctx.copy_text, "pillar": ctx.post.get("pillar"), "format": ctx.post.get("format"), "platform": ctx.platform,
                 "visual_direction": ctx.post.get("visual_direction")},
        "sizes": [{"name": s.name, "w": s.w, "h": s.h, "placement": s.placement, "min_text_px": s.min_text_px} for s in ctx.size_list],
        "limits": {"max_options": MAX_OPTIONS, "pictures_per_option": PICTURES_PER_OPTION, "fix_rounds": FIX_ROUNDS,
                   "credits_left": max(0.0, ctx.budget.max_credits - ctx.spent["credits"])},
    }


# ---- nearest_posts ----


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9']+", (text or "").lower()) if len(t) > 1]


def _read_dict(r: Any) -> dict:
    if isinstance(r, Mapping):
        return dict(r)
    logo = getattr(r, "logo", None)
    return {"path": str(getattr(r, "path", "")), "source_post_id": getattr(r, "source_post_id", ""), "W": getattr(r, "W", None),
            "H": getattr(r, "H", None), "lines": [{"text": line.text, "box": line.box} for line in getattr(r, "lines", [])],
            "logo": {"box": logo.box, "height_share": logo.height_share, "variant": logo.variant} if logo else None,
            "ground": getattr(r, "ground", {}), "picture_boxes": getattr(r, "picture_boxes", [])}


def _measurements_for(ctx: RunContext, post_id: str) -> dict | None:
    for r in ctx.reads:
        d = _read_dict(r)
        if d.get("source_post_id") == post_id:
            logo = d.get("logo") or {}
            return {"W": d.get("W"), "H": d.get("H"), "logo_height_share": logo.get("height_share"), "logo_variant": logo.get("variant"),
                    "ground": d.get("ground"), "lines": len(d.get("lines") or []), "pictures": len(d.get("picture_boxes") or []),
                    "path": d.get("path")}
    return None


def nearest_posts(ctx: RunContext, copy: str, k: int = 4) -> list[dict]:
    """The client's own posts closest to this copy: cosine over TF-IDF of the text in posts_index.json, with each post's family
    (by membership) and measurements (from the reads) as exemplars."""
    index_path = ctx.workspace / "posts_index.json"
    if not index_path.exists():
        return []
    entries: dict[str, dict] = {}
    for e in json.loads(index_path.read_text()).values():
        pid = e.get("source_post_id")
        if pid and pid not in entries and e.get("text"):
            entries[pid] = e
    if not entries:
        return []
    docs = {pid: _tokens(e["text"]) for pid, e in entries.items()}
    df: dict[str, int] = {}
    for toks in docs.values():
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    n = len(docs)

    def vec(toks: list[str]) -> dict[str, float]:
        tf: dict[str, float] = {}
        for t in toks:
            tf[t] = tf.get(t, 0.0) + 1.0
        return {t: c * math.log((1 + n) / (1 + df.get(t, 0))) + 1e-9 for t, c in tf.items()}

    def cos(a: dict[str, float], b: dict[str, float]) -> float:
        dot = sum(v * b[t] for t, v in a.items() if t in b)
        na, nb = math.sqrt(sum(v * v for v in a.values())), math.sqrt(sum(v * v for v in b.values()))
        return dot / (na * nb) if na and nb else 0.0

    q = vec(_tokens(copy))
    scored = sorted(((cos(q, vec(toks)), pid) for pid, toks in docs.items()), key=lambda s: (-s[0], s[1]))
    by_post = {pid: f.get("key") for f in ctx.families for pid in f.get("post_ids") or []}
    out = []
    for score, pid in scored[: max(1, int(k))]:
        e = entries[pid]
        out.append({"source_post_id": pid, "path": str(ctx._abs(e["path"])), "similarity": round(score, 4), "platform": e.get("platform"),
                    "text": (e.get("text") or "")[:240], "family_key": by_post.get(pid), "measurements": _measurements_for(ctx, pid)})
    ctx.nearest = out
    return out


# ---- plan ----


def _check_option(ctx: RunContext, i: int, o: Mapping, recent_families: set[str], recent_concepts: set[str],
                  allow_no_picture: bool = False) -> tuple[OptionState | None, list[str]]:
    problems: list[str] = []
    oid = str(o.get("id") or f"o{i + 1}")
    arrangement = str(o.get("arrangement") or ("new" if not o.get("family_key") else "family")).lower()
    family: dict | None = None
    fkey = o.get("family_key")
    if arrangement == "new":
        parts = [str(p) for p in (o.get("parts") or [])]
        bands = o.get("bands") or {}
        bad = [p for p in parts if p not in NEW_ARRANGEMENT_PARTS]
        if bad:
            problems.append(f"{oid}: unknown parts {bad}; parts are {', '.join(NEW_ARRANGEMENT_PARTS)}")
        if "headline" not in parts or "logo" not in parts:
            problems.append(f"{oid}: a new arrangement needs at least the headline and the logo among its parts")
        for p in parts:
            b = bands.get(p) if isinstance(bands, Mapping) else None
            if not isinstance(b, Mapping) or any(not isinstance(b.get(k), (int, float)) or not 0 <= float(b[k]) <= 1 for k in ("x", "y", "w", "h")):
                problems.append(f"{oid}: part {p!r} needs a band with x, y, w, h as fractions of the frame")
        if not problems:
            family = new_family(ctx, oid, parts, bands, o.get("alignment"))
            fkey = None
    else:
        if not fkey:
            problems.append(f"{oid}: name a family_key or set arrangement to \"new\" with parts and bands")
        else:
            family = next((f for f in ctx.families if f.get("key") == fkey), None)
            if family is None:
                problems.append(f"{oid}: unknown family {fkey!r}")
            elif "headline" not in (family.get("template") or {}).get("slots", {}):
                problems.append(f"{oid}: family {fkey!r} has no headline slot to typeset into")
            elif fkey in recent_families:
                problems.append(f"{oid}: family {fkey!r} was used in one of the client's last three runs; rotate to another")
        parts, bands = [], {}
    headline = o.get("headline")
    subline = o.get("subline") or None
    footer = o.get("footer") or None
    copy = _norm(ctx.copy_text).lower()  # capitalising a line's first word is not rewriting
    if not isinstance(headline, str) or not headline.strip():
        problems.append(f"{oid}: a headline is required")
    else:
        if _norm(headline).lower() not in copy:
            problems.append(f"{oid}: the headline must be the post copy's own words (a substring or line-join of the post copy): {headline!r}")
        p75 = ((family or {}).get("parameters") or {}).get("headline_chars", {}).get("p75") if family else None
        if isinstance(p75, (int, float)) and len(_norm(headline)) > p75 * HEADLINE_LENGTH_FACTOR:
            problems.append(f"{oid}: headline of {len(_norm(headline))} characters is longer than the family's {p75:.0f} x {HEADLINE_LENGTH_FACTOR} = "
                            f"{p75 * HEADLINE_LENGTH_FACTOR:.0f}; shorten it")
    if subline is not None and _norm(str(subline)).lower() not in copy:
        problems.append(f"{oid}: the subline must be the post copy's own words: {subline!r}")
    if footer is not None and _norm(str(footer)).lower() not in copy:
        problems.append(f"{oid}: the footer must be the post copy's own words: {footer!r}")
    if family is not None and isinstance(headline, str) and subline:
        order = reading_order(family)
        hi, si = copy.find(_norm(headline).lower()), copy.find(_norm(str(subline)).lower())
        if order == "subline_first" and hi >= 0 and si > hi:
            problems.append(f"{oid}: in family {family.get('key')!r} the subline sits above the headline (a kicker), so it must come before the "
                            "headline in the post copy; swap them or choose a line that precedes the headline")
        if order == "headline_first" and hi >= 0 and 0 <= si < hi:
            problems.append(f"{oid}: in family {family.get('key')!r} the subline sits below the headline, so it must follow the headline in the post copy")
    if family is not None and "footer" in ((family.get("template") or {}).get("slots") or {}) and not footer:
        problems.append(f"{oid}: family {family.get('key')!r} carries a footer line at the bottom edge in the client's posts; give a `footer` from the "
                        "post copy (a short closing line) or choose another family")
    concept = o.get("picture_brief") or o.get("picture_concept") or ""
    no_picture_family = family is not None and ((family.get("template") or {}).get("picture_role", "none") == "none")
    if not isinstance(concept, str) or not concept.strip():
        if not (allow_no_picture and no_picture_family):
            problems.append(f"{oid}: a picture_brief concept is required" + (" (null is allowed only on a family without a picture)" if allow_no_picture else ""))
        concept = ""
    else:
        try:
            brief_mod.check(concept, ctx.brand_name)
        except BriefRefused as e:
            problems.append(f"{oid}: {e}")
        if _norm(concept).lower() in recent_concepts:
            problems.append(f"{oid}: the picture concept was used in one of the client's last three runs; choose another")
    if problems or family is None:
        return None, problems
    return OptionState(oid, fkey, family, arrangement if arrangement == "new" else "family", str(headline).strip(),
                       str(subline).strip() if subline else None, concept.strip(), parts, dict(bands) if bands else {},
                       footer=str(footer).strip() if footer else None), []


def _check_carousel(ctx: RunContext, i: int, o: Mapping, recent_families: set[str], recent_concepts: set[str]) -> tuple[list[OptionState], list[str]]:
    """A carousel option: `slides` as a list of {family_key, headline, subline?, footer?, picture_brief|null}. The parent and its slide
    children are returned together; every rule of a static applies to each slide, and the set rules apply on top."""
    oid = str(o.get("id") or f"o{i + 1}")
    slides = o.get("slides")
    problems: list[str] = []
    car = ctx.profile.get("carousel") or {}
    band_ = car.get("slide_count") or {}
    lo = max(MIN_SLIDES, int(round(band_.get("p25") or MIN_SLIDES)))
    hi = int(round(band_.get("p75") or max(lo, 5)))
    if not isinstance(slides, list) or not slides:
        return [], [f"{oid}: a carousel option needs `slides`"]
    if not lo <= len(slides) <= hi:
        problems.append(f"{oid}: {len(slides)} slides is outside the client's slide-count band {lo}..{hi}")
    roles_ok = {r: {e["key"] for e in (car.get("roles") or {}).get(r, [])} for r in ("cover", "body", "closing")}
    children: list[OptionState] = []
    body_keys: set[str] = set()
    copy = _norm(ctx.copy_text).lower()
    last_pos = -1
    for n, sl in enumerate(slides):
        if not isinstance(sl, Mapping):
            problems.append(f"{oid}: slide {n + 1} is not an object")
            continue
        role = "cover" if n == 0 else "closing" if (n == len(slides) - 1 and roles_ok["closing"]) else "body"
        cid = f"{oid}.{n + 1}"
        fkey = sl.get("family_key")
        if fkey and roles_ok[role] and fkey not in roles_ok[role]:
            problems.append(f"{cid}: family {fkey!r} does not serve the {role} role in the client's albums; {role} families are {sorted(roles_ok[role])}")
        if role == "body" and fkey:
            body_keys.add(str(fkey))
        child, probs = _check_option(ctx, n, {**sl, "id": cid, "arrangement": "family"}, set(), recent_concepts, allow_no_picture=True)
        problems.extend(probs)
        if child:
            # a slide carries as much copy as the family's posts do: a fragment leaves the family's text area empty and fails the gate
            p25 = ((child.family.get("parameters") or {}).get("headline_chars") or {}).get("p25")
            total = len(_norm(child.headline)) + len(_norm(child.subline or ""))
            if isinstance(p25, (int, float)) and p25 > 0 and total < SLIDE_MIN_SHARE * float(p25):
                problems.append(f"{cid}: {total} characters of copy is under the family's measure ({p25:.0f} x {SLIDE_MIN_SHARE} = {p25 * SLIDE_MIN_SHARE:.0f}); "
                                "give the slide a fuller line or pair it with a subline")
            child.parent, child.slide_role, child.kind = oid, role, "static"
            children.append(child)
            pos = copy.find(_norm(child.headline).lower())
            if pos >= 0 and pos < last_pos:
                problems.append(f"{cid}: the slides must follow the post copy's order; this headline comes before the previous slide's in the copy")
            last_pos = max(last_pos, pos)
    if len(body_keys) > 1:
        problems.append(f"{oid}: every body slide must use one and the same family (one grid); got {sorted(body_keys)}")
    if problems:
        return [], problems
    parent = OptionState(oid, None, {"key": f"carousel:{oid}", "template": {"slots": {}}, "parameters": {}}, "family", children[0].headline if children else "",
                         None, children[0].picture_brief if children else "", kind="carousel", slides=[c.id for c in children])
    parent.family_key = f"carousel:{'+'.join(sorted({c.family_key or '' for c in children}))}"
    return [parent, *children], []


def plan(ctx: RunContext, options: list[dict]) -> dict:
    """Record the model's plan after every rule passes; refuse the whole plan otherwise, with nothing recorded and nothing spent.
    Re-planning an existing option id is the fix round: it keeps the option's credits and pictures when the brief is unchanged."""
    if not isinstance(options, list) or not options:
        raise ToolRefused("plan refused: options must be a non-empty list")
    if len(options) > MAX_OPTIONS:
        raise ToolRefused(f"plan refused: at most {MAX_OPTIONS} options per run, got {len(options)}")
    recent = ctx.recent_runs()
    recent_families = {str(r.get("family_key") or r.get("family_id")) for r in recent if r.get("family_key") or r.get("family_id")}
    recent_concepts = {_norm(r.get("picture_concept") or r.get("picture_brief")).lower() for r in recent if r.get("picture_concept") or r.get("picture_brief")}
    built: list[OptionState] = []
    problems: list[str] = []
    for i, o in enumerate(options):
        if not isinstance(o, Mapping):
            problems.append(f"option {i + 1} is not an object")
            continue
        if ctx.is_carousel or o.get("slides"):
            if not ctx.is_carousel:
                problems.append(f"option {i + 1}: this post is a {ctx.post.get('format') or 'Single Image'}, not a carousel; no slides")
                continue
            group, probs = _check_carousel(ctx, i, o, recent_families, recent_concepts)
            problems.extend(probs)
            built.extend(group)
            continue
        opt, probs = _check_option(ctx, i, o, recent_families, recent_concepts)
        problems.extend(probs)
        if opt:
            built.append(opt)
    ids = [o.id for o in built]
    if len(set(ids)) != len(ids):
        problems.append(f"option ids repeat: {ids}")
    top_ids = {o.id for o in built if o.parent is None}
    live = {k for k, v in ctx.options.items() if v.status != "dropped" and v.parent is None}
    limit = MAX_CAROUSEL_OPTIONS if ctx.is_carousel else MAX_OPTIONS
    if len(live | top_ids) > limit:
        problems.append(f"at most {limit} options per run; {sorted(live)} already exist, reuse their ids to re-plan them")
    if problems:
        raise ToolRefused("plan refused: " + "; ".join(problems))
    for opt in built:
        old = ctx.options.get(opt.id)
        if old is not None:
            opt.fix_rounds, opt.credits = old.fix_rounds, old.credits
            if old.status == "dropped":
                raise ToolRefused(f"plan refused: option {opt.id} was dropped ({old.dropped_reason}); use a new id")
            if _norm(old.picture_brief) == _norm(opt.picture_brief) and old.family_key == opt.family_key and old.arrangement == opt.arrangement:
                opt.pictures = old.pictures
        if old is not None and old.kind == "carousel":  # a re-planned carousel drops the slides it no longer has
            for cid in old.slides:
                if cid not in {b.id for b in built} and cid in ctx.options:
                    ctx.options[cid].status = "dropped"
                    ctx.options[cid].dropped_reason = "re-planned"
        ctx.options[opt.id] = opt
    return {"accepted": [o.id for o in built if o.parent is None],
            "options": [{"id": o.id, "kind": o.kind, "slides": o.slides or None, "slide_role": o.slide_role, "family_key": o.family_key,
                         "arrangement": o.arrangement, "headline": o.headline, "subline": o.subline, "footer": o.footer,
                         "picture_brief": o.picture_brief or None, "fix_rounds_used": o.fix_rounds} for o in built],
            "next": "call picture(option_id) for each option (a carousel id covers all its slides), then compose, measure and submit"}


# ---- picture ----


def quiet_zone(family: dict, slots: tuple[str, ...] = ("headline", "subline", "footer", "logo")) -> dict | None:
    """The part of the picture the text and logo cover, as fractions of the PICTURE (the brief names "the lower 40%" of the picture
    it asks for, and the dry run flattens that region of the picture it hands back): the union of the slots that overlap the
    family's picture area at their median position, mapped into the picture box. None when the family carries no picture or no
    text sits on it (a picture above a text panel, say): then nothing in the picture needs to stay calm."""
    tpl = family.get("template") or {}
    role = tpl.get("picture_role", "none")
    if role == "none":
        return None
    tpl_slots = tpl.get("slots", {})
    if role == "full" or "picture" not in tpl_slots:
        pic = (0.0, 0.0, 1.0, 1.0)
    else:
        ps = tpl_slots["picture"]
        pic = (float(ps["x"]), float(ps["y"]), float(ps["w"]), float(ps["h"]))
    boxes = []
    for k, s_ in tpl_slots.items():
        if k not in slots:
            continue
        b = (float(s_["x"]), float(s_["y"]), float(s_["w"]), float(s_["h"]))
        ix0, iy0 = max(b[0], pic[0]), max(b[1], pic[1])
        ix1, iy1 = min(b[0] + b[2], pic[0] + pic[2]), min(b[1] + b[3], pic[1] + pic[3])
        if ix1 - ix0 > 0.01 and iy1 - iy0 > 0.01:
            boxes.append((ix0, iy0, ix1 - ix0, iy1 - iy0))
    if not boxes:
        return None
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[0] + b[2] for b in boxes), max(b[1] + b[3] for b in boxes)
    return {"x": (x0 - pic[0]) / pic[2], "y": (y0 - pic[1]) / pic[3], "w": (x1 - x0) / pic[2], "h": (y1 - y0) / pic[3]}


def arrangements_for(opt: OptionState) -> list:
    """The arrangements compose tries for an option: every named one for a family arrangement, the exemplar alone otherwise. An
    alternative exemplar whose reading order differs from the family's (a kicker where the family reads headline first) is left
    out: the copy was planned for the family's order."""
    if opt.arrangement != "family":
        return ["p50"]
    base = reading_order(opt.family)
    out = []
    for name in place.NAMED:
        fam = opt.family if name == "p50" else _family_at(opt.family, name)
        if name == "p50" or reading_order(fam) == base or base == "unknown":
            out.append(name)
    return out


def _family_at(family: dict, arrangement: str) -> dict:
    """The family with its slots at a named alternative arrangement (the next exemplar's boxes), for rules that read slot geometry."""
    import copy as copy_mod

    fam = copy_mod.deepcopy(family)
    for slot in (fam.get("template") or {}).get("slots", {}).values():
        band = slot.get("band") or {}
        for c in ("x", "y", "w", "h"):
            v = band.get(c, {}).get(arrangement)
            if isinstance(v, (int, float)) and ("exemplar" in slot or c in ("x", "y")):
                slot[c] = float(v)
    return fam


def picture_reader(ctx: RunContext, opt: OptionState) -> Callable[[Path], ZoneRead]:
    """Judges a picture exactly as compose will place text on it: the busiest text or logo slot over the option's arrangements,
    the quietest arrangement deciding. A family whose text never sits on the picture reads 0 and always passes."""
    cands = arrangements_for(opt)

    def read(path: Path) -> ZoneRead:
        lettered = [ln for ln in ctx.ocr(path) if ln.confidence >= LETTERING_CONFIDENCE and sum(c.isalnum() for c in ln.text) >= LETTERING_MIN_CHARS]
        if lettered:  # a picture never carries lettering: the copy and the mark are the layout's, and the gate reads copy by OCR
            return ZoneRead(salient_share=1.0, ok=False, floor=float(ctx.floor),
                            reason="lettering in the picture: " + "; ".join(repr(ln.text) for ln in lettered[:3]))
        ranked = place.rank(opt.family, ctx.primary, path, ctx.floor, cands)
        if not ranked:
            return ZoneRead(salient_share=0.0, ok=True, floor=float(ctx.floor))
        best = ranked[0]
        return ZoneRead(salient_share=best.share, ok=best.ok, floor=float(ctx.floor), reason="" if best.ok else "busy under the text")

    return read


class _FramedClient:
    """Delegates to the Higgsfield client and stores every downloaded picture at the frame's pixel size (object-fit cover, centred), so
    the quiet zone can be read in the same pixels the composer draws."""

    def __init__(self, inner: Any, w: int, h: int):
        self.inner, self.w, self.h = inner, int(w), int(h)
        if hasattr(inner, "frame_to"):  # a stand-in that paints its own pictures draws them at the picture's size
            inner.frame_to(self.w, self.h)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def download(self, url: str, out: Path) -> Path:
        path = Path(self.inner.download(url, out))
        with Image.open(path) as im:
            im = im.convert("RGB")
            scale = max(self.w / im.width, self.h / im.height)
            rw, rh = max(self.w, round(im.width * scale)), max(self.h, round(im.height * scale))
            im = im.resize((rw, rh), Image.Resampling.LANCZOS)
            left, top = (rw - self.w) // 2, (rh - self.h) // 2
            im.crop((left, top, left + self.w, top + self.h)).save(path)
        return path


def picture(ctx: RunContext, option_id: str) -> dict:
    """Two measured pictures for an option through Task 4's make_picture (one per slide of a carousel). Every generation is preceded
    by the budget check and recorded on the option and on spent["credits"]; a picture whose text slots stay busy after one
    regeneration is dropped. The picture is judged the way compose will place the text on it, so the two never disagree."""
    opt = _option(ctx, option_id)
    if opt.kind == "carousel":
        out = {"option_id": opt.id, "slides": {}}
        for child in ctx.children(opt):
            if child.status == "dropped":
                out["slides"][child.id] = {"status": "dropped", "reason": child.dropped_reason}
                continue
            if place.picture_box(child.family, ctx.primary, "p50") is None:
                out["slides"][child.id] = {"status": "no_picture_family"}
                continue
            out["slides"][child.id] = picture(ctx, child.id)
        dropped = [c.id for c in ctx.children(opt) if c.status == "dropped"]
        if dropped:
            ctx.drop(opt, f"slides dropped: {', '.join(dropped)}")
            out["status"] = "dropped"
        else:
            out["status"] = "ok"
        out["credits_spent_total"] = ctx.spent["credits"]
        return out
    client = ctx.clients.get("higgsfield")
    if client is None:
        raise ToolRefused("no Higgsfield client on this run; pictures cannot be made")
    fam = opt.family
    primary = ctx.primary
    pic_box = place.picture_box(fam, primary, "p50")
    if pic_box is None:
        raise ToolRefused(f"family {opt.family_key!r} carries no picture (picture_role none): call compose({opt.id!r}) directly, it renders the "
                          "ground, the device, the copy and the logo")
    zone = quiet_zone(fam)
    out_dir = ctx.option_dir(opt.id)
    brief = brief_mod.build(ctx.profile, fam, zone, opt.picture_brief, ctx.platform, reads=ctx.reads or None, ref_dir=out_dir / "refs",
                            picture_aspect=(pic_box[2] / pic_box[3]) if pic_box[3] > 0 else None)
    if ctx.host_reference:
        brief.reference_urls = [u for u in (ctx.host_reference(p) for p in brief.reference_paths) if u]
    elif hasattr(client, "upload"):  # no public host: the crops go straight into Higgsfield's storage
        brief.reference_media_ids = [m for m in (client.upload(p) for p in brief.reference_paths) if m]
    pw, ph = round(pic_box[2]), round(pic_box[3])
    framed = _FramedClient(client, pw, ph)
    read = picture_reader(ctx, opt)
    made = []
    wanted = PICTURES_PER_SLIDE if opt.parent else PICTURES_PER_OPTION
    while len(opt.ok_pictures) < wanted and len(made) < wanted:
        if ctx.spent["credits"] >= ctx.budget.max_credits:
            raise BudgetExceeded(f"credit budget of {ctx.budget.max_credits:g} is spent ({ctx.spent['credits']:g}); compose and submit what exists")
        result = make_picture(framed, brief, out_dir / "pictures", read)
        opt.pictures.append(result)
        made.append(result)
        opt.credits += result.credits
        ctx.spent["credits"] += result.credits
    opt.status = "pictured" if opt.ok_pictures else opt.status
    summary = {"option_id": opt.id, "brief": brief.text, "model": brief.model,
               "quiet_zone": {k: round(v, 3) for k, v in zone.items()} if zone else None,
               "pictures": [{"status": p.status, "path": str(p.path) if p.path else None, "job_ids": p.job_ids, "credits": p.credits,
                             "zone_reads": [{"salient_share": z.salient_share, "ok": z.ok, "floor": z.floor, "reason": z.reason} for z in p.zone_reads]} for p in made],
               "credits_spent_total": ctx.spent["credits"]}
    if not opt.ok_pictures:
        opt.fix_rounds += 1
        if opt.fix_rounds > FIX_ROUNDS:
            ctx.drop(opt, "no usable picture after the fix round: " + "; ".join(f"{p.job_ids}: {[z.reason or 'ok' for z in p.zone_reads]}" for p in opt.pictures))
            summary["status"] = "dropped"
        else:
            summary["status"] = "no_picture"
            summary["advice"] = "no picture was usable (busy under the text, or lettering in the picture); re-plan this option id with a calmer, object-free brief (one fix round)"
    else:
        summary["status"] = "ok"
    return summary


# ---- compose ----

_MARGIN_FLOORS = {"logo_match": LOGO_MATCH_MIN, "logo_contrast": LOGO_CONTRAST_MIN, "headline_contrast": TEXT_CONTRAST_MIN,
                  "subline_contrast": TEXT_CONTRAST_MIN, "headline_h_share": HEADLINE_SHORT_EDGE_SHARE_MIN, "content_span": CONTENT_SPAN_MIN}
_MARGIN_CEILINGS = {"headline_busy": BUSY_MAX, "subline_busy": BUSY_MAX}


def margins(m: Mapping, profile: dict, size: Size) -> dict[str, float]:
    """How far each measurement sits from its floor, as a share of the floor and clipped to [-1, 1]: positive is room, negative a failure."""
    out: dict[str, float] = {}

    def rel(v: float | None, floor: float, above: bool) -> float | None:
        if v is None or floor <= 0:
            return None
        return max(-1.0, min(1.0, (v - floor) / floor if above else (floor - v) / floor))

    for k, floor in _MARGIN_FLOORS.items():
        r = rel(m.get(k), floor, True)
        if r is not None:
            out[k] = r
    for k, ceil in _MARGIN_CEILINGS.items():
        r = rel(m.get(k), ceil, False)
        if r is not None:
            out[k] = r
    if m.get("logo_height_share") is not None and m.get("logo_height_min"):
        out["logo_height"] = rel(m["logo_height_share"], m["logo_height_min"], True)
    if m.get("min_text_px") is not None and size.min_text_px:
        out["min_text"] = rel(m["min_text_px"], float(size.min_text_px), True)
    floors = (profile.get("calibration") or {}).get("floors") or {}
    bands = m.get("empty_bands") or {}
    band_max = float(floors.get("edge_band_max", 0.16))
    for side in ("top", "bottom"):
        r = rel(bands.get(side), band_max, False)
        if r is not None:
            out[f"band_{side}"] = r
    r = rel(m.get("dead_space"), float(floors.get("dead_space_max", 0.38)), False)
    if r is not None:
        out["dead_space"] = r
    return {k: round(v, 4) for k, v in out.items() if v is not None}


def margin_sum(m: Mapping, profile: dict, size: Size) -> float:
    return round(sum(margins(m, profile, size).values()), 4)


def _gate(ctx: RunContext, r: Rendered, size: Size, copy: Mapping, full: bool) -> GateResult:
    refs = list(ctx.references) if full else []
    prior = list(ctx.prior_files) if full else []
    return gate_check(r.png, r.boxes, ctx.profile, size, refs, prior, dict(copy), ocr=ctx.ocr, logo_path=r.logo_path,
                                picture_references=list(ctx.picture_references) if full else None)


def _register(ctx: RunContext, opt: OptionState, size: Size, r: Rendered, pic: PictureResult | None, sha: str) -> None:
    ctx.files[str(r.png)] = {"option_id": opt.id, "size": size.name, "boxes": r.boxes, "copy": opt.copy, "picture": str(pic.path) if pic else None,
                             "picture_sha": sha}


def carousel_set_check(ctx: RunContext, parent: OptionState) -> list[str]:
    """What a set must hold beyond each slide passing: one type scale over the body slides (headline sizes within 3%), and no two
    slides that are pixel copies of each other at the primary size."""
    from ..measure.hashes import dhash, hamming

    fails: list[str] = []
    kids = [c for c in ctx.children(parent) if c.status != "dropped"]
    prim = ctx.primary.name
    sizes_px = []
    hashes = []
    for c in kids:
        rec = c.renders.get(prim)
        if not rec:
            fails.append(f"{c.id}: nothing composed at {prim}")
            continue
        px = (rec["rendered"].text_px or {}).get("headline", {}).get("size")
        if c.slide_role == "body" and isinstance(px, (int, float)):
            sizes_px.append((c.id, float(px)))
        try:
            hashes.append((c.id, dhash(rec["rendered"].png)))
        except Exception:  # noqa: BLE001  a missing render is reported above
            pass
    if len(sizes_px) >= 2:
        lo, hi = min(v for _, v in sizes_px), max(v for _, v in sizes_px)
        if hi > 0 and (hi - lo) / hi > 0.03:
            fails.append(f"body slides do not share one type scale: headline sizes {[(i, round(v)) for i, v in sizes_px]} px")
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            d = hamming(hashes[i][1], hashes[j][1])
            if d <= PIXEL_COPY_WHOLE:
                fails.append(f"slides {hashes[i][0]} and {hashes[j][0]} are pixel copies of each other (distance {d})")
    return fails


def compose(ctx: RunContext, option_id: str, arrangement: str | dict | None = None) -> dict:
    """Every size x every kept picture x the family's arrangements (or the one the model names), each rendered and screened by the gate;
    per size the candidate with the best margins is kept. Overflow at the client's floor is reported as the size's failure.
    A carousel composes every slide, then checks the set."""
    opt = _option(ctx, option_id)
    if opt.kind == "carousel":
        out = {"option_id": opt.id, "slides": {}}
        for child in ctx.children(opt):
            if child.status == "dropped":
                out["slides"][child.id] = {"status": "dropped", "reason": child.dropped_reason}
                continue
            out["slides"][child.id] = compose(ctx, child.id, arrangement)
        set_fails = carousel_set_check(ctx, opt)
        opt.failures = {"set": set_fails} if set_fails else {}
        opt.status = "composed"
        out["set"] = {"passed": not set_fails, "failures": set_fails}
        out["next"] = f"call measure({opt.id!r})"
        return out
    pics: list = opt.ok_pictures
    no_picture = place.picture_box(opt.family, ctx.primary, "p50") is None
    if no_picture:
        pics = [None]  # the family carries no picture: ground, device, copy and logo
    elif not pics:
        raise ToolRefused(f"option {opt.id} has no picture yet; call picture({opt.id!r}) first")
    cands: list = [arrangement] if arrangement else arrangements_for(opt)
    report: dict[str, dict] = {}
    opt.renders.clear()
    opt.failures.clear()
    for size in ctx.size_list:
        best: dict | None = None
        notes: list[str] = []
        for pi, pic in enumerate(pics):
            sha = _sha(pic.path) if pic is not None else "none"
            if pic is None:
                ranked = place.rank(opt.family, size, {str(c if isinstance(c, str) else c.get("name", "custom")): ZoneRead(0.0, ok=True, floor=float(ctx.floor)) for c in cands}, ctx.floor, cands)
            else:
                ranked = place.rank(opt.family, size, pic.path, ctx.floor, cands)
            if not any(a.ok for a in ranked):
                notes.append(f"picture {pi + 1}: every arrangement is busy under the text (shares {[a.share for a in ranked]} above {ctx.floor})")
            for arr in ranked:
                if not arr.ok:
                    continue
                out_dir = ctx.option_dir(opt.id) / "candidates" / f"{size.name}-p{pi + 1}-{arr.name}"
                try:
                    r = assemble(ctx.profile, opt.family, size, pic.path if pic is not None else None, opt.copy, arr, None, None, ctx.fonts, ctx.logo_files, out_dir,
                                 floors={}, accent_hex=(opt.family.get("parameters") or {}).get("accent_hex"), browser=ctx.browser)
                except OverflowError as e:
                    notes.append(str(e))
                    continue
                _register(ctx, opt, size, r, pic, sha)
                g = _gate(ctx, r, size, opt.copy, full=False)
                score = margin_sum(g.measurements, ctx.profile, size)
                cand = {"rendered": r, "gate": g, "picture": pic, "picture_index": pi + 1 if pic is not None else None, "picture_sha": sha, "margin": score, "arrangement": arr.name,
                        "shares": arr.shares}
                if best is None or (g.passed, score) > (best["gate"].passed, best["margin"]):
                    best = cand
        if best is None:
            opt.failures[size.name] = notes or ["nothing could be rendered"]
            report[size.name] = {"passed": False, "failures": opt.failures[size.name]}
            continue
        opt.renders[size.name] = best
        g = best["gate"]
        report[size.name] = {"passed": g.passed, "failures": g.failures, "warnings": g.warnings, "margin": best["margin"],
                             "margins": margins(g.measurements, ctx.profile, size), "picture": best["picture_index"], "arrangement": best["arrangement"],
                             "png": str(best["rendered"].png), "text_px": best["rendered"].text_px, "notes": notes}
    opt.status = "composed"
    return {"option_id": opt.id, "sizes": report, "next": f"call measure({opt.id!r})"}


# ---- measure ----


def _fail_round(ctx: RunContext, opt: OptionState, first_failure: str) -> str:
    opt.fix_rounds += 1
    if opt.fix_rounds > FIX_ROUNDS:
        ctx.drop(opt, f"failed the gate after its fix round: {first_failure}")
        return "dropped"
    opt.status = "needs_fix"
    return "needs_fix"


def measure(ctx: RunContext, option_id: str) -> dict:
    """The full gate over every size of an option's kept renders; failures are named with their numbers. One fix round is allowed:
    the model may re-plan the copy length, the picture brief or compose with another arrangement; a second failure drops the option."""
    opt = _option(ctx, option_id)
    if opt.kind == "carousel":
        out: dict[str, Any] = {"option_id": opt.id, "slides": {}}
        first_fail: str | None = None
        for child in ctx.children(opt):
            if child.status == "dropped":
                out["slides"][child.id] = {"status": "dropped", "reason": child.dropped_reason}
                first_fail = first_fail or f"{child.id} dropped: {child.dropped_reason}"
                continue
            res = measure(ctx, child.id)
            out["slides"][child.id] = res
            if res.get("status") != "passed" and first_fail is None:
                first_fail = f"{child.id}: {res.get('reason') or 'failed'}"
        set_fails = carousel_set_check(ctx, opt)
        out["set"] = {"passed": not set_fails, "failures": set_fails}
        if set_fails and first_fail is None:
            first_fail = "set: " + set_fails[0]
        if first_fail is None:
            opt.status = "passed"
            out["status"] = "passed"
            out["next"] = "submit when every option you want to offer has passed"
        else:
            out["status"] = _fail_round(ctx, opt, first_fail)
            if out["status"] == "needs_fix":
                out["advice"] = "one fix round: re-plan the same option id with the failing slide changed (its copy, family or picture brief)"
            else:
                out["reason"] = opt.dropped_reason
        return out
    if not opt.renders and not opt.failures:
        raise ToolRefused(f"option {opt.id} has nothing composed; call compose({opt.id!r}) first")
    sizes: dict[str, dict] = {}
    first_failure: str | None = None
    for size in ctx.size_list:
        rec = opt.renders.get(size.name)
        if rec is None:
            fails = opt.failures.get(size.name) or [f"{size.name} was not composed"]
            sizes[size.name] = {"passed": False, "failures": fails}
        else:
            g = _gate(ctx, rec["rendered"], size, opt.copy, full=True)
            rec["gate"] = g
            rec["margin"] = margin_sum(g.measurements, ctx.profile, size)
            sizes[size.name] = {"passed": g.passed, "failures": g.failures, "warnings": g.warnings, "measurements": g.measurements,
                                "margins": margins(g.measurements, ctx.profile, size)}
            fails = g.failures
        if fails and first_failure is None:
            first_failure = f"{size.name}: {fails[0]}"
    out: dict[str, Any] = {"option_id": opt.id, "sizes": sizes}
    if first_failure is None:
        opt.status = "passed"
        out["status"] = "passed"
        out["next"] = "submit when every option you want to offer has passed"
    else:
        out["status"] = _fail_round(ctx, opt, first_failure)
        if out["status"] == "needs_fix":
            out["advice"] = ("one fix round: shorten the copy (re-plan this option id), change the picture brief (re-plan, then picture), "
                             "or compose with another arrangement; a second failure drops the option")
        else:
            out["reason"] = opt.dropped_reason
    return out


# ---- submit ----


def submit(ctx: RunContext, option_ids: list[str]) -> dict:
    """Re-measure every file of every named option and accept only when all pass; then order the set and apply the distinctness filter.
    What the model reported earlier is not consulted."""
    from . import rank as rank_mod

    if not isinstance(option_ids, list) or not option_ids:
        raise ToolRefused("submit refused: name at least one option id")
    opts = [_option(ctx, oid) for oid in option_ids]
    if any(o.parent for o in opts):
        raise ToolRefused("submit refused: name carousel options by their own id, not a slide's")
    refused: dict[str, list[str]] = {}
    for opt in opts:
        fails: list[str] = []
        members = ctx.children(opt) if opt.kind == "carousel" else [opt]
        for m in members:
            if m.status == "dropped":
                fails.append(f"{m.id}: dropped ({m.dropped_reason})")
                continue
            for size in ctx.size_list:
                rec = m.renders.get(size.name)
                if rec is None:
                    fails.append(f"{m.id} {size.name}: " + "; ".join(m.failures.get(size.name) or ["not composed"]))
                    continue
                g = _gate(ctx, rec["rendered"], size, m.copy, full=True)
                rec["gate"] = g
                rec["margin"] = margin_sum(g.measurements, ctx.profile, size)
                fails.extend(f"{m.id} {size.name}: {f}" for f in g.failures)
        if opt.kind == "carousel":
            fails.extend("set: " + f for f in carousel_set_check(ctx, opt))
        if fails:
            refused[opt.id] = fails
    if refused:
        notes = []
        for oid, fails in refused.items():
            status = _fail_round(ctx, ctx.options[oid], fails[0])
            notes.append(f"{oid} ({status}): " + "; ".join(fails))
        raise ToolRefused("submit refused, the gate failed on re-measure: " + " | ".join(notes))
    def lead(o: OptionState) -> OptionState:
        """The option whose renders stand for the whole: a carousel's cover slide."""
        return ctx.children(o)[0] if o.kind == "carousel" else o

    opts.sort(key=lambda o: -sum(r["margin"] for r in lead(o).renders.values()))
    vision = ctx.clients.get("anthropic") if ctx.rank_with_vision else None
    ordered = rank_mod.pairwise(opts, ctx.nearest, vision, png_of=lambda o: lead(o).png)
    for i, opt in enumerate(ordered):
        opt.rank = i + 1
        first = lead(opt).renders[ctx.primary.name]
        opt.distinct_signature = signature(first["rendered"].boxes, ctx.primary)
    gate_opts = [Option(o.id, o.rank, o.family_key or o.family.get("key"), lead(o).renders[ctx.primary.name]["picture_sha"],
                        lead(o).renders[ctx.primary.name]["rendered"].boxes, ctx.primary) for o in ordered]
    dropped_msgs: list[str] = []
    kept_ids = {o.id for o in filter_set(gate_opts, recent_signatures=ctx.recent_signatures(), dropped=dropped_msgs)}
    kept: list[OptionState] = []
    for opt in ordered:
        if opt.id in kept_ids:
            opt.status = "offered"
            for c in ctx.children(opt):
                c.status, c.rank = "offered", opt.rank
            kept.append(opt)
        else:
            ctx.drop(opt, next((m for m in dropped_msgs if m.startswith(f"{opt.id}:")), "dropped by the set-level distinctness check"))
    for i, opt in enumerate(kept):
        opt.rank = i + 1
    ctx.submitted = kept
    ctx.done = True
    return {"accepted": [o.id for o in kept], "order": [{"id": o.id, "rank": o.rank} for o in kept], "dropped": dropped_msgs,
            "credits": ctx.spent["credits"], "message": "the run is complete; reply with one line and stop"}


__all__ = [
    "Budget",
    "BudgetExceeded",
    "OptionState",
    "RunContext",
    "ToolRefused",
    "arrangements_for",
    "compose",
    "margin_sum",
    "margins",
    "measure",
    "nearest_posts",
    "new_family",
    "picture",
    "picture_reader",
    "plan",
    "quiet_zone",
    "read_brand",
    "submit",
]
