# Socialytics design engine

Python package for the brand learner, composer, measured gate and per-post run.
See `docs/superpowers/specs/2026-10-08-design-engine-design.md` and the plans under `docs/superpowers/plans/`.

Setup (from `engine/`): `uv venv --python 3.12 && uv pip install -e ".[dev]" && uv run playwright install chromium`
Tests: `uv run pytest -q`
Secrets: `engine/.env` (never committed): `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
