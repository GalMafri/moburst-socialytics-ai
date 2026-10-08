"""Per-client local workspace: posts/ (Sprout stills with provenance), uploads/, website/, out/."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .supabase import Asset, Store


@dataclass(frozen=True)
class PostFile:
    path: Path
    source_post_id: str
    source_url: str | None
    platform: str
    posted_at: str
    slide_index: int
    kind: str  # "post" | "video_thumb" | "upload"
    impressions: int | None = None
    text: str | None = None

    @property
    def source(self) -> str:
        return f"post:{self.source_post_id}#{self.slide_index}" if self.kind != "upload" else f"upload:{self.path.name}"


class Workspace:
    def __init__(self, root: Path, client_slug: str):
        self.root = root / client_slug
        for d in ("posts", "uploads", "website", "out"):
            (self.root / d).mkdir(parents=True, exist_ok=True)

    def posts(self) -> list[PostFile]:
        """Stills downloaded from Sprout (scripts/download_sprout_media.py writes posts_index.json)."""
        index_path = self.root / "posts_index.json"
        if not index_path.exists():
            return []
        index = json.loads(index_path.read_text())
        out = []
        seen_paths: set[str] = set()
        # the same image posted to several platforms is one design: keep the first entry per file (the index keeps every source)
        for entry in sorted(index.values(), key=lambda e: (e.get("posted_at") or ""), reverse=True):
            if entry["path"] in seen_paths:
                continue
            seen_paths.add(entry["path"])
            out.append(PostFile(self.root / entry["path"], entry["source_post_id"], entry.get("source_url"), entry.get("platform") or "",
                                entry.get("posted_at") or "", int(entry.get("slide_index") or 0), entry.get("kind") or "post",
                                entry.get("impressions"), entry.get("text")))
        out.sort(key=lambda p: (p.posted_at, p.source_post_id, p.slide_index), reverse=True)
        return out

    def materialise(self, store: Store, assets: list[Asset]) -> list[tuple[Asset, Path]]:
        """Download each upload once, named by content hash; returns (asset, local path) pairs."""
        out = []
        for a in assets:
            data = store.download(a.bucket, a.path)
            sha = hashlib.sha256(data).hexdigest()
            ext = Path(a.path).suffix.lower() or ".bin"
            folder = self.root / ("uploads" if a.kind == "upload" else "website" if a.kind == "logo" else "uploads")
            local = folder / f"{a.kind}-{sha}{ext}"
            if not local.exists():
                local.write_bytes(data)
            out.append((a, local))
        return out

    def upload_posts(self, pairs: list[tuple[Asset, Path]]) -> list[PostFile]:
        return [PostFile(p, a.path, None, "", "", 0, "upload") for a, p in pairs if a.kind == "upload"]
