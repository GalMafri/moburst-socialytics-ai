#!/usr/bin/env python3
"""Moburst deck builder — draw the measured archetypes into a .pptx.

    import sys; sys.path.insert(0, "scripts")
    from mbdeck import Deck

    d = Deck()
    s = d.slide("cover-main.jpg")
    s.cover("Same Traffic. More Revenue.", "How we turn existing sessions into pipeline.")

    s = d.slide("inner.jpg")
    s.header("Our Services")
    s.card_row("services-5", [
        {"label": "MARKETING\nSTRATEGY", "body": "Mobile Strategy\nDigital Strategy",
         "icon": "define"},
        ...
    ])
    d.save("deck.pptx")

Everything is in POINTS on a 720 x 405 canvas, matching `reference/geometry.json` — which is
measured off the source deck, so never round its numbers or re-derive spacing from `pitch`.

Two things here are easy to get wrong and are handled for you:

* **Text anchoring.** Every `y` in the geometry is the glyph **ascender line**, not a box
  top. `text()` gives each line its own box at its own ascender Y and sets NO line spacing —
  Geist has lineGap 0, so natural single spacing puts the first baseline exactly one ascent
  below the box top, which IS the ascender line. That removes the renderer-dependent constant
  that used to sit here (Keynote fits 0.80, the macOS Office renderer ~0.72, and text drifted
  1.5-2.3pt between them). Pass the geometry's y straight through.
* **Glass.** python-pptx cannot set fill transparency, and a glass panel without its bottom
  edge-light does not read as glass at all. `glass()` writes the alpha into the XML and lays
  the light-catch on top.
"""
import json
import os
import re

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
GEO = json.load(open(os.path.join(ROOT, "reference", "geometry.json")))

CANVAS_W, CANVAS_H = 720.0, 405.0

# ----------------------------------------------------------------------------- typography
#
# The source deck sets six static Geist faces. PPTX carries weight as a FAMILY NAME, not a
# numeric weight — `b=1` only ever gives you Bold, so asking for "Geist" + bold cannot
# produce Light or Medium. Use these names verbatim; they are the fonts' full names, which
# is what PowerPoint, Keynote and Google Slides all match on.
FONTS = {
    "ExtraLight": "Geist ExtraLight",
    "Light": "Geist Light",          # 10pt body — the deck's most common face by far
    "Regular": "Geist",              # 18pt slide titles
    "Medium": "Geist Medium",        # 11pt card labels
    "SemiBold": "Geist SemiBold",
    "Bold": "Geist Bold",            # 40pt cover title, emphasis runs inside body copy
}

# Geist's real metrics, read from the TTFs (unitsPerEm 1000).
HAIRLINE = "272D3B"      # --mb-hairline: the card divider / border grey

#: Section -> divider background. The huge section word and the coloured robot are baked into
#: these plates; never author them. `general` has no divider.
SECTION_DIVIDER_BG = {
    "strategy": "strategy.jpg", "product": "product-cover.jpg",
    "creative": "creative-cover.jpg", "organic": "organic-cover.jpg",
    "media": "Media-cover.jpg",
}
#: Section -> inner (content) background.
SECTION_BG = {
    "general": "General inner.jpg", "strategy": "strategy-inner.jpg",
    "product": "product-inner.jpg", "creative": "creative-inner.jpg",
    "organic": "organic-inner.jpg", "media": "Media-inner.jpg",
}

#: Backgrounds that take NO title scrim. Measured over the tall scrim box (279.3, 15.5,
#: 161.4 x 88): every one of these is flat near-black there — mean luminance 8-9 of 255 with a
#: standard deviation around 1, i.e. no artwork behind the title at all. `title-scrim.png` is a
#: flat 50%-black plate, so over 8/255 it lands about four levels darker than the slide. It
#: darkens nothing, flattens the starfield inside its rectangle, and leaves a visible edge. The
#: glow rule under the title already separates the header, so these need nothing. This is every
#: value of `SECTION_BG` plus the four unsectioned content plates, i.e. every content slide.
#:
#: Deliberately NOT here: `Media-inner-cover.jpg` (mean 7 but sd 7.9) and `cover-main.jpg`
#: (sd 18.2) are dark on average but carry artwork under the title, so they still want a scrim
#: or a `header_panel()`. Judge a new background by the stddev, not the mean.
NO_SCRIM_BACKGROUNDS = frozenset({
    "General inner.jpg", "strategy-inner.jpg", "product-inner.jpg", "creative-inner.jpg",
    "organic-inner.jpg", "Media-inner.jpg", "inner.jpg", "inner-black.jpg",
    "clients.jpg", "awards.jpg",
})

ASCENT = 1.005      # hhea.ascent / upm — ascender line to baseline
DESCENT = 0.295     # matches the 1.30em span box the source PDF reports for 10pt text

# How far below a box top a renderer puts the first baseline when the paragraph carries
# EXPLICIT line spacing (`spcPts`), as a fraction of that spacing.
#
# **This is no longer used to write anything.** It is renderer-dependent and that was a real
# bug: calibrated against Keynote it fits 0.80, but the macOS Office renderer (Quick Look)
# measures ~0.72, which drifts text by 1.5-2.3pt — more at display sizes. A deck cannot depend
# on the reader agreeing with the writer about this number.
#
# `text()` now sets NO line spacing and gives every line its own box at its own ascender Y.
# Geist has hhea.lineGap = 0, so natural single spacing puts the first baseline exactly
# `ASCENT` below the box top — which IS the ascender line. Box top = ascender Y, no constant.
# Measured after the change: Quick Look -0.26 to -1.34pt, Keynote -1.31 to +0.05pt, where
# Keynote's own 1px/pt export is +/-0.5pt of that.
#
# Kept because `audit()` still has to READ decks that were written the old way, or by hand.
FIRST_BASELINE = 0.80


def text_box_top(ascender_y, size, leading):
    """LEGACY: box top for a paragraph with explicit line spacing.

    Only for reading old output. `text()` positions by ascender Y directly.
    """
    return ascender_y + ASCENT * size - FIRST_BASELINE * leading


# ------------------------------------------------------------------------------ line budgets
#
# THE most common way to break this design system is to put more lines in a slot than the
# source deck has. Every y here was measured off a deck whose card labels are one line and
# whose cover title is one line; the divider rule and the body copy sit at fixed offsets right
# underneath. A two-line label does not push them down — it runs straight through them.
#
# Seen in a real skill test: `general-5` labels "FULL-FUNNEL CONTEXT" and "MEASUREMENT FIRST"
# wrapped to two lines and the hairline struck through the second word. Same slide set put a
# two-line 40pt cover title through the cover rule and into the subtitle. Both passed an anchor
# audit — the first line was perfectly placed. Only the line COUNT was wrong.
#
# So the budget is derived from the geometry itself: room between a slot and whatever sits
# below it, divided by the leading.

_FONT_DIRS = [os.path.expanduser("~/Library/Fonts"), "/Library/Fonts",
              "/usr/share/fonts/truetype", os.path.join(ROOT, "fonts")]
_FONT_FILES = {"Geist": "Geist-Regular.ttf", "Geist Light": "Geist-Light.ttf",
               "Geist Medium": "Geist-Medium.ttf", "Geist Bold": "Geist-Bold.ttf",
               "Geist ExtraLight": "Geist-ExtraLight.ttf",
               "Geist SemiBold": "Geist-SemiBold.ttf"}
_pil = {}


def _advance(txt, face, size):
    """Width of `txt` in points. Uses the real TTF when it is installed.

    Falls back to 0.50 em per character, which is close for Geist's lowercase and slightly
    under for caps — so an all-caps label is the case most likely to overflow unnoticed. The
    fallback exists so this never hard-fails in an environment without the fonts.
    """
    key = face
    if key not in _pil:
        _pil[key] = None
        try:
            from PIL import ImageFont
            for d in _FONT_DIRS:
                p = os.path.join(d, _FONT_FILES.get(face, "Geist-Regular.ttf"))
                if os.path.isfile(p):
                    _pil[key] = ImageFont.truetype(p, 100)
                    break
        except Exception:
            pass
    f = _pil[key]
    if f is None:
        return len(txt) * 0.50 * size
    return f.getlength(txt) / 100.0 * size


def wrapped_lines(runs, size, weight, width):
    """How many lines `runs` really occupies at `width` — explicit \\n plus wrapping."""
    if isinstance(runs, str):
        runs = [(runs, weight)]
    total = 0
    for chunk in "".join(t for t, _ in runs).split("\n"):
        words, cur, n = chunk.split(" "), "", 1
        for w in words:
            t = (cur + " " + w).strip()
            if _advance(t, FONTS[weight], size) <= width or not cur:
                cur = t
            else:
                n += 1
                cur = w
        total += n
    return total


#: Decoration, not layout. `glow` is a soft bloom pooled at the card's foot and `edgeLight`
#: straddles its bottom edge — both sit BEHIND the copy and neither is a collision boundary.
#: Counting them bounds `general-5`'s body at 3 lines when 5 fit inside the card perfectly.
_DECOR_SLOTS = {"glow", "edgeLight"}


def line_budget(variant, slot):
    """Lines that fit in a card slot before it collides with what is below it.

    Only real layout elements bound a slot — the next text block, or the divider rule, or
    failing that the bottom of the card. See `_DECOR_SLOTS`.
    """
    row = GEO["CARD_ROWS"].get(variant)
    L = GEO["CARD_LAYOUT"].get(variant, {})
    if not row or slot not in L or "size" not in L[slot]:
        return None
    y = L[slot]["y"]
    below = sorted(v["y"] for k, v in L.items()
                   if isinstance(v, dict) and "y" in v and k not in _DECOR_SLOTS
                   and v["y"] > y)
    room = (below[0] if below else row["h"]) - y
    lead = L[slot].get("leading", L[slot]["size"] * 1.3)
    return max(1, int(room // lead))


WARNINGS = []


def _check(where, runs, size, weight, width, budget):
    if not budget:
        return
    n = wrapped_lines(runs, size, weight, width)
    if n > budget:
        flat = ("".join(t for t, _ in runs) if not isinstance(runs, str) else runs)
        WARNINGS.append(f"{where}: {n} lines in a {budget}-line slot — "
                        f"\"{flat.replace(chr(10), ' / ')[:44]}\"")


# --------------------------------------------------------------------------------- helpers

def _alpha(fill_elm, opacity):
    """python-pptx has no fill-transparency API — write <a:alpha> into the solidFill."""
    if opacity >= 1:
        return
    clr = fill_elm.find(qn("a:solidFill"))
    if clr is None:
        return
    srgb = clr.find(qn("a:srgbClr"))
    if srgb is None:
        return
    a = srgb.makeelement(qn("a:alpha"), {"val": str(int(round(opacity * 100000)))})
    srgb.append(a)


def _rgb(hex_str):
    return RGBColor.from_string(hex_str.lstrip("#").upper())


class Slide:
    """One slide. All coordinates in points, origin top-left."""

    def __init__(self, deck, slide, background=None):
        self.deck = deck
        self.s = slide
        #: kept so `header()` can tell whether a scrim would read as a box — see
        #: NO_SCRIM_BACKGROUNDS
        self.background = background
        if background:
            self.image(os.path.join(ASSETS, "backgrounds", background),
                       0, 0, CANVAS_W, CANVAS_H)

    # ------------------------------------------------------------------ raw primitives

    def image(self, path, x, y, w=None, h=None):
        if not os.path.isabs(path):
            path = os.path.join(ASSETS, path)
        return self.s.shapes.add_picture(path, Pt(x), Pt(y),
                                         Pt(w) if w else None, Pt(h) if h else None)

    def glass(self, x, y, w, h, tone="card", radius=11.4, edge_light=None,
              edge_asset="rule-glow.png"):
        """A glass panel: rounded rect in a measured tone, plus its bottom light-catch.

        `tone` keys `GLASS_TONES` — pick by what is BEHIND the panel, not by what it holds.
        A white 2.53% card over bright artwork is invisible; those need `panel` or `smoked`.
        `edge_light` is a dict {y, w, h} from `CARD_LAYOUT[variant].edgeLight`, offset from
        the panel's own top edge.
        """
        t = GEO["GLASS_TONES"][tone]
        sh = self.s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                     Pt(x), Pt(y), Pt(w), Pt(h))
        sh.adjustments[0] = min(0.5, radius / min(w, h))
        sh.shadow.inherit = False
        sh.fill.solid()
        sh.fill.fore_color.rgb = _rgb(t["fill"])
        _alpha(sh.fill._xPr, t["opacity"])
        if t["stroke"]:
            sh.line.color.rgb = _rgb(t["stroke"])
            sh.line.width = Pt(0.75)
        else:
            sh.line.fill.background()
        sh.text_frame.text = ""
        if edge_light:
            self.image(os.path.join(ASSETS, "decor", edge_asset),
                       x + (w - edge_light["w"]) / 2, y + edge_light["y"],
                       edge_light["w"], edge_light["h"])
        return sh

    def text(self, x, ascender_y, runs, size=10, leading=13.5, weight="Light",
             color="FFFFFF", align="left", width=None, opacity=None):
        """Text whose FIRST LINE'S ASCENDER lands on `ascender_y` — pass geometry y as-is.

        `runs` is a string, or a list of (text, weight) pairs for inline emphasis:
            [("Achieving ", "Light"), ("+61%", "Bold"), (" organic growth.", "Light")]
        Newlines start a new line `leading` further down.

        **One box per line, and no explicit line spacing.** That is what makes this
        renderer-independent — see the note on `text_box_top`. Each line is positioned from
        its own ascender Y, so nothing downstream has to agree with us about how exact line
        spacing places a first baseline.
        """
        if width is None:
            width = CANVAS_W - x
        if isinstance(runs, str):
            runs = [(runs, weight)]

        lines, cur = [], []
        for txt, w in runs:
            parts = txt.split("\n")
            for i, part in enumerate(parts):
                if i:
                    lines.append(cur)
                    cur = []
                if part:
                    cur.append((part, w))
        lines.append(cur)

        boxes = []
        for i, line in enumerate(lines):
            if not line:
                continue
            top = ascender_y + i * leading
            if top >= CANVAS_H:
                break
            h = min(size * 1.35, CANVAS_H - top)     # 1.30 em box + a hair, clamped
            tb = self.s.shapes.add_textbox(Pt(x), Pt(top), Pt(width), Pt(max(1.0, h)))
            tf = tb.text_frame
            tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.TOP
            p = tf.paragraphs[0]
            p.space_before = Pt(0)
            p.space_after = Pt(0)
            # NO p.line_spacing — natural single spacing is what every renderer agrees on
            p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                           "right": PP_ALIGN.RIGHT}[align]
            for txt, w in line:
                r = p.add_run()
                r.text = txt
                r.font.name = FONTS[w]
                r.font.size = Pt(size)
                r.font.color.rgb = _rgb(color)
                if opacity is not None:
                    _alpha(r.font.color._xFill.getparent(), opacity)
            boxes.append(tb)
        return boxes[0] if boxes else None

    def motion(self, name, x=0, y=0, w=None, h=None):
        """Place an animated loop from `assets/motion/`. Pass the bare name, no extension.

        The skill's motion set is **animated GIF** because that is what PowerPoint and Google
        Slides actually play — animated WebP renders as a single still frame in both, so never
        reach for a `.webp` here even if you see one in the repo.

        Full-bleed loops (`cover`, `mix`, `mobi`) replace the background, so call this instead
        of passing a background to `slide()`, not as well as:

            s = d.slide()                      # no background
            s.motion("cover")                  # fills the canvas
        """
        f = os.path.join(ASSETS, "motion", f"{name}.gif")
        if not os.path.isfile(f):
            avail = sorted(n[:-4] for n in os.listdir(os.path.join(ASSETS, "motion"))
                           if n.endswith(".gif"))
            raise KeyError(f"no motion loop {name!r}; available: {', '.join(avail)}")
        if w is None and h is None:
            w, h = CANVAS_W, CANVAS_H
        return self.image(f, x, y, w, h)

    def video(self, name, x, y, w, h, poster=None):
        """Embed one of the `.mp4` loops.

        **This plays in PowerPoint and Keynote but not in Google Slides.** Slides will not play
        video that arrived inside a .pptx — it only plays video from Drive or YouTube. If the
        deck is headed for Slides, either use `motion()` with a GIF loop, or upload the mp4 to
        Drive and add it in Slides with *Insert > Video* after import. `poster` draws a still
        underneath so the slide is never empty if playback is unavailable.
        """
        if poster:
            self.image(poster, x, y, w, h)
        f = os.path.join(ASSETS, "motion", f"{name}.mp4")
        if not os.path.isfile(f):
            avail = sorted(n[:-4] for n in os.listdir(os.path.join(ASSETS, "motion"))
                           if n.endswith(".mp4"))
            raise KeyError(f"no video loop {name!r}; available: {', '.join(avail)}")
        return self.s.shapes.add_movie(f, Pt(x), Pt(y), Pt(w), Pt(h),
                                       poster_frame_image=poster)

    def glow_rule(self, asset, x, centre_y, w):
        """A glow rule at its NATIVE aspect, vertically centred on `centre_y`.

        These assets are ~13:1 bands of soft bloom (rule-glow is 1600x123). Forcing one to a
        1pt-tall line throws the bloom away and the rule reads as absent, so derive the height
        from the asset rather than inventing one.

        This is for the **title** underline and the card **edge-light**. A card's internal
        divider is not one of these — see `hairline()`.
        """
        px = self.deck.dims["decor"][asset]
        h = w * px[1] / px[0]
        return self.image(os.path.join(ASSETS, "decor", asset), x, centre_y - h / 2, w, h)

    def hairline(self, x, y, w, color=HAIRLINE):
        """The 0.75pt divider inside a card. A flat line, NOT a glow.

        Measured on p8: the brightest pixel across the divider is (60,65,71) against a
        #272D3B card border — a dim grey rule. Substituting a `rule-*.png` bloom here puts a
        cyan flare in the middle of the card that the source does not have.
        """
        sh = self.s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Pt(x), Pt(y), Pt(w), Pt(0.75))
        sh.shadow.inherit = False
        sh.fill.solid()
        sh.fill.fore_color.rgb = _rgb(color)
        sh.line.fill.background()
        return sh

    def icon(self, name, cx, top, height):
        """Icon at NATIVE aspect, height-constrained, horizontally centred on `cx`.

        Never force an icon into a square box — the deck's icons are ink-tight and letterbox
        visibly. Widths come from `reference/asset-dimensions.json`.

        Accepts either the file stem (`user-flow`) or the camelCase name the React library
        uses (`userFlow`); both resolve to the same asset.
        """
        f = self.deck.icon_file(name)
        dims = self.deck.dims["icons"][f]
        w = height * dims[0] / dims[1]
        return self.image(os.path.join(ASSETS, "icons", f), cx - w / 2, top, w, height)

    # -------------------------------------------------------------------- archetypes

    def cover(self, title, subtitle=None, logo=True):
        """The cover: big Bold title, glow rule, subtitle. Pair with `cover-main.jpg`.

        The measured slot holds **one** line of 40pt in a 320pt column — the source cover is
        "Company Deck". A longer title wraps, and because the rule and subtitle sit at fixed
        offsets underneath, a naive build strikes the rule through the second line and lands
        the subtitle on its descenders. Both real skill tests did exactly this.

        So this deliberately deviates from the measured geometry when it has to: the title
        stays anchored at y 149.41, and the rule and subtitle shift down by one leading per
        extra line. The top anchor is what reads as on-brand; the gap below it is not measured
        against anything. Keep the title to two lines — three pushes the subtitle off the
        plate.
        """
        C = COVER = GEO["COVER"]
        if logo:
            lg = C["logo"]
            self.image(os.path.join(ASSETS, "decor", "moburst-logo.png"),
                       lg["x"], lg["y"], lg["w"])
        t = C["title"]
        n = wrapped_lines(title, t["size"], "Bold", t["w"])
        if n > 2:
            WARNINGS.append(f"cover title: {n} lines at 40pt — keep it to 2 "
                            f"(\"{title[:40]}\")")
        shift = (n - 1) * t["leading"]
        self.text(t["x"], t["y"], title, size=t["size"], leading=t["leading"],
                  weight="Bold", width=t["w"])
        r = C["rule"]
        self.glow_rule("rule-glow.png", r["x"], r["y"] + shift + r["h"] / 2, r["w"])
        if subtitle:
            sb = C["subtitle"]
            self.text(sb["x"], sb["y"] + shift, subtitle, size=sb["size"],
                      leading=sb["leading"], weight="Light", width=sb["w"])

    def header(self, title, intro=None, scrim="auto"):
        """Slide title at the measured anchor, over its scrim, with the glow rule beneath.

        `scrim` is "tall" (the one that actually spans the title at y 25.71), "short" (7 slides,
        a band BELOW the title), None (the 13 full-bleed artwork slides), or "auto".

        **"auto" is the default and it drops the scrim on content slides.** The scrim is a flat
        50%-black plate: it disappears over artwork, but over the near-black content plates it
        lands only about four levels darker than the slide, so instead of darkening anything it
        flattens the starfield and leaves a hard edge. "auto" resolves to None for every
        background in NO_SCRIM_BACKGROUNDS and to "tall" everywhere else. The glow rule is drawn
        either way and is what carries the header on those slides.

        Pass a value explicitly to override: `scrim="tall"` forces the plate back on, `None`
        removes it anywhere. Passing "short" for a titled slide leaves a detached grey box under
        the text. Over busy artwork or video prefer a glass `header_panel()` to any scrim — see
        the scrim trap in SKILL.md.
        """
        H = GEO["HEADER"]
        if scrim == "auto":
            scrim = None if self.background in NO_SCRIM_BACKGROUNDS else "tall"
        if scrim:
            sc = H["scrim"][scrim]
            self.image(os.path.join(ASSETS, "decor", "title-scrim.png"),
                       sc["x"], sc["y"], sc["w"], sc["h"])
        t = H["title"]
        g = H["glow"]
        _check("header title", title, t["size"], "Regular", t["w"],
               max(1, int((g["y"] - t["y"]) // t["leading"])))
        self.text(t["x"], t["y"], title, size=t["size"], leading=t["leading"],
                  weight="Regular", align="center", width=t["w"])
        self.glow_rule("title-glow.png", g["x"], g["y"] + g["h"] / 2, g["w"])
        if intro:
            i = H["intro"]
            self.text(i["x"], i["y"], intro, size=i["size"], leading=i["leading"],
                      weight="Light", align="center", width=i["w"])

    def card_row(self, variant, cards, glow=False, edge="rule-glow.png"):
        """A row of glass cards. `variant` keys `CARD_ROWS`, e.g. "general-5", "services-5".

        Cards are placed from the measured `xs` — never from `x + pitch * i`. `general-4` is
        a 2+2 split around a centred graphic, so even pitch would drop cards on the artwork.
        """
        row = GEO["CARD_ROWS"][variant]
        L = GEO["CARD_LAYOUT"].get(variant, {})
        xs = row.get("xs")
        if xs is None:
            raise KeyError(f"{variant} has no measured xs")
        if len(cards) > len(xs):
            raise ValueError(f"{variant} holds {len(xs)} cards, got {len(cards)}")

        slot = row.get("centreSlot")
        if slot and slot.get("art"):
            self.image(slot["art"], slot["x"], slot["y"], slot["w"], slot["h"])

        for c, x in zip(cards, xs):
            self.glass(x, row["y"], row["w"], row["h"], tone=c.get("tone", "card"),
                       edge_light=L.get("edgeLight"), edge_asset=edge)
            if glow and L.get("glow"):
                g = L["glow"]
                self.image(os.path.join(ASSETS, "decor", "card-glow.png"),
                           x + (row["w"] - g["w"]) / 2, row["y"] + g["y"], g["w"], g["h"])
            cx = x + row["w"] / 2
            if c.get("icon") and L.get("icon"):
                self.icon(c["icon"], cx, row["y"] + L["icon"]["y"], L["icon"]["h"])
            if c.get("label") and L.get("label"):
                lb = L["label"]
                _check(f'{variant} label', c["label"], lb["size"],
                       lb.get("weight", "Medium"), row["w"], line_budget(variant, "label"))
                self.text(x, row["y"] + lb["y"], c["label"], size=lb["size"],
                          leading=lb["leading"], weight=lb.get("weight", "Medium"),
                          align="center", width=row["w"])
            if L.get("rule"):
                ru = L["rule"]
                self.hairline(x + ru["inset"], row["y"] + ru["y"], ru["w"])
            if c.get("heading") and L.get("heading"):
                hd = L["heading"]
                _check(f'{variant} heading', c["heading"], hd["size"], "Medium", row["w"],
                       line_budget(variant, "heading"))
                self.text(x, row["y"] + hd["y"], c["heading"], size=hd["size"],
                          leading=hd["leading"], weight="Medium", align="center",
                          width=row["w"])
            if c.get("chips") and L.get("chips"):
                # stacked mini-chips — the defining feature of chips-5, one per pitch step
                ch = L["chips"]
                for j, label in enumerate(c["chips"]):
                    cy = row["y"] + ch["y"] + j * ch["pitch"]
                    self.glass(x + 12.7, cy, row["w"] - 25.4, ch["pitch"] - 3.5,
                               tone="chip", radius=5.0)
                    self.text(x + 12.7, cy + 3.4, label, size=ch["size"],
                              leading=ch["size"] * 1.3, weight="Light", align="center",
                              width=row["w"] - 25.4)
            if c.get("body") and L.get("body"):
                bd = L["body"]
                _check(f'{variant} body', c["body"], bd["size"], "Light", row["w"],
                       line_budget(variant, "body"))
                self.text(x, row["y"] + bd["y"], c["body"], size=bd["size"],
                          leading=bd["leading"], weight="Light", align="center",
                          width=row["w"])
            if c.get("footer") and L.get("footer"):
                ft = L["footer"]
                if ft.get("rule"):
                    self.hairline(x + (L["rule"]["inset"] if L.get("rule") else 12.7),
                                  row["y"] + ft["rule"],
                                  L["rule"]["w"] if L.get("rule") else row["w"] - 25.4)
                self.text(x, row["y"] + ft["y"], c["footer"], size=ft["size"],
                          leading=ft["leading"], weight="Light", align="center",
                          width=row["w"])

    def icon_grid(self, cols, cards):
        """Two rows of icon cards. `cols` is 3, 4 or 5, keyed off `ICON_GRIDS`."""
        g = GEO["ICON_GRIDS"][str(cols)]
        L = GEO["ICON_CARD_LAYOUT"][str(cols)]   # keyed by column count, not one shared dict
        for i, c in enumerate(cards):
            x = g["x"] + g["pitch"] * (i % cols)
            y = g["rows"][i // cols]
            self.glass(x, y, g["w"], g["h"], edge_light=L.get("edgeLight"))
            cx = x + g["w"] / 2
            if c.get("icon"):
                self.icon(c["icon"], cx, y + L["icon"]["y"], L["icon"]["h"])
            lb = L["label"]
            self.text(x, y + lb["y"], c["label"], size=lb["size"], leading=lb["leading"],
                      weight=lb.get("weight", "Medium"), align="center", width=g["w"])

    def panel_glow(self, kind, x, y, w, h):
        """The edge-light (and interior pool, where the deck has one) for a big panel.

        Rule 4 applies to panels, not just cards: a stat panel or caption bar drawn as a flat
        rectangle does not read as glass. `kind` keys `PANEL_GLOW` — caption, stat, showcase,
        shell. Offsets are from the panel's BOTTOM edge, and negative `dy` lifts.
        """
        g = GEO["PANEL_GLOW"][kind]
        if "pool" in g:
            p = g["pool"]
            self.image(os.path.join(ASSETS, "decor", "card-glow.png"),
                       x + (w - p["w"]) / 2, y + h + p["dy"], p["w"], p["h"])
        li = g["light"]
        self.image(os.path.join(ASSETS, "decor", "rule-glow.png"),
                   x + (w - li["w"]) / 2, y + h + li["dy"], li["w"], li["h"])

    def header_panel(self, title, subtitle=None, tone="smoked"):
        """Glass header panel — the header to use over artwork or video.

        The title scrim is a flat 50%-black plate and reads as a hard box over an
        illustration. This is the measured alternative: x 72, y 87, 573 x 94.

        **Pick the tone by what is behind it**, exactly as for cards. `smoked` (dark, the
        default) over BRIGHT artwork; `panel` (white 4.7%) only over DARK artwork. The default
        is the dark one because this panel exists for the busy-background case — a white 4.7%
        plate over the five-robot Perfect Mix plate is invisible, and the title then has
        nothing behind it.
        """
        P = GEO["HEADER_PANEL"]
        self.glass(P["x"], P["y"], P["w"], P["h"],
                   tone=GEO["HEADER_PANEL_TONE"].get(tone, tone), radius=P["radius"])
        self.panel_glow("shell", P["x"], P["y"], P["w"], P["h"])
        t = P["titleWithSub"] if subtitle else P["title"]
        self.text(P["x"], t["y"], title, size=t["size"], leading=t["leading"],
                  weight="Bold", align="center", width=P["w"])
        if subtitle:
            sb = P["subtitle"]
            self.text(P["x"], sb["y"], subtitle, size=sb["size"], leading=sb["leading"],
                      weight="Light", align="center", width=P["w"])

    def section_divider(self, section, subtitle=None):
        """A section divider. The huge word and the coloured robot are IN the background —
        drop a subtitle and nothing else. `section` is strategy/product/creative/organic/media.
        """
        A = GEO["TEXT_ANCHORS"]["dividerSubtitle"]
        if subtitle:
            # centered, like the reference — the subtitle sits centered in the baked pill
            self.text(160, A["y"], subtitle, size=A["size"], leading=A["leading"],
                      weight="Light", align="center", width=400)

    def sub_divider(self, title):
        """A sub-section title dropped into the glass panel already drawn in the artwork.

        Pair with `organic-inner-cover.jpg`, `Media-inner-cover.jpg` or `quote.jpg`.
        """
        A = GEO["TEXT_ANCHORS"]["subDividerTitle"]
        self.text(60, A["y"], title, size=A["size"], leading=A["leading"],
                  weight="Bold", align="center", width=600)

    def process_flow(self, steps, per_row=4):
        """Chips joined by arrows — pipelines and stage models. Up to 2 rows of `per_row`."""
        P = GEO["PROCESS"]
        cw, ch = P["chip"]["w"], P["chip"]["h"]
        for i, s in enumerate(steps[:per_row * len(P["rows"])]):
            col, r = i % per_row, i // per_row
            x, y = P["x"] + col * P["pitchX"], P["rows"][r]
            self.glass(x, y, cw, ch, tone="chip", radius=8.0)
            _check("process chip", s, P["textSize"], "Light", cw, 2)
            self.text(x, y + P["textY"], s, size=P["textSize"],
                      leading=P["textSize"] * 1.3, weight="Light", align="center", width=cw)
            last = col == per_row - 1 or i == len(steps) - 1
            if not last:
                a = P["arrow"]
                self.image(os.path.join(ASSETS, "art", "object-arrow.png"),
                           x + cw + a["gap"], y + ch / 2 - 3.5, a["w"], 7.0)

    def stat_callout(self, stat, support=None, footnote=None):
        """A headline number. The number sits **above** the panel (p76), not inside it."""
        A, P = GEO["TEXT_ANCHORS"], GEO["STAT"]["panel"]
        # Panel FIRST. The number straddles the panel's top edge and the deck keeps it crisp
        # white all the way down (p76) — painting the 53%-opaque glass over it instead greys
        # the lower two thirds of the glyph.
        self.glass(P["x"], P["y"], P["w"], P["h"], tone="stat", radius=P["radius"])
        self.panel_glow("stat", P["x"], P["y"], P["w"], P["h"])
        self.text(0, A["statBig"]["y"], stat, size=A["statBig"]["size"],
                  leading=A["statBig"]["leading"], weight="Bold", align="center",
                  width=CANVAS_W)
        if support:
            sp = A["statSupport"]
            self.text(P["x"], sp["y"], support, size=sp["size"], leading=sp["leading"],
                      weight="Light", align="center", width=P["w"])
        if footnote:
            # not a measured slot — the deck has no footnote on p76. 12pt under the panel.
            self.text(P["x"], P["y"] + P["h"] + 12, footnote, size=8.5, leading=11.5,
                      weight="Light", color="8892A6", align="center", width=P["w"])

    def caption_bar(self, caption):
        """Smoked-glass bar over full-bleed artwork. Pair with `mix.jpg` and NO title scrim —
        use `header_panel()` if the slide needs a title.
        """
        P, A = GEO["CAPTION"]["panel"], GEO["TEXT_ANCHORS"]["caption"]
        self.glass(P["x"], P["y"], P["w"], P["h"], tone="smoked", radius=P["radius"])
        self.panel_glow("caption", P["x"], P["y"], P["w"], P["h"])
        _check("caption", caption, A["size"], "Light", P["w"], 2)
        self.text(P["x"], A["y"], caption, size=A["size"], leading=A["leading"],
                  weight="Light", align="center", width=P["w"])

    def showcase(self, image, tags_left=(), tags_right=()):
        """Centred media panel with tag chips pinned to the row they label.

        `tags_left` / `tags_right` are (label, y) pairs — y is the chip's own top edge.
        """
        P, T = GEO["SHOWCASE"]["panel"], GEO["SHOWCASE"]["tag"]
        self.glass(P["x"], P["y"], P["w"], P["h"], tone="panel", radius=11.4)
        self.panel_glow("showcase", P["x"], P["y"], P["w"], P["h"])
        if image:
            self.image(image, P["x"] + 8, P["y"] + 8, P["w"] - 16, P["h"] - 16)
        for side, tags in (("l", tags_left), ("r", tags_right)):
            for label, ty in tags:
                tx = (P["x"] - T["gap"] - T["w"]) if side == "l" else (P["x"] + P["w"] + T["gap"])
                self.glass(tx, ty, T["w"], T["h"], tone="chip", radius=8.0)
                self.text(tx, ty + T["textDy"], label, size=T["size"],
                          leading=T["size"] * 1.3, weight="Light", align="center",
                          width=T["w"])

    def toggle_list(self, rows, active=0, media=None, note=None):
        """Progressive-reveal list. Rows are DYNAMIC: collapsed ~41pt, the open one ~82pt
        because its body sits underneath. Only the active row shows body copy.

        `media` must be a **dark** screenshot — a bright one swamps the frame's own hairline
        and glow and the panel then reads as the wrong size even though its geometry is exact.
        """
        T = GEO["TOGGLE"]
        y = T["firstY"]
        for i, r in enumerate(rows):
            on = i == active
            self.image(os.path.join(ASSETS, "decor",
                                    "toggle-on.png" if on else "toggle-off.png"),
                       T["pill"]["x"], y, T["pill"]["w"], T["pill"]["h"])
            lb = T["label"]
            self.text(lb["x"], y + (lb["dyLit"] if on else lb["dyDim"]), r["label"],
                      size=lb["size"], leading=lb["leading"], weight="Medium",
                      opacity=None if on else 0.45)
            if on and r.get("body"):
                bd = T["body"]
                self.text(bd["x"], y + bd["dy"], r["body"], size=bd["size"],
                          leading=bd["leading"], weight="Light", width=165)
            y += (T["pitchOpen"] if on
                  else T["pitchBeforeOpen"] if i < active else T["pitchAfterOpen"])
        # Draw the panel at TOGGLE.frame, not TOGGLE.media. `media` is the bounds of the
        # media-frame bloom image, which the deck deliberately runs to x 749 — off the slide.
        # The web build can place that image with a `lighten` blend; a .pptx has no blend
        # modes, so a deck uses the frame's real rect and its own edge-light instead.
        F = T["frame"]
        self.glass(F["x"], F["y"], F["w"], F["h"], tone="panel", radius=11.4)
        self.panel_glow("shell", F["x"], F["y"], F["w"], F["h"])
        if media:
            mi = T["mediaInset"]
            self.image(media, F["x"] + mi["dx"], F["y"] + mi["dy"], mi["w"], mi["h"])
        if note:
            nt = T["note"]
            self.text(nt["x"], nt["y"], note, size=9, leading=12, weight="Light",
                      align="center", width=nt["w"])

    def quote_bar(self, quote, attribution=None, logo=None):
        """The white quote bar — the deck's only light surface, and the only place
        #0A1016 text appears. The 100pt open-quote glyph hangs off the corner by design.
        """
        C, Q = GEO["CASE"]["quote"], GEO["QUOTE"]
        self.glass(C["x"], C["y"], C["w"], C["h"], tone="light", radius=C["radius"])
        self.text(C["x"] + Q["mark"]["dx"], C["y"] + Q["mark"]["dy"], "”",
                  size=Q["mark"]["size"], leading=Q["mark"]["size"] * 1.3,
                  weight="Medium", color="B7B7B7", width=120)
        qt = Q["text"]
        self.text(C["x"] + qt["dx"], C["y"] + qt["dy"], quote, size=qt["size"],
                  leading=qt["leading"], weight="Medium", color="0A1016",
                  width=Q["divider"]["dx"] - qt["dx"] - 10)
        if attribution:
            dv = Q["divider"]
            self.text(C["x"] + dv["dx"], C["y"] + dv["dy"], "|", size=dv["size"],
                      leading=dv["size"] * 1.3, weight="ExtraLight", color="0A1016",
                      width=20)
            at = Q["attrib"]
            self.text(C["x"] + at["dx"], C["y"] + at["dy"], attribution, size=at["size"],
                      leading=at["leading"], weight="Medium", color="0A1016",
                      width=C["w"] - at["dx"] - 40)
        if logo:
            lg = Q["logo"]
            self.image(logo, C["x"] + lg["dx"], C["y"] + lg["dy"], lg["w"], lg["h"])

    def case_study(self, bodies, art=None, quote=None, attribution=None):
        """Case-study row: body cards plus an optional art slot, kept centred on x 360.

        The row's left edge DEPENDS on the art width — see the note on `CASE.row`. Three
        bodies with no art centre at x 125.98, not the p19 value of 37.27.
        """
        C = GEO["CASE"]
        art_w = C["art"]["w"] if art else 0
        n = len(bodies)
        span = C["row"]["pitch"] * (n - 1 + (1 if art else 0)) + (art_w or C["row"]["w"])
        x0 = CANVAS_W / 2 - span / 2
        for i, body in enumerate(bodies):
            x = x0 + C["row"]["pitch"] * i
            self.glass(x, C["row"]["y"], C["row"]["w"], C["row"]["h"])
            self.text(x + C["textInset"]["x"], C["row"]["y"] + C["textInset"]["y"], body,
                      size=C["textSize"], leading=C["textLeading"], weight="Light",
                      width=C["row"]["w"] - 2 * C["textInset"]["x"])
        if art:
            self.image(art, x0 + C["row"]["pitch"] * n, C["art"]["y"],
                       art_w, C["art"]["h"])
        if quote:
            # measured offsets, not invented ones — see quote_bar / QUOTE
            self.quote_bar(quote, attribution)


class Deck:
    """A 720 x 405 pt (Google Slides 16:9) deck."""

    def __init__(self):
        self.prs = Presentation()
        self.prs.slide_width, self.prs.slide_height = Pt(CANVAS_W), Pt(CANVAS_H)
        self.blank = self.prs.slide_layouts[6]
        with open(os.path.join(ROOT, "reference", "asset-dimensions.json")) as fh:
            self.dims = json.load(fh)

    def icon_file(self, name):
        """Resolve an icon name to its filename, accepting kebab-case or camelCase."""
        if f"{name}.png" in self.dims["icons"]:
            return f"{name}.png"
        kebab = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()
        if f"{kebab}.png" in self.dims["icons"]:
            return f"{kebab}.png"
        raise KeyError(f"unknown icon {name!r} (tried {name}.png and {kebab}.png) — "
                       f"see reference/asset-index.md for the 71 available names")

    def slide(self, background=None):
        return Slide(self, self.prs.slides.add_slide(self.blank), background)

    def save(self, path, strict=False):
        """Write the deck. Prints any line-budget overflows — see `line_budget`.

        These are the failures that an anchor audit cannot see, because the first line is
        placed perfectly and only the count is wrong. Pass `strict=True` to raise instead.
        """
        self.prs.save(path)
        if WARNINGS:
            print(f"  {len(WARNINGS)} line-budget overflow(s) — text will collide with the "
                  f"element below it:")
            for w in WARNINGS:
                print(f"     {w}")
            print("     Shorten the copy, or move to a variant with a taller slot "
                  "(tall-5 / short-5 labels hold 3 lines; general-5 holds 1).")
            if strict:
                raise ValueError(f"{len(WARNINGS)} line-budget overflow(s)")
        return path


# ----------------------------------------------------------------------------------- audit

def anchors():
    """Every legitimate absolute ascender line in the system, name -> y.

    Card and grid internals are stored as offsets from their own card, so they have to be
    added to the row's y to become comparable with a shape's position on the slide.
    """
    A = {}
    A["HEADER.title"] = GEO["HEADER"]["title"]["y"]
    A["HEADER.intro"] = GEO["HEADER"]["intro"]["y"]
    for k, v in GEO["TEXT_ANCHORS"].items():
        A[f"TEXT_ANCHORS.{k}"] = v["y"]
    for grp in ("COVER", "STAT", "CAPTION", "SHOWCASE"):
        for k, v in GEO.get(grp, {}).items():
            if isinstance(v, dict) and "y" in v and "size" in v:
                A[f"{grp}.{k}"] = v["y"]
    for var, row in GEO["CARD_ROWS"].items():
        for el, d in GEO["CARD_LAYOUT"].get(var, {}).items():
            if isinstance(d, dict) and "y" in d and "size" in d:
                A[f"{var}.{el}"] = round(row["y"] + d["y"], 2)
    for cols, g in GEO["ICON_GRIDS"].items():
        for el, d in GEO["ICON_CARD_LAYOUT"][cols].items():
            if isinstance(d, dict) and "y" in d and "size" in d:
                for r, ry in enumerate(g["rows"]):
                    A[f"grid{cols}.{el}.r{r}"] = round(ry + d["y"], 2)
    P = GEO["PROCESS"]
    for r, ry in enumerate(P["rows"]):
        A[f"PROCESS.text.r{r}"] = round(ry + P["textY"], 2)
    C = GEO["CASE"]
    A["CASE.body"] = round(C["row"]["y"] + C["textInset"]["y"], 2)
    for k, v in GEO["QUOTE"].items():
        if isinstance(v, dict) and "dy" in v:
            A[f"QUOTE.{k}"] = round(C["quote"]["y"] + v["dy"], 2)
    T = GEO["TOGGLE"]
    A["TOGGLE.label"] = round(T["firstY"] + T["label"]["dyLit"], 2)
    A["TOGGLE.body"] = round(T["firstY"] + T["body"]["dy"], 2)
    if "note" in T:
        A["TOGGLE.note"] = T["note"]["y"]
    S = GEO["STAT"]["panel"]
    A["STAT.footnote"] = round(S["y"] + S["h"] + 12, 2)   # an extension, not measured
    return A


def audit(path, tol=2.0):
    """Check a built .pptx against the measured system. Returns a findings dict.

        from mbdeck import audit
        for line in audit("deck.pptx")["report"]: print(line)

    Catches the four things that actually went wrong in a real skill test: text drifting off
    the measured anchors, shapes off the canvas, weight collapsed to one Geist face, and
    animated WebP used where it will render as a still frame. Run it before handing a deck
    over — "it looked fine in the thumbnails" is how a 5pt drift ships.
    """
    import re
    import xml.etree.ElementTree as ET
    import zipfile

    NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    EMU = 12700.0
    A = anchors()
    z = zipfile.ZipFile(path)
    slides = sorted((n for n in z.namelist()
                     if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                    key=lambda n: int(re.search(r"\d+", n.split("/")[-1]).group()))

    drift, off_canvas, faces, runs, custom = [], [], set(), 0, 0
    for i, fn in enumerate(slides, 1):
        root = ET.fromstring(z.read(fn))
        for sp in root.iter():
            if sp.tag.split("}")[-1] not in ("sp", "pic"):
                continue
            xf = sp.find(".//a:xfrm", NS)
            if xf is None:
                continue
            off, ext = xf.find("a:off", NS), xf.find("a:ext", NS)
            if off is None or ext is None:
                continue
            x, y = int(off.get("x")) / EMU, int(off.get("y")) / EMU
            w, h = int(ext.get("cx")) / EMU, int(ext.get("cy")) / EMU
            txt = "".join(t.text or "" for t in sp.iter() if t.tag.endswith("}t"))
            if x < -1 or y < -1 or x + w > CANVAS_W + 1 or y + h > CANVAS_H + 1:
                off_canvas.append((i, (txt or "shape")[:24], round(x, 1), round(y, 1)))
            rpr = sp.find(".//a:rPr", NS)
            lat = rpr.find("a:latin", NS) if rpr is not None else None
            if lat is not None:
                faces.add(lat.get("typeface"))
            ln = sp.find(".//a:lnSpc/a:spcPts", NS)
            if rpr is None or not rpr.get("sz") or not txt.strip():
                continue
            runs += 1
            size = int(rpr.get("sz")) / 100
            if ln is None:
                # no explicit spacing: box top IS the ascender line (Geist lineGap = 0)
                asc, lead = y, size * 1.3
            else:
                lead = int(ln.get("val")) / 100
                asc = y + FIRST_BASELINE * lead - ASCENT * size
            # Match against the anchor GRID, not just the anchor: `text()` gives every line
            # its own box, so line k of a block legitimately sits at anchor + k*leading.
            best = min(((abs(asc - (v + k * lead)), k, n, v)
                        for n, v in A.items() for k in range(9)),
                       key=lambda z: z[0])
            gap, _k, name, ay = best
            # > 20pt from every anchor is a bespoke position, not a missed one. Flagging
            # those as "drift" buried the real near-misses under caller-chosen y values.
            if gap > 20.0:
                custom += 1
            elif gap > tol:
                drift.append((round(gap, 2), i, txt[:24], round(asc, 2), name, ay))
    drift.sort(reverse=True)

    # --- collisions: the failure an anchor check cannot see ------------------------------
    #
    # A box whose FIRST line is perfectly anchored can still hold more lines than the design
    # left room for, and then the divider rule or the copy below is struck through. Detected
    # geometrically rather than by matching y back to a named slot — two slots in different
    # variants can sit 1.2pt apart, and guessing between them invents failures that are not
    # there. Here a collision is a collision: this text's occupied box runs past the top of
    # something below it that it horizontally overlaps.
    #
    # Only thin rules (<=2pt tall) and other text count as obstructions. Glass panels sit
    # BEHIND copy by design, and the glow/edge-light artwork is meant to be overlapped.
    blocks = []
    for i, fn in enumerate(slides, 1):
        root = ET.fromstring(z.read(fn))
        for sp in root.iter():
            tag = sp.tag.split("}")[-1]
            if tag not in ("sp", "pic"):
                continue
            xf = sp.find(".//a:xfrm", NS)
            if xf is None:
                continue
            off, ext = xf.find("a:off", NS), xf.find("a:ext", NS)
            if off is None or ext is None:
                continue
            x, y = int(off.get("x")) / EMU, int(off.get("y")) / EMU
            w, h = int(ext.get("cx")) / EMU, int(ext.get("cy")) / EMU
            paras = [q for q in sp.findall(".//a:p", NS) if q.findall("a:r", NS)]
            rpr = sp.find(".//a:rPr", NS)
            ln = sp.find(".//a:lnSpc/a:spcPts", NS)
            if paras and rpr is not None and rpr.get("sz"):
                size = int(rpr.get("sz")) / 100
                if ln is None:
                    asc0, lead = y, size * 1.3
                else:
                    lead = int(ln.get("val")) / 100
                    asc0 = y + FIRST_BASELINE * lead - ASCENT * size
                # ink, not box: first ascender down to the last line's descender
                ink_bot = (asc0 + ASCENT * size + (len(paras) - 1) * lead
                           + DESCENT * size)
                txt = "".join(q.text or "" for q in sp.iter() if q.tag.endswith("}t"))
                blocks.append(dict(s=i, kind="text", x=x, w=w, top=asc0,
                                   bot=ink_bot, n=len(paras), lead=lead, t=txt))
            elif tag == "sp" and h <= 2.0 and w > 20:
                blocks.append(dict(s=i, kind="rule", x=x, w=w, top=y, bot=y + h, t="rule"))
    blocks = [b for b in blocks
              if not (b["kind"] == "text" and len(b["t"].strip()) <= 1)]

    overflow = []
    for b in blocks:
        if b["kind"] != "text":
            continue
        for o in blocks:
            if o is b or o["s"] != b["s"] or o["top"] < b["top"] + b["lead"] * 0.5:
                continue
            ox = max(b["x"], o["x"]); oxe = min(b["x"] + b["w"], o["x"] + o["w"])
            if oxe - ox < 0.5 * min(b["w"], o["w"]):
                continue                       # not really stacked
            intrude = b["bot"] - o["top"]
            if intrude > 2.0:
                fits = max(1, int((o["top"] - b["top"]) // b["lead"]))
                overflow.append((b["s"], o["kind"], b["n"], fits,
                                 round(intrude, 1), b["t"][:26]))
                break
    overflow.sort(key=lambda r: -r[4])

    media = [n for n in z.namelist() if n.startswith("ppt/media/")]
    webp = [n for n in media if n.lower().endswith(".webp")]
    gif = [n for n in media if n.lower().endswith(".gif")]
    stray = sorted(f for f in faces if f and not f.startswith("Geist"))
    weights = sorted(f for f in faces if f and f.startswith("Geist"))

    rep = [f"{len(slides)} slides, {runs} measured text runs, {len(media)} media parts"]
    ok = runs - len(drift) - custom
    rep.append(f"  anchors   {ok}/{runs} within {tol}pt"
               + (f", {custom} bespoke" if custom else "")
               + (f"  — worst {drift[0][0]}pt on slide {drift[0][1]}" if drift else ""))
    for d in drift[:6]:
        rep.append(f"     s{d[1]:<3} {d[0]:>5}pt off {d[4]} ({d[5]}) — \"{d[2]}\"")
    rep.append(f"  collisions {'none' if not overflow else str(len(overflow)) + ' — text runs into the rule or copy below it'}")
    for o in overflow[:6]:
        rep.append(f"     s{o[0]:<3} {o[2]} lines where {o[3]} fit — runs {o[4]}pt into "
                   f"the {o[1]} below — \"{o[5]}\"")
    rep.append(f"  canvas    {'clean' if not off_canvas else str(len(off_canvas)) + ' shape(s) OUTSIDE 720x405'}")
    for o in off_canvas[:5]:
        rep.append(f"     s{o[0]:<3} \"{o[1]}\" at x{o[2]} y{o[3]}")
    rep.append(f"  fonts     {len(weights)} Geist face(s): {', '.join(weights) or 'NONE'}")
    if len(weights) <= 1:
        rep.append("     ONE FACE ONLY — Light body and Medium labels have collapsed to "
                   "Regular. Ask for faces by name; see FONTS.")
    if stray:
        rep.append(f"     NON-GEIST: {', '.join(stray)}")
    rep.append(f"  motion    {len(gif)} animated gif, {len(webp)} webp")
    if webp:
        rep.append("     WEBP WILL NOT ANIMATE in PowerPoint or Google Slides — "
                   "use the .gif loops in assets/motion/.")
    return {"slides": len(slides), "runs": runs, "drift": drift, "overflow": overflow,
            "off_canvas": off_canvas, "faces": sorted(f for f in faces if f),
            "webp": webp, "gif": gif, "report": rep}
