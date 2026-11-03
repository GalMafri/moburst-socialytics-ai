#!/usr/bin/env python3
"""Build the Socialytics strategy deck template (template.pptx).

Spec: docs/superpowers/specs/2026-11-03-strategy-v2-design.md, section 4.
Lital's answer of 3 Nov 2026: the deck uses the Moburst deck design system's
Strategy section (strategy-inner.jpg, gold accent #E5C53D, the strategy.jpg
divider), the animated cover loop on the cover and the mix loop on the close.

Built with the design system's own builder (design-system/scripts/mbdeck.py,
copied from the skill with the plates, loops and decor this template uses), so
the measured geometry, the text-anchoring and the glass edge-lights are the
system's. The geometry this script adds (card rows of 1 to 5 centred on x 360
with the system's gutter, the chart strips, "Where we start", the four-week
flow) is in layout.json, which the deck code measures against
(supabase/functions/_shared/strategy/deckLayout.ts; a test keeps them equal).

Each slide is one archetype, marked by a {{a:<name>}} text. The app copies the
imported template in Drive and fills each slide's {{tokens}} with
replaceAllText and replaceAllShapesWithImage (deck.ts). Run:

    python3 -m pip install python-pptx==1.0.2 pillow
    python3 assets/strategy-deck/build_template.py

then upload template.pptx to the private strategy-decks bucket as
template/<TEMPLATE_VERSION>.pptx (deckJob.ts). A new build needs a new
TEMPLATE_VERSION so Drive gets the new template.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "design-system", "scripts"))

from mbdeck import Deck, audit, GEO  # noqa: E402
from pptx.enum.shapes import MSO_SHAPE  # noqa: E402
from pptx.util import Pt  # noqa: E402

L = json.load(open(os.path.join(HERE, "layout.json")))
INNER = "strategy-inner.jpg"
DIVIDER = "strategy.jpg"
GOLD = "E5C53D"


def marker(s, name):
    """The archetype's name, in a tiny box the app empties."""
    s.text(4, 396, "{{a:%s}}" % name, size=4, leading=5, weight="Light", width=200, opacity=0.01)


def slot(s, x, y, w, h, token):
    """A transparent shape holding an image token: replaceAllShapesWithImage puts the image here."""
    sh = s.s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Pt(x), Pt(y), Pt(w), Pt(h))
    sh.shadow.inherit = False
    sh.fill.background()
    sh.line.fill.background()
    tf = sh.text_frame
    tf.text = "{{%s}}" % token
    for p in tf.paragraphs:
        for r in p.runs:
            r.font.name = "Geist Light"
            r.font.size = Pt(6)
    return sh


def card_width(n):
    return (L["content"]["w"] - (n - 1) * L["gutter"]) / n


def card(s, x, y, w, h, n):
    """A glass card with its label, hairline and body tokens, as CARD_LAYOUT draws general cards."""
    inset = L["inset"]
    edge = {"y": h - 0.52, "w": w * 0.756, "h": 8.14}
    s.glass(x, y, w, h, tone="card", edge_light=edge)
    lb, bd = L["label"], L["body"]
    s.text(x + inset, y + lb["dy"], "{{c%d_label}}" % n, size=lb["size"], leading=lb["leading"], weight="Medium", width=w - 2 * inset)
    s.hairline(x + inset, y + L["rule"]["dy"], w - 2 * inset)
    s.text(x + inset, y + bd["dy"], "{{c%d_body}}" % n, size=bd["size"], leading=bd["leading"], weight="Light", width=w - 2 * inset)


def card_row(s, count, y, h):
    w = card_width(count)
    for i in range(count):
        card(s, L["content"]["x"] + i * (w + L["gutter"]), y, w, h, i + 1)


def content_slide(d, name):
    s = d.slide(INNER)
    s.header("{{title}}", "{{intro}}")
    marker(s, name)
    return s


def build(path):
    d = Deck()

    # The cover: the animated loop, the title on one or two lines, the client's logo.
    C = L["cover"]
    for lines in (1, 2):
        s = d.slide()
        s.motion("cover")
        # mbdeck's cover() shifts the rule and subtitle by one leading per extra title line.
        s.cover("{{client_title}}" + ("\nx" if lines == 2 else ""), "{{period}}")
        # The second line was only there to shift the rule: keep one title box with the token.
        for shape in list(s.s.shapes):
            if shape.has_text_frame and shape.text_frame.text == "x":
                shape._element.getparent().remove(shape._element)
        lg = C["logo"]
        slot(s, lg["x"], lg["y"], lg["w"], lg["h"], "logo")
        marker(s, "cover-%d" % lines)

    # The Strategy divider: the huge word and the robot are in the plate; a subtitle only.
    s = d.slide(DIVIDER)
    s.section_divider("strategy", "{{divider_line}}")
    marker(s, "divider")

    # Card rows of 1 to 5, and the same under a chart strip.
    for n in range(1, L["maxCards"] + 1):
        s = content_slide(d, "cards-%d" % n)
        card_row(s, n, L["cards"]["y"], L["cards"]["h"])
    for n in range(1, L["maxCards"] + 1):
        s = content_slide(d, "chart-cards-%d" % n)
        ch = L["chartCards"]["chart"]
        slot(s, ch["x"], ch["y"], ch["w"], ch["h"], "chart")
        card_row(s, n, L["chartCards"]["y"], L["chartCards"]["h"])

    # Where we start: each platform's figures on glass, the brand against its competitors, the data line.
    s = content_slide(d, "start")
    r = L["start"]["rows"]
    s.glass(r["x"], 96, r["w"], 250, tone="card", edge_light={"y": 249.48, "w": r["w"] * 0.756, "h": 8.14})
    s.text(r["x"] + L["inset"], r["y"] + 4, "{{rows}}", size=L["body"]["size"], leading=L["body"]["leading"], weight="Light", width=r["w"] - 2 * L["inset"])
    c = L["start"]["chart"]
    slot(s, c["x"], c["y"], c["w"], c["h"], "chart")
    s.text(L["content"]["x"], L["start"]["footer"]["y"], "{{data_line}}", size=10, leading=13.5, weight="Light", align="center", width=L["content"]["w"], color="9CA3AF")

    # The first 30 days: the system's process chips, a week each, with the week's line under it.
    s = content_slide(d, "flow")
    s.process_flow(["Week 1", "Week 2", "Week 3", "Week 4"])
    f = L["flow"]
    for i in range(4):
        x = f["chip"]["x"] + i * f["chip"]["pitch"]
        s.text(x, f["body"]["y"], "{{w%d}}" % (i + 1), size=10, leading=13.5, weight="Light", align="center", width=f["chip"]["w"])

    # The close: the Perfect Mix loop.
    s = d.slide()
    s.motion("mix")
    marker(s, "close")

    d.save(path, strict=True)
    return path


if __name__ == "__main__":
    out = build(os.path.join(HERE, "template.pptx"))
    report = audit(out)
    for line in report["report"]:
        print(line)
