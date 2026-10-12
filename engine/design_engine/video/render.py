"""Rendering through Remotion's CLI in engine/video (npm installed there), and frame sampling through ffmpeg. The worker holds both;
tests use the fakes. Fonts and the logo are copied into video/public so the composition can load them as relative URLs."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from ..config import ENGINE_ROOT

VIDEO_DIR = ENGINE_ROOT / "video"


class RenderError(RuntimeError):
    pass


def stage_assets(spec: dict, public: Path | None = None) -> dict:
    """Copy font and logo files into video/public and point the spec at them by relative URL (what Remotion serves)."""
    public = Path(public or VIDEO_DIR / "public")
    public.mkdir(parents=True, exist_ok=True)
    out = json.loads(json.dumps(spec))

    def stage(path: str) -> str:
        src = Path(path)
        if not src.exists():
            raise RenderError(f"asset not found: {src}")
        dst = public / src.name
        if dst.resolve() != src.resolve():
            shutil.copyfile(src, dst)
        return src.name

    out["fonts"] = {k: stage(v) for k, v in out["fonts"].items() if v}
    if out.get("logo", {}).get("path"):
        out["logo"]["path"] = stage(out["logo"]["path"])
    if out.get("broll") and out["broll"].get("path"):
        out["broll"]["path"] = stage(out["broll"]["path"])
    return out


def render(spec: dict, out_mp4: Path, props_path: Path | None = None, timeout: float = 900.0) -> Path:
    """`npx remotion render src/index.ts BrandCards <out> --props <json>`; raises with the CLI's tail on failure."""
    if not (VIDEO_DIR / "node_modules" / "remotion").exists():
        raise RenderError(f"Remotion is not installed in {VIDEO_DIR}: run `npm install` there")
    staged = stage_assets(spec)
    props = Path(props_path or out_mp4.with_suffix(".props.json"))
    props.parent.mkdir(parents=True, exist_ok=True)
    props.write_text(json.dumps({"spec": staged}))
    cmd = ["npx", "remotion", "render", "src/index.ts", "BrandCards", str(Path(out_mp4).resolve()), "--props", str(props.resolve()), "--log", "error"]
    proc = subprocess.run(cmd, cwd=VIDEO_DIR, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RenderError(f"remotion render failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-1200:]}")
    return Path(out_mp4)


def render_still(spec: dict, out_png: Path, frame: int, props_path: Path | None = None, timeout: float = 300.0) -> Path:
    """`npx remotion still src/index.ts BrandCards <out> --frame N --props <json>`: one frame of the composition as a PNG."""
    if not (VIDEO_DIR / "node_modules" / "remotion").exists():
        raise RenderError(f"Remotion is not installed in {VIDEO_DIR}: run `npm install` there")
    staged = stage_assets(spec)
    props = Path(props_path or out_png.with_suffix(".props.json"))
    props.parent.mkdir(parents=True, exist_ok=True)
    props.write_text(json.dumps({"spec": staged}))
    cmd = ["npx", "remotion", "still", "src/index.ts", "BrandCards", str(Path(out_png).resolve()), "--frame", str(int(frame)),
           "--props", str(props.resolve()), "--log", "error"]
    proc = subprocess.run(cmd, cwd=VIDEO_DIR, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RenderError(f"remotion still failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-1200:]}")
    return Path(out_png)


def ffmpeg_exe() -> str:
    """ffmpeg on the PATH, else the binary the imageio-ffmpeg package carries (the box installs ffmpeg; a laptop may not)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:  # noqa: BLE001
        raise RenderError(f"ffmpeg is not installed and imageio-ffmpeg is unavailable: {e}") from e


def sample_frames(mp4: Path, out_dir: Path, every_seconds: float = 1.0) -> list[Path]:
    """One PNG per `every_seconds` of the video, through ffmpeg."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = out_dir / "frame-%03d.png"
    proc = subprocess.run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(mp4), "-vf", f"fps=1/{every_seconds}", str(pattern)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RenderError(f"ffmpeg failed: {proc.stderr[-600:]}")
    return sorted(out_dir.glob("frame-*.png"))


__all__ = ["RenderError", "VIDEO_DIR", "render", "sample_frames", "stage_assets"]
