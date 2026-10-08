from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ENGINE_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    work_dir: Path
    supabase_url: str
    supabase_service_key: str | None
    anthropic_api_key: str | None
    ocr_backend: str  # "auto" | "vision" | "rapidocr"


def settings(env: dict[str, str] | None = None) -> Settings:
    if env is None:
        load_dotenv(ENGINE_ROOT / ".env")
        env = dict(os.environ)
    return Settings(
        work_dir=Path(env.get("ENGINE_WORK_DIR", ENGINE_ROOT / "work")),
        supabase_url=env.get("SUPABASE_URL", "https://rwouwxqggjjacbpbhqsn.supabase.co"),
        supabase_service_key=env.get("SUPABASE_SERVICE_ROLE_KEY"),
        anthropic_api_key=env.get("ANTHROPIC_API_KEY"),
        ocr_backend=env.get("OCR_BACKEND", "auto"),
    )
