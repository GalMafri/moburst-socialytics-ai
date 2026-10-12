"""The design worker on the Socialytics box.

    uv run python scripts/worker.py [--once] [--poll 15]

Env (box environment, never a browser): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, and either HIGGSFIELD_MCP_TOKEN or
SOCIALYTICS_PROBE_URL + SOCIALYTICS_ACT_AS_USER (the bridge). Leases design_runs one at a time, runs the loop, uploads the offered
renders, writes design_options. Status for the n8n check: `select design_runs_status()`.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv

from design_engine.compose.render import chromium
from design_engine.config import settings
from design_engine.picture.higgsfield import PROBE_URL_ENV, Client, ProbeClient
from design_engine.worker.main import POLL_SECONDS, serve
from design_engine.worker.store import BridgeStore, SupabaseStore


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="process at most one run, then exit")
    ap.add_argument("--poll", type=float, default=POLL_SECONDS)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    cfg = settings()
    if not cfg.anthropic_api_key:
        raise SystemExit("ANTHROPIC_API_KEY is not set")
    import anthropic

    higgsfield = ProbeClient.from_env() if os.environ.get(PROBE_URL_ENV) else Client.from_env()
    clients = {"anthropic": anthropic.Anthropic(api_key=cfg.anthropic_api_key), "higgsfield": higgsfield}
    # the project's own door when the host holds no Supabase key (the store function, directly or through the n8n bridge)
    store = BridgeStore.from_env() if os.environ.get("SOCIALYTICS_STORE_URL") else SupabaseStore.from_env()
    n = serve(store, chromium, clients, once=args.once, poll=args.poll)
    print(f"processed {n} run(s)")


if __name__ == "__main__":
    main()
