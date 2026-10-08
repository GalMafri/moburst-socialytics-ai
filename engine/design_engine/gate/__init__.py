"""The measured gate: one `check()` over a rendered option that composes Plan 1's measurements against the client's own floors,
plus the set-level distinctness filter. Code owns acceptance; nothing the model reports bypasses it."""
from .check import GateResult, check
from .distinct import Option, filter_set, signature

__all__ = ["GateResult", "Option", "check", "filter_set", "signature"]
