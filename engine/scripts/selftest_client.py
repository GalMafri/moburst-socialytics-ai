"""Run the family self-test on a learned workspace without relearning: marks unrenderable families on out/profile.json.

    uv run python scripts/selftest_client.py --client "Bader Law"
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from learn_client import is_designed, load_reads, slugify
from run_post import choose_fonts

from design_engine.compose.render import chromium
from design_engine.config import settings
from design_engine.learn import selftest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True)
    args = ap.parse_args()
    ws = settings().work_dir / slugify(args.client)
    out = ws / "out"
    profile = json.loads((out / "profile.json").read_text())
    reads = [r for r in load_reads(out / "reads.json") if is_designed(r)]
    logo_files = [{**f, "path": str(ws / f["path"])} for f in profile.get("logo", {}).get("files", [])]
    stand_in = None
    if (profile.get("type") or {}).get("status") != "resolved":
        cands = [c for c in (profile.get("type") or {}).get("candidates") or [] if c.get("file") and Path(str(c["file"])).exists()]
        stand_in = str(cands[0]["file"]) if cands else None
    hf, sf, _ = choose_fonts(profile, stand_in, ws / "website" / "fonts")
    for fam in profile.get("families") or []:  # a previous mark is re-judged
        if fam.get("status") == "unrenderable":
            fam["status"] = "family"
    with chromium() as browser:
        st = selftest.self_test(profile, reads, {"headline": hf, "subline": sf}, logo_files, out / "selftest", browser)
    marked = selftest.apply(profile, st)
    (out / "profile.json").write_text(json.dumps(profile, indent=1, default=str))
    print(f"{args.client}: {len(st)} families self-tested, {marked} unrenderable: {[(k, v[0]) for k, v in st.items() if v]}")


if __name__ == "__main__":
    main()
