"""
Data pipeline for the Bursa Strategy Terminal worker (the D1 app).

Fetches the full Bursa daily universe via the vendored kernel, runs the three
strategies (Trending / Momentum / M.E.T.A.), scores strength, and POSTs a
payload in the EXACT shape the worker's /api/publish (official) and
/api/preview (intraday) endpoints expect. It does NOT write any files.

Modes:
  --mode close    official after-close  -> POST /api/publish
  --mode preview  intraday              -> POST /api/preview

Env (set as GitHub Actions secrets/vars):
  WORKER_URL       https://bursa-musangking-strategy-terminal.yankhaing.workers.dev
  PUBLISH_TOKEN    same value as the worker's PUBLISH_TOKEN secret
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "kernel"))  # vendored kernel, imported verbatim

import pandas as pd          # noqa: E402
import requests              # noqa: E402

import config                # noqa: E402  (kernel)
import data_fetcher          # noqa: E402  (kernel)
import screener              # noqa: E402  (kernel)
from indicators import enrich          # noqa: E402  (kernel)
from universe import get_universe      # noqa: E402  (kernel)

import rank                  # noqa: E402  (ours)

STRATEGIES = ("trending", "gaining_momentum", "meta_leader")
RANKING_MODEL = "strength-v1.0.0"


def _f(v: Any):
    try:
        r = float(v)
        return r if math.isfinite(r) else None
    except (TypeError, ValueError):
        return None


def _metadata() -> dict[str, dict[str, str]]:
    table = get_universe()
    meta: dict[str, dict[str, str]] = {}
    for row in table.itertuples(index=False):
        code = str(getattr(row, "code", "") or getattr(row, "symbol", "")).replace(".KL", "").upper()
        meta[code] = {"name": str(getattr(row, "description", code))}
    return meta


def _worker() -> tuple[str, str]:
    base = os.environ.get("WORKER_URL", "").rstrip("/")
    token = os.environ.get("PUBLISH_TOKEN", "")
    if not base or not token:
        raise RuntimeError("WORKER_URL and PUBLISH_TOKEN are required")
    return base, token


def build_payload() -> dict[str, Any]:
    prices = data_fetcher.fetch_market()
    by_code = {str(k).replace(".KL", "").upper(): v for k, v in prices.items()}
    meta = _metadata()

    # 1) strategy hits (kernel), restricted to the three terminal strategies
    strat_params = {k: config.STRATEGIES[k] for k in STRATEGIES
                    if config.STRATEGIES.get(k, {}).get("enabled", False)}
    hits = screener.scan(by_code, strat_params)

    # per-strategy hit symbol sets
    hit_syms = {st: {str(r["symbol"]).upper() for r in hits.get(st, [])} for st in STRATEGIES}

    # 2) raw_screener.hits with strength score + rank
    raw_hits: dict[str, list] = {st: [] for st in STRATEGIES}
    latest_trade_date = None
    for st in STRATEGIES:
        rows_st = []
        for r in hits.get(st, []):
            sym = str(r["symbol"]).upper()
            frame = by_code.get(sym)
            score = rank.strength(st, r, frame)
            rows_st.append({
                "symbol": sym,
                "name": str(meta.get(sym, {}).get("name") or sym),
                "close": _f(r.get("close")),
                "rsi": _f(r.get("rsi")),
                "adx": _f(r.get("adx")),
                "vol_ratio": _f(r.get("vol_ratio")),
                "roc10": _f(r.get("roc10")),
                "strength_score": score,
                "strength_model": RANKING_MODEL,
                "strength_components": {},
            })
        # rank: strongest = 1
        rows_st.sort(key=lambda x: -(x["strength_score"] or 0))
        for i, x in enumerate(rows_st, start=1):
            x["strength_rank"] = i
        raw_hits[st] = rows_st

    # 3) rows: every symbol with a valid latest bar (open/low/close/atr > 0)
    rows: list[dict[str, Any]] = []
    evaluated: list[str] = []
    for sym, frame in by_code.items():
        evaluated.append(sym)
        try:
            e = enrich(frame)
        except Exception:
            continue
        if e.empty or len(e) < 2:
            continue
        last = e.iloc[-1]
        o, l, c, atr = _f(last.get("open")), _f(last.get("low")), _f(last.get("close")), _f(last.get("atr"))
        if not all(v and v > 0 for v in (o, l, c, atr)):
            continue
        prev_c = _f(e["close"].iloc[-2]) or 0.0
        change_pct = round((c / prev_c - 1) * 100.0, 2) if prev_c > 0 else 0.0
        d = pd.Timestamp(e.index[-1]).date()
        latest_trade_date = d if latest_trade_date is None or d > latest_trade_date else latest_trade_date
        rows.append({
            "symbol": sym,
            "name": str(meta.get(sym, {}).get("name") or sym),
            "open": o, "low": l, "close": c, "atr": atr,
            "change_pct": change_pct,
            "hits": {st: (sym in hit_syms[st]) for st in STRATEGIES},
        })

    if not rows:
        raise RuntimeError("Fail closed: no valid rows produced")

    trade_date = (latest_trade_date or datetime.now().date()).isoformat()
    now = datetime.now(timezone.utc).isoformat()

    return {
        "trade_date": trade_date,
        "generated_at": now,
        "stocks_screened": len(by_code),
        "params": {"commission_pct": 0.15, "stop_loss_pct": -7, "atr_mult": 3},
        "rows": rows,
        "raw_screener": {
            "ranking_model": RANKING_MODEL,
            "evaluated_symbols": evaluated,
            "hits": raw_hits,
        },
    }


def run(mode: str) -> None:
    base, token = _worker()
    payload = build_payload()
    endpoint = "/api/publish" if mode == "close" else "/api/preview"
    r = requests.post(
        f"{base}{endpoint}",
        data=json.dumps(payload, separators=(",", ":")),
        headers={"Content-Type": "application/json", "X-Publish-Token": token},
        timeout=120,
    )
    hit_total = sum(len(v) for v in payload["raw_screener"]["hits"].values())
    print(f"[{mode}] {len(payload['rows'])} rows, {hit_total} hits, "
          f"trade_date={payload['trade_date']} -> {endpoint} : HTTP {r.status_code}")
    if not r.ok:
        print("Response:", r.text[:500])
        r.raise_for_status()
    print("OK:", r.text[:300])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("close", "preview"), default="close")
    run(ap.parse_args().mode)
