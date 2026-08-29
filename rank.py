"""
Strength ranking layer.

This is the ONLY piece of scoring that is not inherited from the watermelon
kernel. The kernel produces *qualification* (which symbols pass each strategy)
and the raw indicator values (rsi/adx/vol_ratio/roc10); it explicitly leaves
`score = None`. This module turns those raw values into a 0-100 strength score
so the terminal can sort strongest-first.

Formula (accepted 2026-08):

    trending : 0.45*ADX_n + 0.30*RSI_pos + 0.25*VOL_n
    momentum : 0.40*VOL_n + 0.35*ROC_n  + 0.25*ADX_n     (gaining_momentum)
    meta     : 0.40*ADX_n + 0.30*HI52_n + 0.30*VOL_n     (meta_leader)

Each *_n is a bounded 0-100 scaler (see SCALERS). Tune the anchor points here;
nothing else in the pipeline needs to change.

NOTE: these numbers are the terminal's own definition. They will NOT reproduce
the exact "Strength" values from the previous workers.dev build, whose formula
was not recoverable. Everything upstream of this file (matches + indicators) is
bit-identical to the kernel.
"""
from __future__ import annotations

import math
from typing import Any

import pandas as pd


# ---- bounded linear scalers: value <= lo -> 0, value >= hi -> 100 ----------
SCALERS = {
    "adx": (15.0, 50.0),   # ADX 15 -> 0, 50 -> 100
    "vol": (1.0, 3.0),     # vol_ratio 1x -> 0, 3x -> 100
    "roc": (0.0, 15.0),    # ROC10 0% -> 0, 15% -> 100
    "rsi": (50.0, 75.0),   # RSI 50 -> 0, 75 -> 100 (position within trend band)
    "hi52": (0.80, 1.00),  # close/52w-high 0.80 -> 0, 1.00 -> 100
}


def _scale(value: Any, key: str) -> float:
    lo, hi = SCALERS[key]
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(v) or hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (v - lo) / (hi - lo))) * 100.0


def _hi52_ratio(frame: pd.DataFrame) -> float:
    """close / trailing 252-bar high. 1.0 == at the 52-week high."""
    if frame is None or len(frame) == 0:
        return 0.0
    window = frame["high"].tail(252)
    hi = float(window.max()) if len(window) else 0.0
    close = float(frame["close"].iloc[-1])
    return (close / hi) if hi > 0 else 0.0


def strength(strategy: str, row: dict, frame: pd.DataFrame | None = None) -> float:
    """Return a 0-100 strength score for one hit row under one strategy."""
    adx = _scale(row.get("adx"), "adx")
    vol = _scale(row.get("vol_ratio"), "vol")
    roc = _scale(row.get("roc10"), "roc")
    rsi = _scale(row.get("rsi"), "rsi")

    if strategy == "trending":
        s = 0.45 * adx + 0.30 * rsi + 0.25 * vol
    elif strategy == "gaining_momentum":
        s = 0.40 * vol + 0.35 * roc + 0.25 * adx
    elif strategy == "meta_leader":
        hi52 = _scale(_hi52_ratio(frame), "hi52")
        s = 0.40 * adx + 0.30 * hi52 + 0.30 * vol
    else:
        # not one of the three terminal strategies; neutral fallback
        s = (adx + vol) / 2.0

    return round(max(0.0, min(100.0, s)), 1)
