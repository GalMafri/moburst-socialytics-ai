"""Download the stills of a client's Sprout posts into work/<slug>/posts/ with provenance. Idempotent by sha256."""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import httpx

slug = sys.argv[1]
root = Path(__file__).resolve().parent.parent / "work" / slug
posts = json.load(open(root / "sprout_posts.json"))
out = root / "posts"; out.mkdir(exist_ok=True)
index_path = root / "posts_index.json"
index = json.load(open(index_path)) if index_path.exists() else {}
client = httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (Macintosh) Socialytics design engine"})
done = fail = skip = 0
for p in posts:
    cat = (p.get("content_category") or "").upper()
    media = [m for m in (p.get("visual_media") or []) if (m.get("media_type") or "").upper() == "PHOTO" and m.get("media_url")]
    if cat == "VIDEO":
        media = [m for m in (p.get("visual_media") or []) if m.get("thumbnail_url") or m.get("media_url")][:1]
    for i, m in enumerate(media):
        url = m.get("media_url") if cat != "VIDEO" else (m.get("thumbnail_url") or m.get("media_url"))
        key = f"{p['guid']}#{i}"
        if key in index: skip += 1; continue
        try:
            r = client.get(url); r.raise_for_status()
            mime = (r.headers.get("content-type") or "").split(";")[0]
            if not mime.startswith("image/"): fail += 1; continue
            data = r.content; sha = hashlib.sha256(data).hexdigest()
            ext = {"image/png": "png", "image/webp": "webp"}.get(mime, "jpg")
            path = out / f"post-{sha}.{ext}"
            if not path.exists(): path.write_bytes(data)
            index[key] = {"path": str(path.relative_to(root)), "sha256": sha, "source_post_id": p["guid"], "source_url": p.get("perma_link"),
                          "profile_id": p.get("profile_id"), "platform": p.get("network"), "posted_at": p.get("created_time"),
                          "content_category": cat, "slide_index": i, "impressions": p.get("impressions"), "text": p.get("text"), "kind": "video_thumb" if cat == "VIDEO" else "post"}
            done += 1
        except Exception:
            fail += 1
        time.sleep(0.05)
json.dump(index, open(index_path, "w"), indent=1)
print(slug, "downloaded", done, "skipped", skip, "failed", fail, "total", len(index))
