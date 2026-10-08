from pathlib import Path

from design_engine.config import settings


def test_settings_from_env_dict():
    s = settings({"ENGINE_WORK_DIR": "/tmp/x", "OCR_BACKEND": "rapidocr"})
    assert s.work_dir == Path("/tmp/x")
    assert s.ocr_backend == "rapidocr"
    assert s.supabase_url.startswith("https://")
