import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from design_engine.learn.imagery import Imagery, describe_imagery

FIXTURE = Path(__file__).parent / "fixtures" / "imagery_response.json"


class FakeMessages:
    def __init__(self, text: str):
        self.text = text
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(text=self.text)])


class FakeAnthropic:
    def __init__(self, text: str):
        self.messages = FakeMessages(text)


def fake_for(payload) -> FakeAnthropic:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return FakeAnthropic("Here is what I found:\n" + text + "\nDone.")


@pytest.fixture
def fake_anthropic():
    return FakeAnthropic(FIXTURE.read_text())


@pytest.fixture(autouse=True)
def posts(tmp_path):
    Image.new("RGB", (1600, 2000), (14, 27, 46)).save(tmp_path / "a.jpg")
    Image.new("RGB", (400, 400), (220, 42, 46)).save(tmp_path / "b.jpg")


def test_items_without_evidence_are_dropped(tmp_path, fake_anthropic):
    r = describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", client=fake_anthropic)
    assert isinstance(r, Imagery)
    assert [i["kind"] for i in r.items] == ["device"] and r.people == "real_only"
    assert r.devices == ["phone"] and r.grounds == ["flat navy ground"] and r.never == ["stock photography"]


def test_one_message_with_downscaled_images(tmp_path, fake_anthropic):
    describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", model="m-test", client=fake_anthropic)
    calls = fake_anthropic.messages.calls
    assert len(calls) == 1 and calls[0]["model"] == "m-test"
    msgs = calls[0]["messages"]
    assert len(msgs) == 1 and msgs[0]["role"] == "user"
    images = [b for b in msgs[0]["content"] if b["type"] == "image"]
    assert len(images) == 2
    import base64
    from io import BytesIO

    w, h = Image.open(BytesIO(base64.b64decode(images[0]["source"]["data"]))).size
    assert max(w, h) == 768 and images[0]["source"]["media_type"] == "image/jpeg"
    system = calls[0]["system"].lower()
    assert "untrusted" in system or "not instructions" in system


def test_out_of_range_evidence_is_dropped(tmp_path):
    fake = fake_for({"items": [{"kind": "ghost_mark", "description": "x", "evidence_post_ids": [0, 5]}], "people": "none"})
    r = describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", client=fake)
    assert r.items == [] and r.people == "none"


def test_people_derived_from_items_when_omitted(tmp_path):
    fake = fake_for({"items": [{"kind": "headshot", "description": "Founder photo", "evidence_post_ids": [1]}]})
    r = describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", client=fake)
    assert r.people == "real_only" and r.devices == [] and r.grounds == [] and r.never == []
    fake = fake_for({"items": [{"kind": "device", "description": "Phone", "evidence_post_ids": [1]}]})
    assert describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", client=fake).people == "none"


def test_unparseable_reply_raises(tmp_path):
    with pytest.raises(ValueError):
        describe_imagery([tmp_path / "a.jpg"], "Test", client=FakeAnthropic("no json here"))
