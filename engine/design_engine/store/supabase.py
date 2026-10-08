"""Read-only access to the Socialytics database and public buckets for the learner.

Posts come from Sprout (the n8n proof workflow or, later, the design-harvest function); this store only reads the client row,
the team's uploaded references and brand files. No RivalIQ path exists here by design.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

PUBLIC_OBJECT = "/storage/v1/object/public/"


@dataclass(frozen=True)
class Asset:
    bucket: str
    path: str
    kind: str  # "upload" | "logo" | "brand_book"
    provenance: dict


class Store:
    def __init__(self, url: str, service_key: str | None = None, http: Any | None = None):
        self.url = url.rstrip("/")
        self.key = service_key
        self.http = http or httpx.Client(timeout=60, follow_redirects=True)

    def _headers(self) -> dict[str, str]:
        if not self.key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required to read client rows")
        return {"apikey": self.key, "Authorization": f"Bearer {self.key}"}

    def client_by_name(self, name: str) -> dict:
        r = self.http.get(f"{self.url}/rest/v1/clients", headers=self._headers(), params={"name": f"eq.{name}", "select": "*"})
        r.raise_for_status()
        rows = r.json()
        if not rows:
            raise LookupError(f"No client named {name!r}")
        return rows[0]

    def upload_assets(self, client: dict) -> list[Asset]:
        """The team's uploads for this client: design references, the logo file, the brand book."""
        out: list[Asset] = []
        for path in client.get("design_references") or []:
            if isinstance(path, str) and "/new-" in path:
                out.append(Asset("design-references", path, "upload", {"source": f"upload:{path}"}))
        logo = client.get("logo_url")
        if isinstance(logo, str) and PUBLIC_OBJECT in logo:
            bucket, path = logo.split(PUBLIC_OBJECT, 1)[1].split("/", 1)
            out.append(Asset(bucket, path, "logo", {"source": f"upload:{path}"}))
        book = client.get("brand_book_file_path")
        if isinstance(book, str) and book:
            out.append(Asset("brand-books", book, "brand_book", {"source": f"upload:{book}"}))
        return out

    def download(self, bucket: str, path: str) -> bytes:
        r = self.http.get(f"{self.url}{PUBLIC_OBJECT}{bucket}/{path}")
        r.raise_for_status()
        return r.content
