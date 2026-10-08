from PIL import ImageFont

from design_engine.compose.typeset import Fit, fit_block

# the test fonts carry only the letters of "Some injuries" (S o m e i n j u r s) and space
LONG = " ".join(["Some injuries"] * 13)  # 181 characters


def test_overflow_rejects_at_floor(fonts):
    assert len(LONG) >= 180
    fit = fit_block(LONG, fonts["A"], 96, 40, box_w=600, box_h=300, max_lines=3)
    assert isinstance(fit, Fit)
    assert fit.overflow is True
    assert fit.size_px == 40  # shrunk to the floor and no lower


def test_fits_at_brand_size_when_it_fits(fonts):
    fit = fit_block("Some injuries", fonts["A"], 96, 40, box_w=900, box_h=200, max_lines=2)
    assert fit.overflow is False and fit.size_px == 96 and fit.lines == ["Some injuries"]


def test_shrinks_in_two_px_steps_to_the_size_that_fits(fonts):
    font96 = ImageFont.truetype(str(fonts["A"]), 96)
    w96 = font96.getlength("Some injuries")
    fit = fit_block("Some injuries", fonts["A"], 96, 40, box_w=int(w96 * 0.9), box_h=200, max_lines=1)
    assert fit.overflow is False and fit.lines == ["Some injuries"]
    assert 40 <= fit.size_px < 96 and (96 - fit.size_px) % 2 == 0
    assert ImageFont.truetype(str(fonts["A"]), int(fit.size_px)).getlength("Some injuries") <= int(w96 * 0.9)


def test_balanced_wrap(fonts):
    text = "Some injuries ruin summers"
    font = ImageFont.truetype(str(fonts["A"]), 64)
    # a width where greedy wrap leaves the last word alone on the second line
    box_w = int(font.getlength("Some injuries ruin")) + 4
    greedy = fit_block(text, fonts["A"], 64, 40, box_w=box_w, box_h=400, max_lines=3, balance=False)
    assert greedy.lines == ["Some injuries ruin", "summers"]
    fit = fit_block(text, fonts["A"], 64, 40, box_w=box_w, box_h=400, max_lines=3, balance=True)
    assert fit.overflow is False and fit.size_px == 64
    assert len(fit.lines) == 2 and len(fit.lines[-1].split()) > 1
    assert " ".join(fit.lines) == text


def test_never_ellipsis_never_drops_words(fonts):
    fit = fit_block(LONG, fonts["A"], 96, 40, box_w=600, box_h=300, max_lines=3)
    assert " ".join(fit.lines) == LONG and "…" not in " ".join(fit.lines)
