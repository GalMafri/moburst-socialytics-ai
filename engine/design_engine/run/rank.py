"""The vision pass: passing options compared two at a time, against each other and beside the client's nearest posts, with two narrow
questions (which reads more like this brand; which is cleaner on a phone). Borda points order the set. It never passes or fails an
option and never removes one: a judge that errs leaves the order as it was."""
from __future__ import annotations

import base64
import logging
import re
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

VISION_MODEL = "claude-sonnet-5-5"
MAX_REFERENCE_POSTS = 2
QUESTIONS = ("Two candidate social posts, A then B, follow the client's own published posts (references). Answer two questions with a letter each. "
             "1. brand: which candidate reads more like this brand's own posts? 2. phone: which is cleaner to read on a phone screen? "
             "Reply exactly in the form `brand: A|B, phone: A|B` and nothing else.")
_ANSWER = re.compile(r"brand:\s*([AB]).*?phone:\s*([AB])", re.IGNORECASE | re.DOTALL)

Ask = Callable[[Path, Path, list[Path]], tuple[str, str]]
log = logging.getLogger(__name__)


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(Path(path).read_bytes()).decode("ascii")
    suffix = Path(path).suffix.lower()
    media = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"
    return {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}


def ask_model(client: Any, model: str, a: Path, b: Path, references: list[Path]) -> tuple[str, str]:
    """One vision call: the references first, then A and B, then the two questions; returns the two letters."""
    content: list[dict] = []
    for i, ref in enumerate(references[:MAX_REFERENCE_POSTS]):
        content.append({"type": "text", "text": f"Reference {i + 1} (the client's own post):"})
        content.append(_image_block(ref))
    content += [{"type": "text", "text": "Candidate A:"}, _image_block(a), {"type": "text", "text": "Candidate B:"}, _image_block(b),
                {"type": "text", "text": QUESTIONS}]
    resp = client.messages.create(model=model, max_tokens=64, messages=[{"role": "user", "content": content}])
    text = " ".join(block.text for block in resp.content if getattr(block, "type", None) == "text")
    m = _ANSWER.search(text)
    if not m:
        raise ValueError(f"the judge did not answer in form: {text[:120]!r}")
    return m.group(1).upper(), m.group(2).upper()


def pairwise(options: Sequence[Any], nearest_posts: Sequence[dict] | None, client: Any, model: str = VISION_MODEL, ask: Ask | None = None,
             png_of: Callable[[Any], Path | None] = lambda o: getattr(o, "png", None)) -> list[Any]:
    """Borda order of `options` by pairwise answers; the input order breaks ties. `ask(a_png, b_png, reference_pngs) -> (brand, phone)`
    is the judge (defaults to `ask_model` on `client`); with neither, or when a pair cannot be judged, the order is left as given."""
    opts = list(options)
    if len(opts) < 2:
        return opts
    if ask is None:
        if client is None:
            return opts

        def ask(a: Path, b: Path, refs: list[Path]) -> tuple[str, str]:
            return ask_model(client, model, a, b, refs)

    refs = [Path(n["path"]) for n in (nearest_posts or []) if isinstance(n, dict) and n.get("path") and Path(n["path"]).exists()]
    points = {id(o): 0 for o in opts}
    for i in range(len(opts)):
        for j in range(i + 1, len(opts)):
            a, b = png_of(opts[i]), png_of(opts[j])
            if not a or not b:
                continue
            try:
                answers = ask(Path(a), Path(b), refs)
            except Exception as exc:  # noqa: BLE001 - a judge that errs leaves the order as it was; it never removes an option
                log.warning("rank: pair %s/%s not judged: %s", Path(a).name, Path(b).name, exc)
                continue
            for letter in answers:
                if str(letter).upper() == "A":
                    points[id(opts[i])] += 1
                elif str(letter).upper() == "B":
                    points[id(opts[j])] += 1
    order = sorted(range(len(opts)), key=lambda k: (-points[id(opts[k])], k))
    return [opts[k] for k in order]


__all__ = ["QUESTIONS", "VISION_MODEL", "ask_model", "pairwise"]
