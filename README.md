# StrategyTerminal — data pipeline for the D1 worker

This repo feeds the Cloudflare worker `bursa-musangking-strategy-terminal`
(the app with Today / Preview / Open / Perf / Health tabs). The worker stores
and serves data and runs the buy/sell state machine; THIS repo produces the
data via GitHub Actions and POSTs it to the worker.

## Pieces
- `kernel/`      vendored screening engine from watermelon (pinned SOURCE_SHA)
- `rank.py`      strength score (0-100) per strategy
- `pipeline.py`  fetches Bursa, runs Trending/Momentum/M.E.T.A., POSTs to worker
- `.github/workflows/close.yml`         official, 17:18 MYT  -> /api/publish
- `.github/workflows/strategy-scan.yml` preview (Run button) -> /api/preview

## Required GitHub Actions secrets (repo -> Settings -> Secrets -> Actions)
- `WORKER_URL`     = https://bursa-musangking-strategy-terminal.yankhaing.workers.dev
- `PUBLISH_TOKEN`  = the SAME value as the worker's PUBLISH_TOKEN secret

## First run
Actions -> "Close Screen (Official)" -> Run workflow. When it finishes, the
site's Today updates. The Run button on the site triggers strategy-scan.yml.

## Notes
- The worker requires a one-time historical bootstrap before /api/publish will
  accept data. Your live app already shows positions/events, so it is already
  bootstrapped. If a close run ever returns HTTP 409 "bootstrap required",
  the D1 was reset — tell me and we add a bootstrap step.
- Editing kernel/ breaks bit-parity with watermelon; re-pin SOURCE_SHA if you do.
