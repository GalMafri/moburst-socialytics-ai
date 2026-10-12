"""Carousels as the client publishes them: slide roles and the slide-count band read from its own album posts, and which layout
families serve each role. A cover is a first slide (headline and logo), a closing is a last slide of an album with at least three,
every other slide is a body. A family serves a role when at least two of its members hold that role."""
from __future__ import annotations

from collections import Counter

from .grammar import band

MIN_ALBUM = 2
MIN_FOR_CLOSING = 3
MIN_ROLE_MEMBERS = 2


def album_sizes(reads: list) -> dict[str, int]:
    """Slides per post id over the designed reads (posts only, never uploads)."""
    sizes: Counter = Counter()
    for r in reads:
        if getattr(r, "kind", "post") == "post" and r.source_post_id:
            sizes[r.source_post_id] += 1
    return {pid: n for pid, n in sizes.items() if n >= MIN_ALBUM}


def slide_roles(reads: list) -> dict[str, str]:
    """read.source -> cover | body | closing, for reads that belong to an album."""
    sizes = album_sizes(reads)
    roles: dict[str, str] = {}
    for r in reads:
        n = sizes.get(r.source_post_id)
        if not n or getattr(r, "kind", "post") != "post":
            continue
        i = int(r.slide_index or 0)
        if i == 0:
            roles[r.source] = "cover"
        elif i == n - 1 and n >= MIN_FOR_CLOSING:
            roles[r.source] = "closing"
        else:
            roles[r.source] = "body"
    return roles


def carousel_block(reads: list, families: list) -> dict:
    """The profile's carousel block: album count, the slide-count band (sources = post ids), and per role the families that serve it
    with how many of their members hold the role. Families are dicts or Family dataclasses with `key` and `sources`."""
    sizes = album_sizes(reads)
    roles = slide_roles(reads)
    role_fams: dict[str, list[dict]] = {"cover": [], "body": [], "closing": []}
    for fam in families:
        key = fam["key"] if isinstance(fam, dict) else fam.key
        sources = fam.get("source") or fam.get("sources") or [] if isinstance(fam, dict) else fam.sources
        counts = Counter(roles.get(s) for s in sources if roles.get(s))
        for role, n in counts.items():
            if n >= MIN_ROLE_MEMBERS:
                role_fams[role].append({"key": key, "n": int(n)})
    for role in role_fams:
        role_fams[role].sort(key=lambda e: -e["n"])
    return {
        "albums": len(sizes),
        "slide_count": band([float(n) for n in sizes.values()], [f"post:{pid}" for pid in sizes]),
        "roles": role_fams,
        "source": f"{len(sizes)} album posts of the client's own; roles by slide position (first = cover, last of three or more = closing)",
    }


__all__ = ["album_sizes", "carousel_block", "slide_roles"]
