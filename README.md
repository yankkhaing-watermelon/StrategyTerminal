# Bursa Strategy Terminal

A fully independent 3-strategy Bursa terminal — **Trending**, **Momentum**
(`gaining_momentum`), **M.E.T.A.** (`meta_leader`) — deployed as a single
Cloudflare Worker, driven by GitHub Actions.

- **Today** — official after-close screen, auto-run **17:18 MYT** on trading
  days, strength-ranked, with **NEW / REMOVED** lifecycle and a **20-day**
  removal ledger.
- **Preview** — intraday screen, run **manually** from the ▶ Run button. Writes
  `preview.json` only; it never touches the official lifecycle.

## How it stays 100% consistent with watermelon

The screening kernel is **vendored verbatim** from
`yankkhaing-watermelon/watermelon` into `kernel/` (pinned in
`kernel/SOURCE_SHA`). This repo never calls watermelon's `export_scan.py` — it
imports the same `data_fetcher` / `screener` / `indicators` / `universe`
directly, so matches and indicator values are bit-identical. Only two things are
new and live outside the kernel: `rank.py` (strength score) and `lifecycle.py`
(NEW/REMOVED + 20-day retention). See `rank.py` for the accepted strength
formula — note it will **not** reproduce the old worker's Strength numbers,
whose formula wasn't recoverable.

## Layout
```
kernel/            vendored, unmodified (config, data_fetcher, indicators, screener, universe)
rank.py            strength score (0-100)
lifecycle.py       NEW/REMOVED diff + data/active.json + data/removals.json (20d)
export_terminal.py entrypoint: --mode close | preview
data/              committed JSON the worker serves (today, preview, history, removals, active)
worker/            single Worker: UI + /api/* proxy + /run dispatch
.github/workflows/ close.yml (cron+dispatch) · preview.yml (dispatch only)
```

## Setup

1. **Create the repo** and push this tree. Enable Actions (Settings → Actions →
   General → allow workflows).

2. **First official run** (seeds `today.json` and the lifecycle files):
   Actions → *Close Screen (Official)* → Run workflow. Wait for the commit.

3. **Deploy the worker** (overwrites the old build, keeps the URL):
   - Edit `worker/wrangler.toml`: set `GH_REPO` to the new repo name; confirm
     `name` matches the worker behind `gentle-mountain-b39e…workers.dev`.
   - `cd worker && wrangler deploy`
   - `wrangler secret put GH_DISPATCH_TOKEN` — a fine-grained PAT scoped to this
     repo with **Actions: Read and write** (and Contents: Read if the repo is
     private). This is the only secret; it lets the ▶ Run button dispatch the
     preview workflow.

4. Open the URL. **Today** loads the after-close screen. **Preview** + ▶ Run
   dispatches an intraday screen and polls until it publishes (~a few minutes).

## Tuning
- Strength weights / scalers: `rank.py` (`SCALERS`, the three formulas).
- Removal retention window: `RETENTION_DAYS` in `lifecycle.py` (default 20).
- Strategy parameters: `kernel/config.py` `STRATEGIES` — but editing kernel
  files breaks the bit-parity guarantee; re-pin `SOURCE_SHA` if you do.
- Cron time: `.github/workflows/close.yml` (`18 9 * * 1-5` = 17:18 MYT).
