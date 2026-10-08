import json
from pathlib import Path

from design_engine.store.supabase import Asset, Store
from design_engine.store.workspace import Workspace


class FakeResp:
    def __init__(self, body):
        self.body = body

    def json(self):
        return self.body

    @property
    def content(self):
        return self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()

    def raise_for_status(self):
        pass


class FakeHttp:
    def __init__(self, routes):
        self.routes = routes

    def get(self, url, headers=None, params=None):
        for k, v in self.routes.items():
            if k in url:
                return FakeResp(v)
        raise AssertionError(url)


def test_upload_assets_from_client_row():
    client = {"id": "c1", "name": "Bader Law", "design_references": ["Bader-Law/new-1.jpg", "Bader-Law/harvested-x.jpg"],
              "logo_url": "https://x.supabase.co/storage/v1/object/public/generated-media/c1/logo.png", "brand_book_file_path": None}
    s = Store("https://x.supabase.co", "key", http=FakeHttp({"/rest/v1/clients": [client]}))
    assets = s.upload_assets(s.client_by_name("Bader Law"))
    assert assets[0] == Asset("design-references", "Bader-Law/new-1.jpg", "upload", {"source": "upload:Bader-Law/new-1.jpg"})
    assert assets[1].kind == "logo" and assets[1].bucket == "generated-media" and assets[1].path == "c1/logo.png"
    assert len(assets) == 2  # harvested legacy refs are not uploads


def test_workspace_posts_from_index(tmp_path: Path):
    ws = Workspace(tmp_path, "client")
    (ws.root / "posts" / "post-abc.jpg").write_bytes(b"x")
    (ws.root / "posts_index.json").write_text(json.dumps({"g1#0": {"path": "posts/post-abc.jpg", "source_post_id": "g1", "source_url": "u",
        "platform": "INSTAGRAM", "posted_at": "2026-09-01T00:00:00Z", "slide_index": 0, "kind": "post", "impressions": 10}}))
    posts = ws.posts()
    assert posts[0].source == "post:g1#0" and posts[0].platform == "INSTAGRAM" and posts[0].path.exists()


def test_materialise_names_by_hash(tmp_path: Path):
    s = Store("https://x.supabase.co", "key", http=FakeHttp({"/storage/v1/object/public/design-references/C/new-1.jpg": b"hello"}))
    ws = Workspace(tmp_path, "client")
    pairs = ws.materialise(s, [Asset("design-references", "C/new-1.jpg", "upload", {})])
    assert pairs[0][1].exists() and pairs[0][1].name.startswith("upload-")
    assert ws.upload_posts(pairs)[0].kind == "upload"
