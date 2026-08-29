"""
Independent exporter for the 3-strategy Bursa Strategy Terminal.

Does NOT import watermelon's export_scan.py. It calls the vendored kernel
(data_fetcher / screener / indicators / universe) directly, restricts the scan
to the three terminal strategies, adds the strength score (rank.py), and — for
official close runs only — the NEW/REMOVED lifecycle (lifecycle.py).

Modes:
  --mode close    official after-close screen -> data/today.json  (+ lifecycle)
  --mode preview  intraday screen             -> data/preview.json (no lifecycle)

The two modes share one code path so PREVIEW and TODAY can never disagree on how
a match is defined — they differ only in the input bars (intraday vs settled)
and in whether the lifecycle ledger is touched.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "kernel"))  # vendored kernel, imported verbatim

import pandas as pd  # noqa: E402

import config          # noqa: E402  (kernel)
import data_fetcher    # noqa: E402  (kernel)
import screener        # noqa: E402  (kernel)
from indicators import enrich   # noqa: E402  (kernel)
from universe import get_universe  # noqa: E402  (kernel)

import rank            # noqa: E402  (ours)
import lifecycle       # noqa: E402  (ours)

# The three strategies this terminal exposes, in display order.
TERMINAL_STRATEGIES = ("trending", "gaining_momentum", "meta_leader")
STRATEGY_LABELS = {
    "trending": "Trending",
    "gaining_momentum": "Momentum",
    "meta_leader": "M.E.T.A.",
}

DATA = HERE / "data"
DETAIL_BARS = int(os.environ.get("DETAIL_BARS", "130"))
SPARK_BARS = int(os.environ.get("SPARK_BARS", "20"))


# ------------------------------------------------------------------ helpers
def _finite(value: Any, default: float = 0.0) -> float:
    try:
        r = float(value)
        return r if math.isfinite(r) else default
    except (TypeError, ValueError):
        return default


def _num(value: Any, digits: int = 3) -> float | None:
    r = _finite(value, float("nan"))
    return round(r, digits) if math.isfinite(r) else None


def _spark(frame: pd.DataFrame, bars: int) -> dict[str, list]:
    e = enrich(frame).tail(bars)
    return {"o": [_num(v) for v in e["open"]], "h": [_num(v) for v in e["high"]],
            "l": [_num(v) for v in e["low"]], "c": [_num(v) for v in e["close"]]}


def _series(frame: pd.DataFrame, bars: int) -> dict[str, list]:
    e = enrich(frame).tail(bars)
    return {
        "t": [pd.Timestamp(i).strftime("%Y-%m-%d") for i in e.index],
        "o": [_num(v) for v in e["open"]], "h": [_num(v) for v in e["high"]],
        "l": [_num(v) for v in e["low"]], "c": [_num(v) for v in e["close"]],
        "v": [int(_finite(v)) for v in e["volume"]],
        "e20": [_num(v) for v in e["ema20"]],
        "e50": [_num(v) for v in e["ema50"]],
        "e200": [_num(v) for v in e["ema200"]],
    }


def _metadata() -> dict[str, dict[str, str]]:
    table = get_universe()
    meta: dict[str, dict[str, str]] = {}
    for row in table.itertuples(index=False):
        code = str(getattr(row, "code", "") or getattr(row, "symbol", "")).replace(".KL", "").upper()
        meta[code] = {"name": str(getattr(row, "description", code)),
                      "sector": str(getattr(row, "sector", "Unclassified"))}
    return meta


def _change_pct(frame: pd.DataFrame) -> float:
    e = enrich(frame)
    if len(e) < 2:
        return 0.0
    prev, last = float(e["close"].iloc[-2]), float(e["close"].iloc[-1])
    return round((last / prev - 1) * 100.0, 2) if prev > 0 else 0.0


def _scan_date(by_code: dict[str, pd.DataFrame]) -> str:
    """Latest bar date across the universe = the trading session screened."""
    latest = None
    for frame in by_code.values():
        if frame is None or len(frame) == 0:
            continue
        d = pd.Timestamp(frame.index[-1]).date()
        latest = d if latest is None or d > latest else latest
    return (latest or datetime.now().date()).isoformat()


# --------------------------------------------------------------------- run
def run(mode: str) -> dict[str, Any]:
    strategies = {k: config.STRATEGIES[k] for k in TERMINAL_STRATEGIES
                  if config.STRATEGIES.get(k, {}).get("enabled", False)}

    prices = data_fetcher.fetch_market()
    floor = int(os.environ.get("MIN_UNIVERSE", "800"))
    if len(prices) < floor:
        raise RuntimeError(f"Fail closed: only {len(prices)} symbols with usable history (< {floor})")

    by_code = {str(k).replace(".KL", "").upper(): v for k, v in prices.items()}
    hits = screener.scan(by_code, strategies)

    metadata = _metadata()
    per_symbol: dict[str, dict[str, Any]] = {}
    strat_of: dict[str, list[str]] = defaultdict(list)
    for strat in TERMINAL_STRATEGIES:
        for r in hits.get(strat, []):
            sym = str(r["symbol"]).upper()
            strat_of[sym].append(strat)
            per_symbol.setdefault(sym, r)

    stocks: list[dict[str, Any]] = []
    for sym, r in per_symbol.items():
        frame = by_code.get(sym)
        if frame is None:
            continue
        primary = strat_of[sym][0]
        meta = metadata.get(sym, {})
        stocks.append({
            "symbol": sym,
            "name": str(meta.get("name") or sym),
            "sector": str(meta.get("sector") or "Unclassified"),
            "strategy": primary,
            "strategies": strat_of[sym],
            "strength": rank.strength(primary, r, frame),
            "close": _num(r.get("close")),
            "price": _num(r.get("close")),
            "rsi": _num(r.get("rsi"), 1),
            "adx": _num(r.get("adx"), 1),
            "vol_ratio": _num(r.get("vol_ratio"), 2),
            "roc10": _num(r.get("roc10"), 2),
            "change_pct": _change_pct(frame),
            "is_new": False,
            "spark": _spark(frame, SPARK_BARS),
        })

    # strongest first
    stocks.sort(key=lambda s: -_finite(s.get("strength")))

    scan_date = _scan_date(by_code)
    now = datetime.now(timezone.utc)
    summary = {"new_count": 0, "removed_count": 0, "removals": []}

    if mode == "close":
        summary = lifecycle.apply(stocks, scan_date)
        stocks.sort(key=lambda s: -_finite(s.get("strength")))  # is_new added; keep order

    payload = {
        "mode": mode,
        "generated_at": now.isoformat(),
        "scan_date": scan_date,
        "official": mode == "close",
        "engine": "BursaStrategyTerminal (kernel-vendored)",
        "kernel_sha": (HERE / "kernel" / "SOURCE_SHA").read_text().strip(),
        "market": config.MARKET, "market_name": config.MARKET_NAME,
        "currency": config.CURRENCY,
        "stocks_screened": len(prices),
        "total_hits": len(stocks),
        "new_count": summary["new_count"],
        "removed_count": summary["removed_count"],
        "strategies": [{"key": k, "label": STRATEGY_LABELS[k],
                        "count": sum(k in s["strategies"] for s in stocks)}
                       for k in TERMINAL_STRATEGIES],
        "stocks": stocks,
        "removals": summary["removals"] if mode == "close" else _read_removals(),
        "disclaimer": "Candidate screen. Not financial advice.",
    }

    DATA.mkdir(parents=True, exist_ok=True)
    out = "today.json" if mode == "close" else "preview.json"
    (DATA / out).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    if mode == "close":
        series = {s["symbol"]: _series(by_code[s["symbol"]], DETAIL_BARS) for s in stocks}
        (DATA / "history.json").write_text(
            json.dumps({"generated_at": now.isoformat(), "bars": DETAIL_BARS,
                        "series": series}, separators=(",", ":")), encoding="utf-8")

    print(f"[{mode}] {len(stocks)} hits from {len(prices)} stocks "
          f"({summary['new_count']} new, {summary['removed_count']} removed) -> data/{out}")
    return payload


def _read_removals() -> list:
    try:
        return json.loads((DATA / "removals.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("close", "preview"), default="close")
    run(ap.parse_args().mode)
