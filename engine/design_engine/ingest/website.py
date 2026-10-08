"""Website read: logo candidates, @font-face files and weighted colours from one rendered page.

Everything the page says about itself is data: a font's family comes from its own name table (fonts.py),
never from the CSS string; colours are computed styles, weighted toward buttons, headers and theme-color.
"""
from __future__ import annotations

import colorsys
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import url2pathname

import httpx

from design_engine.ingest.fonts import font_file_names, to_ttf

log = logging.getLogger(__name__)

# Everything a fetch, a font decode or a bad URL can raise; to_ttf/font_file_names normalise font errors to ValueError.
FETCH_ERRORS = (OSError, ValueError, httpx.HTTPError)

MAX_ELEMENTS = 4000
THEME_COLOR_WEIGHT = 1000
BACKGROUND_MULT = 2
BRAND_MULT = 3
MIN_SATURATION = 0.2
MIN_LIGHTNESS = 0.07
MAX_LIGHTNESS = 0.95
DEDUPE_DISTANCE = 40.0
KEEP_COLOURS = 8
LOGO_MIN_W, LOGO_MAX_W, LOGO_MIN_H = 16, 640, 8
HTTP_TIMEOUT = 20.0
FONT_EXT_OK = (".woff2", ".woff", ".ttf", ".otf")


@dataclass
class SiteRead:
    url: str
    logo_candidates: list[dict] = field(default_factory=list)  # src, kind, width, height, path
    font_files: list[dict] = field(default_factory=list)  # path, family, weight, style, url
    colours: list[dict] = field(default_factory=list)  # hex, weight, where
    captured_at: str = ""


# One script, one round trip. Selector order is the documented order (spec section 4, plan Task 9).
PAGE_SCRIPT = r"""
(limits) => {
  const [minW, maxW, minH, maxEls] = limits;
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } };
  const seen = new Set();
  const logos = [];
  const push = (src, kind, w, h, selector) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    logos.push({src, kind, width: Math.round(w || 0), height: Math.round(h || 0), selector});
  };
  const sized = (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; };
  const ok = (w, h) => w >= minW && w <= maxW && h >= minH;
  for (const sel of ['a[href="/"] svg', '[class*="logo" i] svg', 'header svg', 'nav svg']) {
    for (const el of document.querySelectorAll(sel)) {
      const [w, h] = sized(el);
      if (ok(w, h)) push(el.outerHTML, 'inline-svg', w, h, sel);
    }
  }
  for (const sel of ['[class*="logo" i] img', 'img[alt*="logo" i]', 'header a[href="/"] img', 'header img']) {
    for (const el of document.querySelectorAll(sel)) {
      let [w, h] = sized(el);
      if (!w && el.naturalWidth) { w = el.naturalWidth; h = el.naturalHeight; }
      if (ok(w, h)) push(abs(el.currentSrc || el.src), 'img', w, h, sel);
    }
  }
  for (const sel of ['link[rel="apple-touch-icon"]', 'link[rel~="icon"]']) {
    for (const el of document.querySelectorAll(sel)) {
      const m = /(\d+)x(\d+)/.exec(el.getAttribute('sizes') || '');
      push(abs(el.getAttribute('href')), 'icon', m ? +m[1] : 0, m ? +m[2] : 0, sel);
    }
  }
  for (const el of document.querySelectorAll('meta[property="og:image"]')) {
    push(abs(el.getAttribute('content')), 'og-image', 0, 0, 'meta[property="og:image"]');
  }

  const faces = [];
  const blocked = [];
  const walk = (rules, href) => {
    for (const r of rules) {
      if (r.type === CSSRule.FONT_FACE_RULE) {
        faces.push({
          family: r.style.getPropertyValue('font-family'),
          src: r.style.getPropertyValue('src'),
          weight: r.style.getPropertyValue('font-weight'),
          style: r.style.getPropertyValue('font-style'),
          sheet: href,
        });
      } else if (r.type === CSSRule.IMPORT_RULE && r.styleSheet) {
        try { walk(r.styleSheet.cssRules, r.styleSheet.href || href); } catch (e) { blocked.push(abs(r.href)); }
      } else if (r.cssRules) {
        walk(r.cssRules, href);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    const href = sheet.href || document.baseURI;
    try { walk(sheet.cssRules, href); } catch (e) { if (sheet.href) blocked.push(sheet.href); }
  }

  const brand = /btn|cta|button|brand|logo|nav|header|primary|hero/i;
  const colours = [];
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme && theme.getAttribute('content')) colours.push({value: theme.getAttribute('content'), weight: 1000, where: 'theme-color'});
  const els = document.querySelectorAll('html, body, body *');
  const n = Math.min(els.length, maxEls);
  for (let i = 0; i < n; i++) {
    const el = els[i];
    const cs = getComputedStyle(el);
    const ident = el.tagName + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
    const mult = brand.test(ident) ? 3 : 1;
    colours.push({value: cs.backgroundColor, weight: 2 * mult, where: 'background'});
    colours.push({value: cs.color, weight: mult, where: 'text'});
    if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0) {
      colours.push({value: cs.borderTopColor, weight: mult, where: 'border'});
      if (cs.borderBottomColor !== cs.borderTopColor) colours.push({value: cs.borderBottomColor, weight: mult, where: 'border'});
    }
  }
  return {logos, faces, blocked, colours};
}
"""

_FONT_FACE_BLOCK = re.compile(r"@font-face\s*{([^}]*)}", re.IGNORECASE | re.DOTALL)
_FAMILY = re.compile(r"font-family\s*:\s*([^;]+);?", re.IGNORECASE)
_SRC = re.compile(r"src\s*:\s*([^;]+);?", re.IGNORECASE)
_WEIGHT = re.compile(r"font-weight\s*:\s*([^;]+);?", re.IGNORECASE)
_STYLE = re.compile(r"font-style\s*:\s*([^;]+);?", re.IGNORECASE)
_URL = re.compile(r"""url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?""", re.IGNORECASE)
_RGB = re.compile(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)", re.IGNORECASE)
_RGB_SLASH = re.compile(r"rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:/\s*([\d.%]+)\s*)?\)", re.IGNORECASE)
_HEX = re.compile(r"^#([0-9a-f]{3,8})$", re.IGNORECASE)


def read_site(url: str, out_dir, browser=None) -> SiteRead:
    """Render `url` in Chromium and return logo candidates, downloaded font files and weighted colours, saving files under out_dir."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if browser is None:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            b = pw.chromium.launch()
            try:
                return _read_with(b, url, out_dir)
            finally:
                b.close()
    return _read_with(browser, url, out_dir)


def _read_with(browser, url: str, out_dir: Path) -> SiteRead:
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    try:
        page.goto(url, wait_until="load", timeout=45_000)
        page.wait_for_timeout(300)
        raw = page.evaluate(PAGE_SCRIPT, [LOGO_MIN_W, LOGO_MAX_W, LOGO_MIN_H, MAX_ELEMENTS])
        page_url = page.url
    finally:
        page.close()
    faces = list(raw["faces"]) + [f for href in dict.fromkeys(raw["blocked"]) for f in _faces_from_sheet(href)]
    return SiteRead(
        url=page_url,
        logo_candidates=_save_logos(raw["logos"], out_dir),
        font_files=_download_fonts(faces, page_url, out_dir),
        colours=weigh_colours(raw["colours"]),
        captured_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


# ---- fetching (http(s) via httpx; file:// read from disk so tests never touch the network) ----


def _fetch_bytes(url: str) -> bytes:
    p = urlparse(url)
    if p.scheme == "file":
        return Path(url2pathname(unquote(p.path))).read_bytes()
    if p.scheme in ("http", "https"):
        r = httpx.get(url, timeout=HTTP_TIMEOUT, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (design-engine site read)"})
        r.raise_for_status()
        return r.content
    raise ValueError(f"unsupported URL scheme for {url}")


def _faces_from_sheet(sheet_url: str) -> list[dict]:
    """Parse @font-face blocks from a stylesheet the page could not expose (cross-origin)."""
    try:
        css = _fetch_bytes(sheet_url).decode("utf-8", "replace")
    except FETCH_ERRORS as e:
        log.debug("stylesheet %s not readable: %s", sheet_url, e)
        return []
    return parse_font_faces(css, sheet_url)


def parse_font_faces(css: str, sheet_url: str) -> list[dict]:
    out = []
    for m in _FONT_FACE_BLOCK.finditer(css):
        body = m.group(1)
        fam, src = _FAMILY.search(body), _SRC.search(body)
        if not fam or not src:
            continue
        w, s = _WEIGHT.search(body), _STYLE.search(body)
        out.append(
            {
                "family": fam.group(1).strip(),
                "src": src.group(1).strip(),
                "weight": w.group(1).strip() if w else "",
                "style": s.group(1).strip() if s else "",
                "sheet": sheet_url,
            }
        )
    return out


def _src_urls(src: str, base: str) -> list[str]:
    """Usable file URLs from a @font-face src list, in source order; eot/svg/data: and local() are skipped."""
    urls = []
    for m in _URL.finditer(src or ""):
        u, fmt = m.group(1).strip(), (m.group(2) or "").lower()
        if u.startswith("data:"):
            continue
        ext = Path(urlparse(u).path).suffix.lower()
        if fmt and fmt not in ("woff2", "woff", "truetype", "opentype"):
            continue
        if not fmt and ext not in FONT_EXT_OK:
            continue
        urls.append(urljoin(base, u))
    return urls


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "", name.replace(" ", "")) or "font"


def _download_fonts(faces: list[dict], page_url: str, out_dir: Path) -> list[dict]:
    fonts_dir = out_dir / "fonts"
    done: dict[tuple, dict] = {}
    for face in faces:
        base = face.get("sheet") or page_url
        for u in _src_urls(face.get("src", ""), base):
            try:
                ttf = to_ttf(_fetch_bytes(u))
                names = font_file_names(ttf)
            except FETCH_ERRORS as e:
                log.debug("font %s skipped: %s", u, e)
                continue
            key = (names["family"], names["weight"], names["style"])
            if key in done or not names["family"]:
                break
            fonts_dir.mkdir(parents=True, exist_ok=True)
            fname = f"{_safe(names['family'])}-{names['weight']}{'-italic' if names['style'] == 'italic' else ''}.ttf"
            (fonts_dir / fname).write_bytes(ttf)
            done[key] = {
                "path": str(Path("fonts") / fname),
                "family": names["family"],
                "subfamily": names["subfamily"],
                "weight": names["weight"],
                "style": names["style"],
                "url": u,
                "css_family": face.get("family", "").strip("\"' "),
            }
            break
    return list(done.values())


# ---- logos ----


def _save_logos(logos: list[dict], out_dir: Path) -> list[dict]:
    out = []
    n_inline = n_file = 0
    for c in logos:
        item = {"src": c["src"], "kind": c["kind"], "width": c["width"], "height": c["height"], "path": None}
        if c["kind"] == "inline-svg":
            n_inline += 1
            p = out_dir / f"logo-inline-{n_inline}.svg"
            p.write_text(c["src"], encoding="utf-8")
            item["path"] = p.name
        else:
            try:
                data = _fetch_bytes(c["src"])
            except FETCH_ERRORS as e:
                log.debug("logo %s not fetched: %s", c["src"], e)
                data = None
            if data:
                n_file += 1
                ext = Path(urlparse(c["src"]).path).suffix.lower().lstrip(".") or _sniff_ext(data)
                p = out_dir / f"logo-{n_file}.{ext}"
                p.write_bytes(data)
                item["path"] = p.name
        out.append(item)
    return out


def _sniff_ext(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] == b"\x00\x00\x01\x00":
        return "ico"
    if b"<svg" in data[:512]:
        return "svg"
    return "bin"


# ---- colours ----


def parse_css_colour(value: str) -> tuple[int, int, int] | None:
    """rgb()/rgba()/#hex -> (r, g, b); None when transparent or unparseable."""
    v = (value or "").strip()
    m = _RGB.match(v) or _RGB_SLASH.match(v)
    if m:
        a = m.group(4)
        if a is not None:
            alpha = float(a.rstrip("%")) / (100 if a.endswith("%") else 1)
            if alpha <= 0.05:
                return None
        return tuple(min(255, round(float(m.group(i)))) for i in (1, 2, 3))  # type: ignore[return-value]
    m = _HEX.match(v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        if len(h) == 8 and int(h[6:8], 16) < 13:
            return None
        if len(h) in (6, 8):
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return None


def _keep(rgb: tuple[int, int, int]) -> bool:
    _h, lum, sat = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    return sat >= MIN_SATURATION and MIN_LIGHTNESS <= lum <= MAX_LIGHTNESS


def _dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def weigh_colours(samples: list[dict]) -> list[dict]:
    """Aggregate weighted colour samples: drop greys and near-white/black, dedupe at RGB distance 40, keep the top 8."""
    totals: dict[tuple[int, int, int], float] = {}
    wheres: dict[tuple[int, int, int], dict[str, float]] = {}
    for s in samples:
        rgb = parse_css_colour(s.get("value", ""))
        if rgb is None or not _keep(rgb):
            continue
        w = float(s.get("weight", 1))
        totals[rgb] = totals.get(rgb, 0.0) + w
        wh = wheres.setdefault(rgb, {})
        wh[s.get("where", "")] = wh.get(s.get("where", ""), 0.0) + w
    kept: list[list] = []  # [rgb, weight, where-dict]
    for rgb, w in sorted(totals.items(), key=lambda kv: -kv[1]):
        for k in kept:
            if _dist(k[0], rgb) < DEDUPE_DISTANCE:
                k[1] += w
                for key, val in wheres[rgb].items():
                    k[2][key] = k[2].get(key, 0.0) + val
                break
        else:
            kept.append([rgb, w, dict(wheres[rgb])])
    kept.sort(key=lambda k: -k[1])
    return [
        {"hex": f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}", "weight": round(w), "where": max(wh.items(), key=lambda kv: kv[1])[0]}
        for rgb, w, wh in kept[:KEEP_COLOURS]
    ]
