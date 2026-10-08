"""The picture tool: one brief in, one measured picture out (or a dropped result), with every credit recorded.

`make_picture` refuses a brief that names a logo, text or the brand before any call; otherwise it asks the price, generates,
downloads, reads the declared quiet zone, and on a busy zone regenerates once with the stronger instruction. A second busy
zone drops the picture: the result lists both job ids and both salient shares, and nothing busy is ever placed.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from ..measure.image import Box
from . import brief as brief_mod
from . import zone as zone_mod
from .brief import Brief, BriefRefused
from .higgsfield import REFERENCE_ROLE, Client, FakeClient, HiggsfieldError, JobOutcome, JobRef
from .zone import ZoneRead

ATTEMPTS = 2


@dataclass
class PictureResult:
    status: str  # "ok" | "dropped"
    path: Path | None
    job_ids: list[str]
    credits: float
    zone_reads: list[ZoneRead]
    spent: list[dict] = field(default_factory=list)  # one {"job_id", "credits", "model", "attempt"} per generate call
    prompts: list[str] = field(default_factory=list)


def _first_result(outcomes: list[JobOutcome]) -> JobOutcome:
    done = next((o for o in outcomes if o.status == "completed" and o.result_url), None)
    if done:
        return done
    failed = next((o for o in outcomes if o.status == "failed" or o.error), None)
    if failed:
        raise HiggsfieldError(f"Higgsfield could not finish the picture: {failed.error or failed.status}")
    raise HiggsfieldError("Higgsfield finished without returning a picture")


Reader = Callable[[Path], ZoneRead]


def make_picture(client: Client | FakeClient, brief: Brief, out_dir: Path, zone: Box | Reader, floor: float = zone_mod.DEFAULT_FLOOR) -> PictureResult:
    """`zone` is the quiet zone in the picture's pixels, read with the floor, or a reader `(path) -> ZoneRead` that judges the
    picture the way the composer will place text on it (the busiest text slot over every arrangement)."""
    read_zone: Reader = zone if callable(zone) else (lambda path: zone_mod.read(path, zone, floor))
    brief_mod.check(brief_mod.without_clause(brief.text), brief.brand_name)
    out_dir = Path(out_dir)
    medias = [{"value": mid, "role": REFERENCE_ROLE} for mid in brief.reference_media_ids if mid]
    for url in brief.reference_urls:
        media_id = client.import_url(url)
        if media_id:
            medias.append({"value": media_id, "role": REFERENCE_ROLE})
    job_ids: list[str] = []
    reads: list[ZoneRead] = []
    spent: list[dict] = []
    prompts: list[str] = []
    for attempt in range(1, ATTEMPTS + 1):
        prompt = brief.text if attempt == 1 else brief_mod.stronger(brief)
        brief_mod.check(brief_mod.without_clause(prompt), brief.brand_name)
        params = {**brief.params, "model": brief.model, "prompt": prompt, "use_unlim": False}
        if medias:
            params["medias"] = medias
        credits = client.cost(brief.model, params)
        jobs: list[JobRef] = client.generate([{"index": 0, "params": params}])
        job = jobs[0]
        job_ids.append(job.job_id)
        prompts.append(prompt)
        spent.append({"job_id": job.job_id, "credits": credits, "model": brief.model, "attempt": attempt})
        done = _first_result(client.wait(jobs))
        path = client.download(done.result_url, out_dir / f"picture-{job.job_id}.png")
        read = read_zone(path)
        reads.append(read)
        total = sum(s["credits"] or 0.0 for s in spent)
        if read.ok:
            return PictureResult("ok", path, job_ids, total, reads, spent, prompts)
    return PictureResult("dropped", None, job_ids, sum(s["credits"] or 0.0 for s in spent), reads, spent, prompts)


__all__ = ["ATTEMPTS", "Brief", "BriefRefused", "Client", "FakeClient", "HiggsfieldError", "PictureResult", "ZoneRead", "make_picture"]
