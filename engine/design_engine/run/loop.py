"""The model loop: `anthropic.beta.messages.tool_runner` over the seven tools, a system prompt that states the method and the rules in
plain words (the tools enforce them regardless), cost accounting from every turn's usage, and a stop at `submit` or at the budget.

The model client is injectable (`run_post(ctx, model_client=...)`): tests script `client.beta.messages.parse`, which is the one call the
runner makes, so the real runner drives the real tools offline.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from ..config import ENGINE_ROOT
from ..picture.brief import BriefRefused
from ..picture.higgsfield import HiggsfieldError
from . import record, tools
from .tools import OptionState, RunContext

DEFAULT_MODEL = "claude-opus-5-5"
MAX_TOKENS = 8000

# USD per million tokens (input, output), from the Claude API reference of 2026-09-25; overridden by PRICE_IN_<MODEL>/PRICE_OUT_<MODEL>
# in engine/.env (model id upper-cased, '-' and '.' as '_'). A model missing from both gets 0 and a warning in spent["warnings"].
PRICE_IN_CLAUDE_OPUS_5_5, PRICE_OUT_CLAUDE_OPUS_5_5 = 4.0, 20.0
PRICE_IN_CLAUDE_SONNET_5_5, PRICE_OUT_CLAUDE_SONNET_5_5 = 2.0, 10.0
PRICE_IN_CLAUDE_HAIKU_4_5, PRICE_OUT_CLAUDE_HAIKU_4_5 = 1.0, 5.0
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (PRICE_IN_CLAUDE_OPUS_5_5, PRICE_OUT_CLAUDE_OPUS_5_5),
    "claude-sonnet-5-5": (PRICE_IN_CLAUDE_SONNET_5_5, PRICE_OUT_CLAUDE_SONNET_5_5),
    "claude-haiku-4-5": (PRICE_IN_CLAUDE_HAIKU_4_5, PRICE_OUT_CLAUDE_HAIKU_4_5),
}
CACHE_READ_SHARE = 0.1  # cache reads bill at about a tenth of the input price; cache writes at 1.25x

SYSTEM = """You design one social post for a client whose brand was measured from its own published posts. Nothing you say is accepted on
your word: every design is rendered by code, measured by code and accepted by code.

The method, in order:
1. read_brand: the measured profile, the layout families with their slot geometry and headline length bands, the floors, the standing rules,
   the post copy, the sizes to build, and the families and picture concepts used in the client's last three runs (do not repeat them).
2. nearest_posts: the client's own posts closest to this copy, as exemplars of how this brand sets this kind of message.
3. plan: at most three options. Each names a family_key (or arrangement "new" with parts and bands as frame fractions), a headline and an
   optional subline that are the post copy's own words (whitespace may differ, nothing else), and a picture_brief: the picture's subject in
   the brand's own imagery language. The headline may not exceed the family's headline_max_chars. A picture brief never names a logo, text,
   headline, wordmark, caption, letters or the brand itself: the logo is always the client's file and the words are always typeset by code.
4. picture: two pictures per option; a picture busy under the text is regenerated once, then dropped.
5. compose: every size, every picture, every arrangement the family allows; the best by the gate's margins is kept per size.
6. measure: the gate with the client's own floors. If it fails you get one fix round: shorten the copy (re-plan the same option id),
   change the picture brief (re-plan, then picture again) or compose with another arrangement. A second failure drops the option.
7. submit: every file is measured again by code and accepted only when every size of every option passes; the set is then ordered and
   filtered for distinctness. Submit when your options pass; if the budget tool answers tell you credits are spent, submit what passed.

Keep your text short: a sentence per turn at most. Do not describe a result as passed unless a tool said so."""

_SCHEMAS: dict[str, dict] = {
    "read_brand": {"type": "object", "properties": {}, "additionalProperties": False},
    "nearest_posts": {"type": "object", "properties": {"copy": {"type": "string"}, "k": {"type": "integer", "minimum": 1, "maximum": 8}},
                      "required": ["copy"], "additionalProperties": False},
    "plan": {"type": "object", "properties": {"options": {"type": "array", "maxItems": tools.MAX_OPTIONS, "items": {
        "type": "object", "properties": {
            "id": {"type": "string"}, "family_key": {"type": ["string", "null"]}, "arrangement": {"type": "string", "enum": ["family", "new"]},
            "parts": {"type": "array", "items": {"type": "string"}},
            "bands": {"type": "object", "additionalProperties": {"type": "object", "properties": {k: {"type": "number"} for k in ("x", "y", "w", "h")}}},
            "headline": {"type": "string"}, "subline": {"type": ["string", "null"]}, "picture_brief": {"type": "string"},
            "alignment": {"type": "string", "enum": ["left", "center"]}},
        "required": ["headline", "picture_brief"]}}}, "required": ["options"], "additionalProperties": False},
    "picture": {"type": "object", "properties": {"option_id": {"type": "string"}}, "required": ["option_id"], "additionalProperties": False},
    "compose": {"type": "object", "properties": {"option_id": {"type": "string"},
                                                 "arrangement": {"description": "p25 | p50 | p75, or {name, slot: {x, y}} overrides; omit to try them all",
                                                                 "anyOf": [{"type": "string"}, {"type": "object"}, {"type": "null"}]}},
                "required": ["option_id"], "additionalProperties": False},
    "measure": {"type": "object", "properties": {"option_id": {"type": "string"}}, "required": ["option_id"], "additionalProperties": False},
    "submit": {"type": "object", "properties": {"option_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1}},
               "required": ["option_ids"], "additionalProperties": False},
}
_DESCRIPTIONS = {
    "read_brand": "The measured brand profile, families, floors, rules, the post, the sizes and the last three runs.",
    "nearest_posts": "The client's own posts closest to this copy, with their family and measurements.",
    "plan": "Record up to three options (family or new arrangement, headline and subline from the post copy, picture brief). Refused when a rule breaks.",
    "picture": "Make two measured pictures for an option through Higgsfield; credits are recorded.",
    "compose": "Render every size x picture x arrangement for an option and keep the best per size by gate margins.",
    "measure": "Run the full gate on an option's kept renders; returns pass or the failures with numbers.",
    "submit": "Re-measure every file of the named options; accept only when all pass; order and filter the set.",
}


@dataclass
class RunResult:
    options: list[OptionState]  # offered, in rank order
    spent: dict
    turns: int
    dropped: list[dict]
    transcript_path: Path | None
    states: list[OptionState] = field(default_factory=list)  # every option, for the record


def price_for(model: str, spent: dict | None = None) -> tuple[float, float]:
    """(input, output) USD per million tokens for a model id: engine/.env PRICE_IN_/PRICE_OUT_ first, then the module table, then 0 with a warning."""
    load_dotenv(ENGINE_ROOT / ".env")
    key = model.upper().replace("-", "_").replace(".", "_")
    env_in, env_out = os.environ.get(f"PRICE_IN_{key}"), os.environ.get(f"PRICE_OUT_{key}")
    if env_in is not None and env_out is not None:
        try:
            return float(env_in), float(env_out)
        except ValueError:
            pass
    if model in PRICES:
        return PRICES[model]
    if spent is not None:
        note = f"pricing not configured for model {model!r}: set PRICE_IN_{key} and PRICE_OUT_{key} in engine/.env; usd counted as 0"
        if note not in spent.setdefault("warnings", []):
            spent["warnings"].append(note)
    return 0.0, 0.0


def usd_for(usage: Any, model: str, spent: dict | None = None) -> float:
    p_in, p_out = price_for(model, spent)
    get = (lambda k: getattr(usage, k, None) or 0) if not isinstance(usage, dict) else (lambda k: usage.get(k) or 0)
    cost = (get("input_tokens") * p_in + get("output_tokens") * p_out + get("cache_read_input_tokens") * p_in * CACHE_READ_SHARE
            + get("cache_creation_input_tokens") * p_in * 1.25) / 1_000_000
    return round(cost, 6)


def build_tools(ctx: RunContext) -> list:
    """The seven tools as `beta_tool` closures over the context; every result is a JSON string, every refusal an error the model sees."""
    from anthropic import beta_tool

    def wrap(name: str, fn):
        def tool(**kwargs):
            try:
                out = fn(ctx, **kwargs)
            except tools.ToolRefused as e:
                ctx.transcript.append({"tool": name, "args": kwargs, "refused": str(e)})
                raise
            except (BriefRefused, tools.BudgetExceeded, HiggsfieldError) as e:
                # a worker rule or the picture service said no: the model reads it as a refusal with the reason, not as a crash
                ctx.transcript.append({"tool": name, "args": kwargs, "refused": f"{type(e).__name__}: {e}"})
                raise tools.ToolRefused(f"{name} refused: {e}") from e
            ctx.transcript.append({"tool": name, "args": kwargs, "ok": True})
            return json.dumps(out, default=str)

        tool.__name__ = name
        return beta_tool(tool, name=name, description=_DESCRIPTIONS[name], input_schema=_SCHEMAS[name])

    return [wrap("read_brand", tools.read_brand), wrap("nearest_posts", tools.nearest_posts), wrap("plan", tools.plan),
            wrap("picture", tools.picture), wrap("compose", tools.compose), wrap("measure", tools.measure), wrap("submit", tools.submit)]


def _first_message(ctx: RunContext) -> str:
    return (f"Design the post below for {ctx.platform} ({ctx.post.get('format') or 'Single Image'}), sizes "
            f"{', '.join(f'{s.name} {s.w}x{s.h}' for s in ctx.size_list)}. Start with read_brand.\n\nPost copy:\n{ctx.copy_text}")


def _block_record(block: Any) -> dict:
    t = getattr(block, "type", None)
    if t == "text":
        return {"type": "text", "text": block.text}
    if t == "tool_use":
        return {"type": "tool_use", "name": block.name, "input": block.input}
    return {"type": t}


ENDED = {"submitted": "not submitted", "turns": "the turn budget ended before submit accepted this option",
         "usd": "the dollar budget ended before submit accepted this option",
         "end_turn": "the model ended its turn without submitting this option"}


def result_from(ctx: RunContext, turns: int, transcript_path: Path | None, ended: str = "submitted") -> RunResult:
    """The result of a run from its context: offered options in rank order, every other live option dropped with the reason the run
    ended (`ended`: submitted | turns | usd | end_turn)."""
    offered = list(ctx.submitted or [])
    reason = ENDED.get(ended, ENDED["end_turn"]) if not ctx.done else ENDED["submitted"]
    if ended not in ENDED:
        reason = f"the run ended ({ended}) before submit accepted this option"
    for opt in ctx.options.values():
        if opt.status != "dropped" and opt not in offered:
            ctx.drop(opt, reason)
    ctx.spent["turns"] = turns
    return RunResult(offered, ctx.spent, turns, list(ctx.dropped), transcript_path, list(ctx.options.values()))


def run_post(ctx: RunContext, model: str | None = None, model_client: Any = None, max_tokens: int = MAX_TOKENS) -> RunResult:
    """Run the loop for one post: the model plans and operates the tools, the worker enforces every rule, the run stops when `submit`
    accepts or when the turn or dollar budget ends (the credit budget stops `picture`). The record is written either way."""
    model = model or ctx.model
    if model_client is None:
        import anthropic

        model_client = ctx.clients.get("anthropic") or anthropic.Anthropic()
    transcript_path = ctx.run_dir / "transcript.jsonl"
    runner = model_client.beta.messages.tool_runner(
        model=model, max_tokens=max_tokens, system=SYSTEM, tools=build_tools(ctx),
        messages=[{"role": "user", "content": _first_message(ctx)}], max_iterations=ctx.budget.max_turns,
    )
    turns = 0
    ended = "end_turn"
    started = time.time()
    with transcript_path.open("w", encoding="utf-8") as log:
        for message in runner:
            turns += 1
            usage = getattr(message, "usage", None)
            usd = usd_for(usage, model, ctx.spent) if usage is not None else 0.0
            ctx.spent["usd"] = round(ctx.spent["usd"] + usd, 6)
            ctx.spent["model_calls"].append({"turn": turns, "model": model, "input_tokens": getattr(usage, "input_tokens", None),
                                             "output_tokens": getattr(usage, "output_tokens", None), "usd": usd, "stop_reason": message.stop_reason})
            tool_events, ctx.transcript = ctx.transcript, []
            log.write(json.dumps({"turn": turns, "t": round(time.time() - started, 1), "stop_reason": message.stop_reason, "usd": usd,
                                  "content": [_block_record(b) for b in message.content], "tool_events_before": tool_events}, default=str) + "\n")
            log.flush()
            if ctx.done:
                ended = "submitted"
                break
            if ctx.spent["usd"] >= ctx.budget.max_usd:
                ctx.spent["warnings"].append(f"dollar budget of {ctx.budget.max_usd} reached after turn {turns}")
                ended = "usd"
                break
            if message.stop_reason == "end_turn":
                ended = "end_turn"
            elif turns >= ctx.budget.max_turns:
                ended = "turns"
        if ctx.transcript:
            log.write(json.dumps({"turn": turns, "tool_events_after": ctx.transcript}, default=str) + "\n")
            ctx.transcript = []
    if ended == "end_turn" and turns >= ctx.budget.max_turns:
        ended = "turns"
    ctx.spent["ended"] = ended
    result = result_from(ctx, turns, transcript_path, ended)
    record.write(ctx.run_dir, result)
    return result


__all__ = ["DEFAULT_MODEL", "PRICES", "SYSTEM", "RunResult", "build_tools", "price_for", "result_from", "run_post", "usd_for"]
