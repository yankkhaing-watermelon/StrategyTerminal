"""
Lifecycle diff for the OFFICIAL after-close screen only.

Responsibilities:
  * decide which of today's matches are NEW (were not active yesterday)
  * decide which of yesterday's matches were REMOVED (gone today)
  * maintain a rolling removal ledger, retained for RETENTION_DAYS calendar days

State is two small JSON files committed to the repo (git is the audit trail):
  data/active.json    -> {"date": "YYYY-MM-DD", "symbols": ["MKHOP", ...]}
  data/removals.json  -> [{"symbol","name","strategy","strength","price",
                           "removed_on","last_seen"}...]

Preview runs NEVER call into this module, so intraday screens cannot mutate the
accepted record.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data"
ACTIVE_PATH = DATA / "active.json"
REMOVALS_PATH = DATA / "removals.json"
RETENTION_DAYS = 20


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def apply(stocks: list[dict], scan_date: str) -> dict[str, Any]:
    """
    Mutate `stocks` in place to stamp is_new, update the ledgers, and return
    a summary {new_count, removed_count, removals:[...]}.

    `stocks` items must carry: symbol, name, strategy, strength, price.
    `scan_date` is the accepted trading date (YYYY-MM-DD).
    """
    prev = _read(ACTIVE_PATH, {"date": "", "symbols": []})
    prev_symbols = {str(s).upper() for s in prev.get("symbols", [])}

    today_symbols = {str(s["symbol"]).upper() for s in stocks}

    # NEW = present today, absent yesterday
    new_count = 0
    for s in stocks:
        is_new = str(s["symbol"]).upper() not in prev_symbols
        s["is_new"] = is_new
        new_count += int(is_new)

    # REMOVED = present yesterday, absent today
    removed_now = sorted(prev_symbols - today_symbols)

    # detail lookup for the just-removed names, taken from the PREVIOUS snapshot
    prev_detail = {str(d["symbol"]).upper(): d
                   for d in prev.get("detail", [])}

    ledger = _read(REMOVALS_PATH, [])
    # drop any prior ledger entry for a symbol that is active again today
    ledger = [e for e in ledger
              if str(e["symbol"]).upper() not in today_symbols]
    known = {str(e["symbol"]).upper() for e in ledger}

    for sym in removed_now:
        if sym in known:
            continue
        d = prev_detail.get(sym, {})
        ledger.append({
            "symbol": sym,
            "name": d.get("name", sym),
            "strategy": d.get("strategy", ""),
            "strength": d.get("strength"),
            "price": d.get("price"),
            "last_seen": prev.get("date", ""),
            "removed_on": scan_date,
        })

    # expire entries older than RETENTION_DAYS
    cutoff = _as_date(scan_date) - timedelta(days=RETENTION_DAYS)
    ledger = [e for e in ledger if _as_date(e["removed_on"]) >= cutoff]
    ledger.sort(key=lambda e: (e["removed_on"], e["symbol"]), reverse=True)

    # persist new active snapshot (with detail, so tomorrow's removals have names)
    _write(ACTIVE_PATH, {
        "date": scan_date,
        "symbols": sorted(today_symbols),
        "detail": [{"symbol": str(s["symbol"]).upper(),
                    "name": s.get("name"),
                    "strategy": s.get("strategy"),
                    "strength": s.get("strength"),
                    "price": s.get("price")} for s in stocks],
    })
    _write(REMOVALS_PATH, ledger)

    return {
        "new_count": new_count,
        "removed_count": len(removed_now),
        "removals": ledger,
    }


def _as_date(value: str) -> date:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return date.today()
