"""Chromium render of a family template through Playwright at exact pixel size. The HTML is written beside the PNG and opened
as a file:// page: fonts and the logo are file:// subresources, which Chromium loads from a file:// page but not from a
set_content page. Returns every [data-slot] box from getBoundingClientRect."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Browser, sync_playwright

from ..measure.image import Box

JS_BOXES = ("[...document.querySelectorAll('[data-slot]')].map(e => { const r = e.getBoundingClientRect(); "
            "return [e.dataset.slot, r.x, r.y, r.width, r.height]; })")
JS_FONT_ERRORS = "[...document.fonts].filter(f => f.status === 'error').map(f => f.family)"
JS_BROKEN_IMAGES = "[...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.dataset.slot || i.getAttribute('src'))"


@contextmanager
def chromium() -> Iterator[Browser]:
    """One headless Chromium for many renders; render_html launches its own when none is passed."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            yield browser
        finally:
            browser.close()


def _render(browser: Browser, html_path: Path, w: int, h: int, out_png: Path) -> dict[str, Box]:
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    try:
        page = ctx.new_page()
        page.set_viewport_size({"width": w, "height": h})
        page.goto(html_path.as_uri(), wait_until="load")
        page.evaluate("document.fonts.ready")
        failed = page.evaluate(JS_FONT_ERRORS)
        if failed:
            raise RuntimeError(f"font failed to load: {failed}")
        broken = page.evaluate(JS_BROKEN_IMAGES)
        if broken:
            raise RuntimeError(f"image failed to load: {broken}")
        page.screenshot(path=str(out_png), full_page=False)
        rows = page.evaluate(JS_BOXES)
    finally:
        ctx.close()
    return {name: [float(x), float(y), float(bw), float(bh)] for name, x, y, bw, bh in rows}


def render_html(html: str, w: int, h: int, out_png: Path, browser: Browser | None = None) -> dict[str, Box]:
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    html_path = out_png.with_suffix(".html")
    html_path.write_text(html, encoding="utf-8")
    if browser is not None:
        return _render(browser, html_path, w, h, out_png)
    with chromium() as b:
        return _render(b, html_path, w, h, out_png)
