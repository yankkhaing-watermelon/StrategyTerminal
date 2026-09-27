var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/engine.js
var STRATEGIES = ["trending", "gaining_momentum", "meta_leader"];
function processState(prev, row, strategy, opts = {}) {
  const commissionPct = Number(opts.commissionPct || 0);
  const stopLossPct = Number(opts.stopLossPct ?? -7);
  const atrMult = Number(opts.atrMult || 3);
  const nearStopPct = Number(opts.nearStopPct || 3);
  const hit = Boolean(row.hits?.[strategy]);
  const tradeDate = row.trade_date;
  const open = Number(row.open);
  const low = Number(row.low);
  const close = Number(row.close);
  const atr = Number(row.atr);
  const s = prev ? { ...prev } : {
    strategy,
    symbol: row.symbol,
    name: row.name || "",
    status: "FLAT",
    cycle: 0,
    hold_days: 0
  };
  s.name = row.name || s.name || "";
  s.latest_close = close;
  s.latest_atr = atr;
  s.last_trade_date = tradeDate;
  s.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const events = [];
  if (s.status === "BUY_PENDING") {
    if (tradeDate > String(s.signal_date || "") && open > 0 && low > 0 && close > 0) {
      const fromStatus = s.status;
      s.status = "OPEN";
      s.entry_date = tradeDate;
      s.entry_price = open;
      s.peak_close = close;
      s.initial_stop = open * (1 + stopLossPct / 100);
      s.atr_stop = s.initial_stop;
      s.hold_days = 0;
      events.push(ev(
        "ENTRY_CONFIRMED",
        row,
        strategy,
        open,
        s,
        `Entry confirmed at next-session open ${fmt(open)}.`,
        fromStatus,
        s.status
      ));
      if (low <= s.atr_stop) {
        closeTrade(s, row, strategy, commissionPct, events, "trail_stop");
      } else if (atr > 0) {
        s.atr_stop = Math.max(s.atr_stop, s.peak_close - atrMult * atr);
      }
    }
    return { state: s, events };
  }
  if (s.status === "OPEN" || s.status === "NEAR_SELL") {
    const fromStatus = s.status;
    s.hold_days = Number(s.hold_days || 0) + 1;
    if (low <= Number(s.atr_stop)) {
      closeTrade(s, row, strategy, commissionPct, events, "trail_stop");
      return { state: s, events };
    }
    if (close > Number(s.peak_close || close)) s.peak_close = close;
    if (atr > 0) s.atr_stop = Math.max(Number(s.atr_stop || 0), s.peak_close - atrMult * atr);
    const dist = close > 0 ? (close / s.atr_stop - 1) * 100 : 999;
    if (dist <= nearStopPct) {
      if (fromStatus !== "NEAR_SELL") {
        s.status = "NEAR_SELL";
        events.push(ev(
          "NEAR_SELL",
          row,
          strategy,
          close,
          s,
          `Price is ${dist.toFixed(1)}% above the ATR stop.`,
          fromStatus,
          s.status
        ));
      } else {
        s.status = "NEAR_SELL";
      }
    } else {
      s.status = "OPEN";
    }
    return { state: s, events };
  }
  if (s.status === "CLOSED") {
    if (tradeDate <= String(s.closed_date || "")) return { state: s, events };
    s.status = "FLAT";
  }
  if (s.status === "FLAT" && hit) {
    const fromStatus = s.status;
    s.status = "BUY_PENDING";
    s.signal_date = tradeDate;
    s.cycle = Number(s.cycle || 0) + 1;
    s.last_event = "BUY_SIGNAL";
    events.push(ev(
      "BUY_SIGNAL",
      row,
      strategy,
      close,
      s,
      `New ${strategyLabel(strategy)} ATR buy signal. Entry is next session open.`,
      fromStatus,
      s.status
    ));
  }
  return { state: s, events };
}
__name(processState, "processState");
function closeTrade(s, row, strategy, commissionPct, events, reason) {
  const fromStatus = s.status;
  const exit = Number(s.atr_stop);
  const gross = (exit / Number(s.entry_price) - 1) * 100;
  const net = gross - 2 * commissionPct;
  s.status = "CLOSED";
  s.closed_date = row.trade_date;
  s.exit_price = exit;
  s.return_pct = net;
  s.last_event = "SELL";
  events.push(ev(
    "SELL",
    row,
    strategy,
    exit,
    s,
    `ATR trailing stop triggered at ${fmt(exit)}; strategy return ${net.toFixed(2)}%.`,
    fromStatus,
    s.status
  ));
}
__name(closeTrade, "closeTrade");
function ev(type, row, strategy, price, s, message, fromStatus = null, toStatus = null) {
  return {
    event_type: type,
    trade_date: row.trade_date,
    strategy,
    symbol: row.symbol,
    name: row.name || "",
    price,
    atr_stop: Number.isFinite(Number(s.atr_stop)) ? Number(s.atr_stop) : null,
    entry_price: Number.isFinite(Number(s.entry_price)) ? Number(s.entry_price) : null,
    return_pct: Number.isFinite(Number(s.return_pct)) ? Number(s.return_pct) : null,
    cycle: Number(s.cycle || 0),
    from_status: fromStatus,
    to_status: toStatus,
    message
  };
}
__name(ev, "ev");
function strategyLabel(s) {
  return { trending: "Trending", gaining_momentum: "Momentum", meta_leader: "M.E.T.A." }[s] || s;
}
__name(strategyLabel, "strategyLabel");
function fmt(n) {
  return `RM${Number(n).toFixed(3)}`;
}
__name(fmt, "fmt");

// src/index.js
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
var GH_REPO = "yankkhaing-watermelon/StrategyTerminal";
var GH_WORKFLOW = "strategy-scan.yml";
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return await health(env);
      if (url.pathname === "/api/dashboard") return await dashboard(env, url);
      if (url.pathname === "/api/events") return await eventsApi(env, url);
      if (url.pathname === "/api/positions") return await positionsApi(env, url);
      if (url.pathname === "/api/trades") return await tradesApi(env, url);
      if (url.pathname === "/api/preview" && request.method === "GET") return await previewApi(env);
      if (url.pathname === "/api/preview" && request.method === "POST")
        return await publishPreview(request, env);
      if (url.pathname === "/api/manual-run" && request.method === "POST")
        return await manualRun(request, env);
      if (url.pathname === "/api/review" && request.method === "POST")
        return await markReviewed(env);
      if (url.pathname === "/api/publish" && request.method === "POST")
        return await publishSnapshot(request, env);
      if (url.pathname === "/api/bootstrap" && request.method === "POST")
        return await bootstrapSnapshot(request, env, url);
      if (url.pathname === "/open-ux.js" || url.pathname === "/api/open-ux.js") return openUxScript();
      if (url.pathname === "/app" || url.pathname === "/api/app") return await openUxPage(request, env);
      if (url.pathname === "/api/app-manifest.json") return await openUxManifest(request, env, url);
      return injectOpenUx(await env.ASSETS.fetch(request));
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: e?.message || String(e) }, e?.status || 500);
    }
  }
};
async function health(env) {
  const [run, snaps, boot, previewRaw] = await Promise.all([
    env.DB.prepare(
      "SELECT id,generated_at,trade_date,stocks_screened,rows_received,status,message,created_at FROM daily_runs ORDER BY trade_date DESC LIMIT 1"
    ).first(),
    env.DB.prepare(
      "SELECT strategy,trade_date,length(state_json) bytes FROM strategy_snapshots ORDER BY strategy"
    ).all(),
    setting(env, "bootstrapped", "0"),
    setting(env, "latest_preview_json", "")
  ]);
  let active = 0;
  let total = 0;
  const loaded = await loadStateMaps(env);
  for (const m of loaded.values()) {
    for (const s of m.values()) {
      total++;
      if (["BUY_PENDING", "OPEN", "NEAR_SELL"].includes(s.status)) {
        active++;
      }
    }
  }
  const p = parse(previewRaw, null);
  return json({
    ok: true,
    last_run: run || null,
    active_states: active,
    total_states: total,
    bootstrapped: boot === "1" && total > 0,
    min_universe: "NONE",
    coverage_policy: `No fixed stock-count threshold. Official publish requires ${(Number(env.MIN_OFFICIAL_COVERAGE_RATIO || 0.5) * 100).toFixed(
      0
    )}% of fetched histories on one trade date; stale/non-trading counters are carried forward unchanged.`,
    preview: p ? {
      generated_at: p.generated_at,
      trade_date: p.trade_date,
      rows_received: p.rows_received,
      stocks_screened: p.stocks_screened
    } : null,
    snapshots: snaps.results || []
  });
}
__name(health, "health");
async function dashboard(env, url) {
  const [run, reviewedAt, officialRaw, fallbackRaw] = await Promise.all([
    latestRun(env, url.searchParams.get("date")),
    setting(env, "last_reviewed_at", ""),
    setting(env, "latest_screener_official_json", ""),
    setting(env, "latest_screener_json", "")
  ]);
  if (!run) {
    return json({
      ok: true,
      trade_date: "",
      last_run: null,
      counts: [],
      confluence: [],
      events: [],
      unread: 0
    });
  }
  const official = parse(officialRaw, null);
  const fallback = parse(fallbackRaw, null);
  const screener = official && String(official.trade_date || "") === String(run.trade_date || "") ? official : fallback && fallback.source === "official" && String(fallback.trade_date || "") === String(run.trade_date || "") ? fallback : null;
  const events = decorateOfficialEventStrength(parse(run.events_json, []), screener);
  const counts = {};
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
  }
  const conf = /* @__PURE__ */ new Map();
  for (const e of events.filter((x) => x.event_type === "BUY_SIGNAL")) {
    const x = conf.get(e.symbol) || {
      symbol: e.symbol,
      name: e.name || "",
      strategies: [],
      confluence: 0
    };
    x.strategies.push(e.strategy);
    x.confluence = x.strategies.length;
    conf.set(e.symbol, x);
  }
  const confluence = [...conf.values()].filter((x) => x.confluence >= 2).sort((a, b) => b.confluence - a.confluence || a.symbol.localeCompare(b.symbol)).map((x) => ({
    ...x,
    strategies: x.strategies.join(",")
  }));
  const unread = events.filter((e) => String(e.created_at || run.generated_at) > reviewedAt).length;
  return json({
    ok: true,
    trade_date: run.trade_date,
    last_run: stripLarge(run),
    counts: Object.entries(counts).map(([event_type, n]) => ({
      event_type,
      n
    })),
    confluence,
    events: events.slice(0, 300),
    screener,
    strength_model: screener?.ranking_model || null,
    unread
  });
}
__name(dashboard, "dashboard");
function decorateOfficialEventStrength(events, screener) {
  if (!screener) {
    return events;
  }
  const lookup = /* @__PURE__ */ new Map();
  for (const st of STRATEGIES) {
    for (const x of Array.isArray(screener.hits?.[st]) ? screener.hits[st] : []) {
      const key = `${st}|${norm(x.symbol)}`;
      lookup.set(key, {
        strength_score: finite(x.strength_score) ? Number(x.strength_score) : null,
        strength_rank: finite(x.strength_rank) ? Number(x.strength_rank) : null,
        strength_current: true,
        strength_source: "current",
        membership_status: String(x.membership_status || ""),
        rank_change: finite(x.rank_change) ? Number(x.rank_change) : null
      });
    }
    for (const x of Array.isArray(screener.removed?.[st]) ? screener.removed[st] : []) {
      const key = `${st}|${norm(x.symbol)}`;
      if (lookup.has(key)) {
        continue;
      }
      lookup.set(key, {
        strength_score: finite(x.strength_score) ? Number(x.strength_score) : null,
        strength_rank: finite(x.strength_rank) ? Number(x.strength_rank) : null,
        strength_current: false,
        strength_source: "last",
        membership_status: "REMOVED",
        rank_change: null
      });
    }
  }
  return events.map((e) => {
    const m = lookup.get(`${e.strategy}|${norm(e.symbol)}`);
    return m ? {
      ...e,
      ...m
    } : e;
  });
}
__name(decorateOfficialEventStrength, "decorateOfficialEventStrength");
async function eventsApi(env, url) {
  const rows = await env.DB.prepare(
    "SELECT trade_date,generated_at,events_json FROM daily_runs ORDER BY trade_date DESC LIMIT 365"
  ).all();
  let a = [];
  for (const r of rows.results || []) {
    a.push(...parse(r.events_json, []));
  }
  const strategy = url.searchParams.get("strategy");
  const type = url.searchParams.get("type");
  const symbol = url.searchParams.get("symbol");
  if (strategy) {
    a = a.filter((x) => x.strategy === strategy);
  }
  if (type) {
    a = a.filter((x) => x.event_type === type);
  }
  if (symbol) {
    const s = norm(symbol);
    a = a.filter((x) => x.symbol === s);
  }
  a.sort(
    (x, y) => String(y.trade_date).localeCompare(String(x.trade_date)) || String(y.created_at || "").localeCompare(String(x.created_at || ""))
  );
  return json({
    ok: true,
    events: a.slice(0, 1e3)
  });
}
__name(eventsApi, "eventsApi");
async function positionsApi(env, url) {
  const [maps, officialRaw, lastRun] = await Promise.all([
    loadStateMaps(env),
    setting(env, "latest_screener_official_json", ""),
    env.DB.prepare("SELECT trade_date FROM daily_runs ORDER BY trade_date DESC LIMIT 1").first()
  ]);
  const look = screenerLookup(parse(officialRaw, null));
  const latestTradeDate = String(lastRun?.trade_date || "");
  let a = [];
  for (const [strategy2, m] of maps) {
    for (const s of m.values()) {
      if (["BUY_PENDING", "OPEN", "NEAR_SELL"].includes(s.status)) {
        a.push(decoratePosition(s, look, latestTradeDate));
      }
    }
  }
  const strategy = url.searchParams.get("strategy");
  const symbol = url.searchParams.get("symbol");
  if (strategy) {
    a = a.filter((x) => x.strategy === strategy);
  }
  if (symbol) {
    const q = norm(symbol);
    a = a.filter((x) => x.symbol === q);
  }
  const counts = {};
  for (const [k, test] of Object.entries(POSITION_FILTERS)) {
    counts[k] = a.filter(test).length;
  }
  const filter = url.searchParams.get("filter");
  if (filter && POSITION_FILTERS[filter]) {
    a = a.filter(POSITION_FILTERS[filter]);
  }
  a.sort(
    (x, y) => (x.status === "NEAR_SELL" ? 0 : x.status === "BUY_PENDING" ? 1 : 2) - (y.status === "NEAR_SELL" ? 0 : y.status === "BUY_PENDING" ? 1 : 2) || x.symbol.localeCompare(y.symbol)
  );
  return json({
    ok: true,
    trade_date: latestTradeDate,
    screener_trade_date: look ? look.trade_date : null,
    counts,
    positions: a
  });
}
__name(positionsApi, "positionsApi");
async function tradesApi(env, url) {
  const rows = await env.DB.prepare(
    "SELECT trade_date,trades_json FROM daily_runs WHERE trades_json!='[]' ORDER BY trade_date DESC LIMIT 1000"
  ).all();
  let a = [];
  for (const r of rows.results || []) {
    a.push(...parse(r.trades_json, []));
  }
  const strategy = url.searchParams.get("strategy");
  if (strategy) {
    a = a.filter((x) => x.strategy === strategy);
  }
  a.sort((x, y) => String(y.exit_date).localeCompare(String(x.exit_date)));
  return json({
    ok: true,
    trades: a.slice(0, 2e3),
    performance: performance(a)
  });
}
__name(tradesApi, "tradesApi");
function performance(trades) {
  const g = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const x = g.get(t.strategy) || {
      strategy: t.strategy,
      trades: 0,
      wins: 0,
      sum: 0,
      gp: 0,
      gl: 0,
      hold: 0
    };
    const r = Number(t.return_pct);
    x.trades++;
    x.sum += r;
    x.hold += Number(t.hold_days || 0);
    if (r > 0) {
      x.wins++;
      x.gp += r;
    } else {
      x.gl += Math.abs(r);
    }
    g.set(t.strategy, x);
  }
  return [...g.values()].map((x) => ({
    strategy: x.strategy,
    trades: x.trades,
    wins: x.wins,
    win_rate: x.trades ? 100 * x.wins / x.trades : 0,
    avg_return: x.trades ? x.sum / x.trades : 0,
    gross_profit: x.gp,
    gross_loss: x.gl,
    profit_factor: x.gl ? x.gp / x.gl : null,
    avg_hold: x.trades ? x.hold / x.trades : 0
  }));
}
__name(performance, "performance");
async function previewApi(env) {
  const [raw, screenerPreview, legacy] = await Promise.all([
    setting(env, "latest_preview_json", ""),
    setting(env, "latest_screener_preview_json", ""),
    setting(env, "latest_screener_json", "")
  ]);
  return json({
    ok: true,
    preview: parse(raw, null),
    screener: parse(screenerPreview, null) || parse(legacy, null)
  });
}
__name(previewApi, "previewApi");
async function publishPreview(request, env) {
  verifyToken(request, env);
  const p = await request.json();
  validatePayload(p, env, true);
  const old = await loadStateMaps(env);
  const events = [];
  const screenerBase = rawScreener(p, "preview");
  const membership = await decorateScreenerMembership(env, screenerBase, "preview");
  const screener = membership.screener;
  const hitCounts = {
    ...screener.counts
  };
  const params = p.params || {};
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  const changes = [];
  for (const row0 of p.rows) {
    const row = {
      ...row0,
      symbol: norm(row0.symbol),
      trade_date: p.trade_date
    };
    const ch = Number(row.change_pct);
    if (Number.isFinite(ch)) {
      changes.push(ch);
      if (ch > 0) {
        advancers++;
      } else if (ch < 0) {
        decliners++;
      } else {
        unchanged++;
      }
    }
    for (const strategy of STRATEGIES) {
      const prev = old.get(strategy)?.get(row.symbol);
      if (prev && String(prev.last_trade_date || "") >= String(p.trade_date)) {
        continue;
      }
      const out = processState(prev, row, strategy, {
        commissionPct: Number(params.commission_pct || 0),
        stopLossPct: Number(params.stop_loss_pct ?? -7),
        atrMult: Number(params.atr_mult || 3),
        nearStopPct: Number(env.NEAR_STOP_PCT || 3)
      });
      for (const e0 of out.events) {
        events.push({
          ...e0,
          id: crypto.randomUUID(),
          created_at: p.generated_at,
          confluence: 1,
          preview: true,
          message: `PREVIEW ONLY \xB7 ${e0.message}`
        });
      }
    }
  }
  addConfluence(events);
  const eventCounts = {};
  for (const e of events) {
    eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;
  }
  const preview = {
    ok: true,
    mode: "preview",
    generated_at: p.generated_at,
    trade_date: p.trade_date,
    stocks_screened: Number(p.stocks_screened || 0),
    rows_received: p.rows.length,
    histories_on_latest_date: Number(p.histories_on_latest_date || p.rows.length),
    stale_or_nontrading: Number(p.stale_or_nontrading || 0),
    bad_rows: Number(p.bad_rows || 0),
    breadth: {
      advancers,
      decliners,
      unchanged,
      median_change_pct: median(changes)
    },
    hit_counts: hitCounts,
    event_counts: eventCounts,
    events: events.slice(0, 300)
  };
  await env.DB.batch([
    settingStmt(env, "latest_preview_json", JSON.stringify(preview)),
    settingStmt(env, "latest_screener_preview_json", JSON.stringify(screener)),
    settingStmt(env, "latest_screener_json", JSON.stringify(screener)),
    settingStmt(env, membershipStateKey("preview"), JSON.stringify(membership.state))
  ]);
  return json({
    ok: true,
    trade_date: preview.trade_date,
    rows: preview.rows_received,
    events: preview.events.length
  });
}
__name(publishPreview, "publishPreview");
async function manualRun(request, env) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw http(500, "GITHUB_ACTIONS_TOKEN is not configured");
  }
  const lastRaw = await setting(env, "manual_run_last_at", "");
  const lastMs = Date.parse(lastRaw || "");
  if (Number.isFinite(lastMs) && Date.now() - lastMs < 6e4) {
    throw http(429, "A manual preview was triggered less than 60 seconds ago.");
  }
  const apiUrl = `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`;
  const r = await fetch(apiUrl, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      ref: "main"
    })
  });
  const text = await r.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {
        message: text.slice(0, 300)
      };
    }
  }
  if (!r.ok) {
    throw http(r.status, body?.message || `GitHub preview dispatch failed (${r.status})`);
  }
  const triggeredAt = (/* @__PURE__ */ new Date()).toISOString();
  await upsertSetting(env, "manual_run_last_at", triggeredAt);
  return json({
    ok: true,
    mode: "preview",
    triggered_at: triggeredAt,
    message: "Manual preview started through the same strategy-scan workflow. It will not alter official strategy history."
  });
}
__name(manualRun, "manualRun");
async function markReviewed(env) {
  await upsertSetting(env, "last_reviewed_at", (/* @__PURE__ */ new Date()).toISOString());
  return json({
    ok: true
  });
}
__name(markReviewed, "markReviewed");
async function bootstrapSnapshot(request, env, url) {
  verifyToken(request, env);
  const p = await request.json();
  if (!p || !Array.isArray(p.states) || !p.states.length) {
    throw http(400, "non-empty states array required");
  }
  const current = await setting(env, "bootstrapped", "0");
  if (current === "1" && url.searchParams.get("replace") !== "1") {
    throw http(409, "already bootstrapped; use ?replace=1 to intentionally replace");
  }
  const grouped = new Map(STRATEGIES.map((s) => [s, /* @__PURE__ */ new Map()]));
  for (const s0 of p.states) {
    const s = {
      ...s0,
      symbol: norm(s0.symbol)
    };
    if (!grouped.has(s.strategy) || !s.symbol) {
      throw http(422, "invalid bootstrap strategy/symbol");
    }
    const m = grouped.get(s.strategy);
    if (m.has(s.symbol)) {
      throw http(422, `duplicate bootstrap ${s.strategy}|${s.symbol}`);
    }
    m.set(s.symbol, s);
  }
  for (const strategy of STRATEGIES) {
    if (grouped.get(strategy).size < 1) {
      throw http(422, `bootstrap ${strategy} has no states`);
    }
  }
  const bootEvents = (p.events || []).map((e) => ({
    ...e,
    id: e.id || crypto.randomUUID(),
    created_at: p.generated_at,
    confluence: Number(e.confluence || 1)
  }));
  addConfluence(bootEvents);
  const bootTrades = Array.isArray(p.trades) ? p.trades : [];
  const stmts = STRATEGIES.map(
    (strategy) => snapshotStmt(env, strategy, p.trade_date, grouped.get(strategy))
  );
  stmts.push(settingStmt(env, "bootstrapped", "1"));
  stmts.push(
    env.DB.prepare(
      `INSERT OR REPLACE INTO daily_runs(
        trade_date,id,generated_at,stocks_screened,rows_received,status,message,
        payload_hash,events_json,trades_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      p.trade_date,
      crypto.randomUUID(),
      p.generated_at || (/* @__PURE__ */ new Date()).toISOString(),
      Number(p.stocks_screened || 0),
      p.states.length,
      "OK",
      `Historical state bootstrap complete: ${p.states.length} strategy states`,
      await hash(JSON.stringify(["bootstrap", p.trade_date, p.states.length])),
      JSON.stringify(bootEvents),
      JSON.stringify(bootTrades)
    )
  );
  await env.DB.batch(stmts);
  const verify = await loadStateMaps(env);
  for (const strategy of STRATEGIES) {
    if (verify.get(strategy)?.size !== grouped.get(strategy).size) {
      throw http(500, `bootstrap verify failed for ${strategy}`);
    }
  }
  return json({
    ok: true,
    states: p.states.length,
    events: bootEvents.length,
    trades: bootTrades.length,
    trade_date: p.trade_date
  });
}
__name(bootstrapSnapshot, "bootstrapSnapshot");
async function publishSnapshot(request, env) {
  verifyToken(request, env);
  const p = await request.json();
  validatePayload(p, env, false);
  if (await setting(env, "bootstrapped", "0") !== "1") {
    throw http(409, "historical bootstrap required before daily publish");
  }
  const old = await loadStateMaps(env);
  const next = new Map(STRATEGIES.map((s) => [s, new Map(old.get(s) || [])]));
  const events = [];
  const trades = [];
  const params = p.params || {};
  for (const row0 of p.rows) {
    const row = {
      ...row0,
      symbol: norm(row0.symbol),
      trade_date: p.trade_date
    };
    for (const strategy of STRATEGIES) {
      const m = next.get(strategy);
      const out = processState(m.get(row.symbol), row, strategy, {
        commissionPct: Number(params.commission_pct || 0),
        stopLossPct: Number(params.stop_loss_pct ?? -7),
        atrMult: Number(params.atr_mult || 3),
        nearStopPct: Number(env.NEAR_STOP_PCT || 3)
      });
      m.set(row.symbol, out.state);
      for (const e0 of out.events) {
        const e = {
          ...e0,
          id: crypto.randomUUID(),
          created_at: p.generated_at,
          confluence: 1
        };
        events.push(e);
        if (e.event_type === "SELL") {
          trades.push({
            strategy,
            symbol: row.symbol,
            name: row.name || "",
            cycle: out.state.cycle,
            signal_date: out.state.signal_date,
            entry_date: out.state.entry_date,
            entry_price: out.state.entry_price,
            exit_date: out.state.closed_date,
            exit_price: out.state.exit_price,
            return_pct: out.state.return_pct,
            hold_days: out.state.hold_days,
            exit_reason: "trail_stop"
          });
        }
      }
    }
  }
  addConfluence(events);
  const h = await payloadHash(p);
  const same = await env.DB.prepare("SELECT payload_hash FROM daily_runs WHERE trade_date=?").bind(p.trade_date).first();
  if (classifySameDatePayload(same, h, p.trade_date) === "duplicate") {
    return json({
      ok: true,
      duplicate: true,
      trade_date: p.trade_date
    });
  }
  const officialBase = rawScreener(p, "official");
  const officialMembership = await decorateScreenerMembership(env, officialBase, "official");
  const writes = STRATEGIES.map((s) => snapshotStmt(env, s, p.trade_date, next.get(s)));
  writes.push(
    env.DB.prepare(
      `INSERT INTO daily_runs(
        trade_date,id,generated_at,stocks_screened,rows_received,status,message,
        payload_hash,events_json,trades_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      p.trade_date,
      crypto.randomUUID(),
      p.generated_at,
      p.stocks_screened,
      p.rows.length,
      "OK",
      `Processed ${p.rows.length}/${p.stocks_screened} valid current-date Bursa rows; stale/non-trading counters carried forward`,
      h,
      JSON.stringify(events),
      JSON.stringify(trades)
    )
  );
  writes.push(
    settingStmt(env, "latest_screener_official_json", JSON.stringify(officialMembership.screener))
  );
  writes.push(
    settingStmt(env, "latest_screener_json", JSON.stringify(officialMembership.screener))
  );
  writes.push(
    settingStmt(env, membershipStateKey("official"), JSON.stringify(officialMembership.state))
  );
  await env.DB.batch(writes);
  return json({
    ok: true,
    trade_date: p.trade_date,
    stocks: p.rows.length,
    stocks_screened: p.stocks_screened,
    events: events.length,
    trades: trades.length
  });
}
__name(publishSnapshot, "publishSnapshot");
function rawScreener(p, source) {
  const src = p.raw_screener || {};
  const hits = {};
  const counts = {};
  for (const st of STRATEGIES) {
    hits[st] = (Array.isArray(src.hits?.[st]) ? src.hits[st] : []).map((x) => ({
      symbol: String(x.symbol || ""),
      name: String(x.name || ""),
      close: finite(x.close) ? Number(x.close) : null,
      rsi: finite(x.rsi) ? Number(x.rsi) : null,
      adx: finite(x.adx) ? Number(x.adx) : null,
      vol_ratio: finite(x.vol_ratio) ? Number(x.vol_ratio) : null,
      roc10: finite(x.roc10) ? Number(x.roc10) : null,
      strength_score: finite(x.strength_score) ? Number(x.strength_score) : null,
      strength_rank: finite(x.strength_rank) ? Number(x.strength_rank) : null,
      strength_model: String(x.strength_model || ""),
      strength_components: x.strength_components && typeof x.strength_components === "object" ? x.strength_components : {}
    }));
    counts[st] = hits[st].length;
  }
  return {
    generated_at: p.generated_at,
    trade_date: p.trade_date,
    stocks_screened: Number(p.stocks_screened || 0),
    source,
    ranking_model: String(src.ranking_model || "strength-v1.0.0"),
    evaluated_symbols: Array.isArray(src.evaluated_symbols) ? src.evaluated_symbols.map(memberSymbol).filter(Boolean) : null,
    counts,
    hits
  };
}
__name(rawScreener, "rawScreener");
var MEMBERSHIP_VERSION = 2;
var REMOVED_RETENTION_TRADING_DAYS = 20;
var HISTORY_RETENTION_TRADING_DAYS = 252;
var MAX_HISTORY_SCANS = 1e3;
function membershipStateKey(mode) {
  return `screener_membership_${mode}_json`;
}
__name(membershipStateKey, "membershipStateKey");
function memberSymbol(v) {
  return String(v || "").trim().toUpperCase();
}
__name(memberSymbol, "memberSymbol");
function membershipRecord(x) {
  return {
    symbol: String(x.symbol || ""),
    name: String(x.name || ""),
    close: finite(x.close) ? Number(x.close) : null,
    rsi: finite(x.rsi) ? Number(x.rsi) : null,
    adx: finite(x.adx) ? Number(x.adx) : null,
    vol_ratio: finite(x.vol_ratio) ? Number(x.vol_ratio) : null,
    roc10: finite(x.roc10) ? Number(x.roc10) : null,
    strength_score: finite(x.strength_score) ? Number(x.strength_score) : null,
    strength_rank: finite(x.strength_rank) ? Number(x.strength_rank) : null
  };
}
__name(membershipRecord, "membershipRecord");
function tradingAge(tradeDates, fromDate, toDate) {
  const from = tradeDates.indexOf(String(fromDate || ""));
  const to = tradeDates.indexOf(String(toDate || ""));
  if (from < 0 || to < 0 || to < from) {
    return Number.POSITIVE_INFINITY;
  }
  return to - from;
}
__name(tradingAge, "tradingAge");
function blankMembershipState(mode) {
  return {
    version: MEMBERSHIP_VERSION,
    mode,
    trade_dates: [],
    strategies: Object.fromEntries(
      STRATEGIES.map((st) => [
        st,
        {
          current: {},
          removed: {}
        }
      ])
    ),
    history: []
  };
}
__name(blankMembershipState, "blankMembershipState");
function membershipStateFromScreener(mode, screener) {
  if (!screener || typeof screener !== "object" || !screener.hits || typeof screener.hits !== "object") {
    return null;
  }
  const tradeDate = String(screener.trade_date || "");
  if (!tradeDate) {
    return null;
  }
  const state = blankMembershipState(mode);
  state.trade_dates = [tradeDate];
  for (const st of STRATEGIES) {
    const current = {};
    const removed = {};
    for (const row of Array.isArray(screener.hits?.[st]) ? screener.hits[st] : []) {
      const sym = memberSymbol(row.symbol);
      if (sym) {
        current[sym] = membershipRecord(row);
      }
    }
    for (const row of Array.isArray(screener.removed?.[st]) ? screener.removed[st] : []) {
      const sym = memberSymbol(row.symbol);
      if (sym) {
        removed[sym] = {
          ...membershipRecord(row),
          removed_on: String(row.removed_on || tradeDate),
          removed_at: String(row.removed_at || screener.generated_at || ""),
          trading_days_removed: finite(row.trading_days_removed) ? Number(row.trading_days_removed) : 0
        };
      }
    }
    state.strategies[st] = {
      current,
      removed
    };
  }
  state.history = [
    {
      trade_date: tradeDate,
      generated_at: String(screener.generated_at || ""),
      baseline: true,
      migrated_snapshot: true,
      changes: Object.fromEntries(
        STRATEGIES.map((st) => [
          st,
          {
            added: [],
            reentered: [],
            removed: [],
            deferred: []
          }
        ])
      )
    }
  ];
  return state;
}
__name(membershipStateFromScreener, "membershipStateFromScreener");
function latestScreenerStateKey(mode) {
  return mode === "official" ? "latest_screener_official_json" : "latest_screener_preview_json";
}
__name(latestScreenerStateKey, "latestScreenerStateKey");
async function decorateScreenerMembership(env, screener, mode) {
  const [storedRaw, fallbackRaw] = await Promise.all([
    setting(env, membershipStateKey(mode), ""),
    setting(env, latestScreenerStateKey(mode), "")
  ]);
  const stored = parse(storedRaw, null);
  const fallbackScreener = parse(fallbackRaw, null);
  const validStored = Boolean(
    stored && stored.version === MEMBERSHIP_VERSION && stored.mode === mode
  );
  const upgradedStored = !validStored && stored && stored.version === 1 && stored.mode === mode ? {
    ...stored,
    version: MEMBERSHIP_VERSION
  } : null;
  const hasStoredState = validStored || Boolean(upgradedStored);
  const fallbackState = hasStoredState ? null : membershipStateFromScreener(mode, fallbackScreener);
  const fallbackIsPrevious = Boolean(
    fallbackState && (String(fallbackScreener.trade_date || "") < String(screener.trade_date || "") || String(fallbackScreener.generated_at || "") < String(screener.generated_at || ""))
  );
  const migrated = !hasStoredState && fallbackIsPrevious;
  const baseline = !hasStoredState && !migrated;
  const prev = validStored ? stored : upgradedStored || (migrated ? fallbackState : blankMembershipState(mode));
  const evaluatedSymbols = Array.isArray(screener.evaluated_symbols) ? new Set(screener.evaluated_symbols.map(memberSymbol).filter(Boolean)) : null;
  const tradeDates = [
    .../* @__PURE__ */ new Set([
      ...Array.isArray(prev.trade_dates) ? prev.trade_dates : [],
      String(screener.trade_date || "")
    ])
  ].filter(Boolean).sort().slice(-HISTORY_RETENTION_TRADING_DAYS);
  const validDates = new Set(tradeDates);
  const next = blankMembershipState(mode);
  next.trade_dates = tradeDates;
  const removedOut = {};
  const membershipCounts = {};
  const scanChanges = {};
  for (const st of STRATEGIES) {
    const prevStrategy = prev.strategies?.[st] || {
      current: {},
      removed: {}
    };
    const prevCurrent = prevStrategy.current && typeof prevStrategy.current === "object" ? prevStrategy.current : {};
    const retainedRemoved = {};
    for (const [sym, r0] of Object.entries(prevStrategy.removed || {})) {
      const age = tradingAge(tradeDates, r0.removed_on, screener.trade_date);
      if (age < REMOVED_RETENTION_TRADING_DAYS) {
        retainedRemoved[sym] = {
          ...r0,
          trading_days_removed: age
        };
      }
    }
    const currentRows = Array.isArray(screener.hits?.[st]) ? screener.hits[st] : [];
    const currentMap = {};
    const decorated = [];
    const changes = {
      added: [],
      reentered: [],
      removed: [],
      deferred: []
    };
    let continuing = 0;
    let newCount = 0;
    let reenteredCount = 0;
    let deferredUnavailable = 0;
    for (const x0 of currentRows) {
      const sym = memberSymbol(x0.symbol);
      if (!sym) {
        continue;
      }
      const prevRow = prevCurrent[sym] || null;
      const removedRow = retainedRemoved[sym] || null;
      let membershipStatus = "CONTINUING";
      if (!baseline && !prevRow) {
        if (removedRow) {
          membershipStatus = "RE_ENTERED";
          reenteredCount++;
          changes.reentered.push(sym);
        } else {
          membershipStatus = "NEW";
          newCount++;
          changes.added.push(sym);
        }
      } else {
        continuing++;
      }
      const currentRank = finite(x0.strength_rank) ? Number(x0.strength_rank) : null;
      const previousRank = prevRow && finite(prevRow.strength_rank) ? Number(prevRow.strength_rank) : null;
      const rankChange = membershipStatus === "CONTINUING" && currentRank !== null && previousRank !== null ? previousRank - currentRank : null;
      const previousStrength = prevRow && finite(prevRow.strength_score) ? Number(prevRow.strength_score) : null;
      const x = {
        ...x0,
        membership_status: membershipStatus,
        previous_rank: previousRank,
        rank_change: rankChange,
        previous_strength_score: previousStrength
      };
      decorated.push(x);
      currentMap[sym] = membershipRecord(x);
      delete retainedRemoved[sym];
    }
    if (!baseline) {
      for (const [sym, oldRow] of Object.entries(prevCurrent)) {
        if (currentMap[sym]) {
          continue;
        }
        if (evaluatedSymbols && !evaluatedSymbols.has(sym)) {
          currentMap[sym] = membershipRecord(oldRow);
          deferredUnavailable++;
          changes.deferred.push(sym);
          continue;
        }
        const removedRow = {
          ...membershipRecord(oldRow),
          removed_on: String(screener.trade_date || ""),
          removed_at: String(screener.generated_at || ""),
          trading_days_removed: 0
        };
        retainedRemoved[sym] = removedRow;
        changes.removed.push(sym);
      }
    }
    const keptRemoved = {};
    const visibleRemoved = [];
    for (const [sym, r0] of Object.entries(retainedRemoved)) {
      const age = tradingAge(tradeDates, r0.removed_on, screener.trade_date);
      if (age >= REMOVED_RETENTION_TRADING_DAYS) {
        continue;
      }
      const r = {
        ...r0,
        trading_days_removed: age
      };
      keptRemoved[sym] = r;
      visibleRemoved.push(r);
    }
    visibleRemoved.sort(
      (a, b) => String(b.removed_on || "").localeCompare(String(a.removed_on || "")) || Number(a.strength_rank || 9999) - Number(b.strength_rank || 9999) || String(a.symbol || "").localeCompare(String(b.symbol || ""))
    );
    screener.hits[st] = decorated;
    removedOut[st] = visibleRemoved;
    membershipCounts[st] = {
      current: decorated.length,
      new: newCount,
      reentered: reenteredCount,
      continuing,
      deferred_unavailable: deferredUnavailable,
      removed_visible: visibleRemoved.length
    };
    next.strategies[st] = {
      current: currentMap,
      removed: keptRemoved
    };
    scanChanges[st] = changes;
  }
  const oldHistory = (Array.isArray(prev.history) ? prev.history : []).filter(
    (x) => validDates.has(String(x.trade_date || ""))
  );
  oldHistory.push({
    trade_date: String(screener.trade_date || ""),
    generated_at: String(screener.generated_at || ""),
    baseline,
    changes: scanChanges
  });
  next.history = oldHistory.slice(-MAX_HISTORY_SCANS);
  screener.removed = removedOut;
  screener.membership_counts = membershipCounts;
  screener.membership = {
    baseline,
    state_upgraded: Boolean(upgradedStored),
    migrated_from_previous_snapshot: migrated,
    comparison: "previous " + mode + " scan",
    removed_retention_trading_days: REMOVED_RETENTION_TRADING_DAYS,
    history_retention_trading_days: HISTORY_RETENTION_TRADING_DAYS
  };
  return {
    screener,
    state: next
  };
}
__name(decorateScreenerMembership, "decorateScreenerMembership");
function addConfluence(events) {
  const by = /* @__PURE__ */ new Map();
  for (const e of events.filter((x) => x.event_type === "BUY_SIGNAL")) {
    const a = by.get(e.symbol) || [];
    a.push(e);
    by.set(e.symbol, a);
  }
  for (const a of by.values()) {
    if (a.length >= 2) {
      for (const e of a) {
        e.confluence = a.length;
      }
    }
  }
}
__name(addConfluence, "addConfluence");
function validatePayload(p, env, preview = false) {
  if (!p || !Array.isArray(p.rows)) {
    throw http(400, "rows array required");
  }
  if (!p.rows.length) {
    throw http(422, "at least one valid current-date row is required");
  }
  if (!Number.isFinite(Number(p.stocks_screened)) || Number(p.stocks_screened) <= 0) {
    throw http(422, "positive stocks_screened required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.trade_date || ""))) {
    throw http(400, "valid trade_date required");
  }
  if (!p.generated_at || Number.isNaN(new Date(p.generated_at).getTime())) {
    throw http(400, "valid generated_at required");
  }
  if (!p.raw_screener || !p.raw_screener.hits || STRATEGIES.some((st) => !Array.isArray(p.raw_screener.hits[st]))) {
    throw http(422, "raw_screener hits required for Trending/Momentum/M.E.T.A.");
  }
  if (!preview) {
    const ratio = Math.max(0.05, Math.min(1, Number(env.MIN_OFFICIAL_COVERAGE_RATIO || 0.5)));
    const required = Math.max(1, Math.ceil(Number(p.stocks_screened) * ratio));
    if (p.rows.length < required) {
      throw http(
        422,
        `Official coverage guard: ${p.rows.length}/${p.stocks_screened} valid current-date rows; need >=${required} (${(ratio * 100).toFixed(0)}%)`
      );
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const r of p.rows) {
    if (!r.symbol || ![r.open, r.low, r.close, r.atr].every((x) => finite(x) && Number(x) > 0)) {
      throw http(422, "positive symbol/open/low/close/atr required");
    }
    const sym = norm(r.symbol);
    if (seen.has(sym)) {
      throw http(422, `duplicate symbol ${sym}`);
    }
    seen.add(sym);
    if (!r.hits || STRATEGIES.some((st) => typeof r.hits[st] !== "boolean")) {
      throw http(422, `invalid hits for ${sym}`);
    }
  }
}
__name(validatePayload, "validatePayload");
function classifySameDatePayload(existing, incomingHash, tradeDate) {
  if (!existing) {
    return "new";
  }
  if (existing.payload_hash === incomingHash) {
    return "duplicate";
  }
  throw http(
    409,
    `trade date ${tradeDate} was already published with a different payload; refusing overwrite`
  );
}
__name(classifySameDatePayload, "classifySameDatePayload");
async function payloadHash(payload) {
  return hash(JSON.stringify(payload));
}
__name(payloadHash, "payloadHash");
async function loadStateMaps(env) {
  const r = await env.DB.prepare("SELECT strategy,state_json FROM strategy_snapshots").all();
  const out = new Map(STRATEGIES.map((s) => [s, /* @__PURE__ */ new Map()]));
  for (const x of r.results || []) {
    if (!out.has(x.strategy)) {
      continue;
    }
    const obj = parse(x.state_json, {});
    out.set(x.strategy, new Map(Object.entries(obj)));
  }
  return out;
}
__name(loadStateMaps, "loadStateMaps");
function snapshotStmt(env, strategy, tradeDate, map) {
  const obj = Object.fromEntries(map);
  return env.DB.prepare(
    `INSERT INTO strategy_snapshots(strategy,trade_date,state_json,updated_at)
     VALUES(?,?,?,datetime('now'))
     ON CONFLICT(strategy) DO UPDATE SET
       trade_date=excluded.trade_date,
       state_json=excluded.state_json,
       updated_at=datetime('now')`
  ).bind(strategy, tradeDate, JSON.stringify(obj));
}
__name(snapshotStmt, "snapshotStmt");
async function latestRun(env, date) {
  if (date) {
    return env.DB.prepare("SELECT * FROM daily_runs WHERE trade_date=?").bind(date).first();
  }
  return env.DB.prepare("SELECT * FROM daily_runs ORDER BY trade_date DESC LIMIT 1").first();
}
__name(latestRun, "latestRun");
function stripLarge(r) {
  if (!r) {
    return r;
  }
  const { events_json, trades_json, ...x } = r;
  return x;
}
__name(stripLarge, "stripLarge");
async function setting(env, key, fallback = "") {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind(key).first();
  return r?.value ?? fallback;
}
__name(setting, "setting");
function settingStmt(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO app_settings(key,value,updated_at)
     VALUES(?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=datetime('now')`
  ).bind(key, String(value));
}
__name(settingStmt, "settingStmt");
async function upsertSetting(env, key, value) {
  await settingStmt(env, key, value).run();
}
__name(upsertSetting, "upsertSetting");
function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (a[i] || 0) ^ (b[i] || 0);
  }
  return mismatch === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
function verifyToken(request, env) {
  const auth = request.headers.get("authorization") || "";
  const x = request.headers.get("x-publish-token") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : x;
  if (!env.PUBLISH_TOKEN || !constantTimeEqual(token, env.PUBLISH_TOKEN)) {
    throw http(401, "invalid publish token");
  }
}
__name(verifyToken, "verifyToken");
function githubHeaders(env) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw http(500, "GITHUB_ACTIONS_TOKEN is not configured");
  }
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + env.GITHUB_ACTIONS_TOKEN,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "BursaMusangKing-StrategyTerminal",
    "content-type": "application/json"
  };
}
__name(githubHeaders, "githubHeaders");
function median(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) {
    return null;
  }
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
__name(median, "median");
function norm(s) {
  let v = String(s || "").toUpperCase().replace(/^MYX:/, "");
  if (v.endsWith(".KL")) {
    return v;
  }
  if (/^\d{1,4}$/.test(v)) {
    return v.padStart(4, "0") + ".KL";
  }
  return v;
}
__name(norm, "norm");
function finite(v) {
  return Number.isFinite(Number(v));
}
__name(finite, "finite");
function parse(s, f) {
  try {
    return JSON.parse(s);
  } catch {
    return f;
  }
}
__name(parse, "parse");
function json(v, status = 200) {
  return new Response(JSON.stringify(v), {
    status,
    headers: JSON_HEADERS
  });
}
__name(json, "json");
function http(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
__name(http, "http");
async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(hash, "hash");
// ===== Open tab: Off-screener badge + clickable state cards =====
var POSITION_FILTERS = {
  active: () => true,
  near_sell: (p) => p.status === "NEAR_SELL",
  buy_pending: (p) => p.status === "BUY_PENDING",
  open: (p) => p.status === "OPEN",
  off_screener: (p) => p.screener_status === "OFF_SCREENER",
  stale: (p) => p.price_stale === true
};
function screenerLookup(screener) {
  if (!screener || !screener.hits) return null;
  const cur = new Set();
  const rem = new Map();
  for (const st of STRATEGIES) {
    for (const x of Array.isArray(screener.hits?.[st]) ? screener.hits[st] : []) cur.add(`${st}|${norm(x.symbol)}`);
    for (const x of Array.isArray(screener.removed?.[st]) ? screener.removed[st] : []) rem.set(`${st}|${norm(x.symbol)}`, x);
  }
  return { cur, rem, trade_date: String(screener.trade_date || "") };
}
__name(screenerLookup, "screenerLookup");
function decoratePosition(s, look, latestTradeDate) {
  const sym = norm(s.symbol);
  const held = s.status === "OPEN" || s.status === "NEAR_SELL";
  const on = look ? STRATEGIES.filter((st) => look.cur.has(`${st}|${sym}`)) : [];
  let screenerStatus = null;
  let offSince = null;
  let offDays = null;
  if (held && look) {
    screenerStatus = on.includes(s.strategy) ? "ON_ENTRY" : on.length ? "SWITCHED" : "OFF_SCREENER";
    const r = screenerStatus === "ON_ENTRY" ? null : look.rem.get(`${s.strategy}|${sym}`);
    if (r) {
      offSince = String(r.removed_on || "") || null;
      offDays = finite(r.trading_days_removed) ? Number(r.trading_days_removed) : null;
    }
  }
  const priceStale = Boolean(held && latestTradeDate && s.last_trade_date && String(s.last_trade_date) < latestTradeDate);
  return { ...s, screener_status: screenerStatus, on_screeners: on, off_since: offSince, off_days: offDays, price_stale: priceStale };
}
__name(decoratePosition, "decoratePosition");
function injectOpenUx(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  return new HTMLRewriter().on("body", {
    element(e) { e.append('<script src="/api/open-ux.js" defer></script>', { html: true }); }
  }).transform(res);
}
__name(injectOpenUx, "injectOpenUx");
async function openUxPage(request, env) {
  const page = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  const withBase = new HTMLRewriter().on("head", {
    element(e) { e.prepend('<base href="/">', { html: true }); }
  }).on('link[rel="manifest"]', {
    element(e) {
      const src = e.getAttribute("href") || "/manifest.json";
      e.setAttribute("href", "/api/app-manifest.json?src=" + encodeURIComponent(src));
    }
  }).transform(page);
  const out = injectOpenUx(withBase);
  const headers = new Headers(out.headers);
  headers.set("cache-control", "no-store");
  return new Response(out.body, { status: out.status, headers });
}
__name(openUxPage, "openUxPage");
async function openUxManifest(request, env, url) {
  const src = new URL(url.searchParams.get("src") || "/manifest.json", url.origin);
  if (src.origin !== url.origin) throw http(400, "invalid manifest source");
  const res = await env.ASSETS.fetch(new Request(src.toString()));
  const m = parse(await res.text(), {});
  for (const icon of Array.isArray(m.icons) ? m.icons : []) {
    if (icon && icon.src) icon.src = new URL(icon.src, src).pathname;
  }
  m.id = "/app";
  m.start_url = "/api/app";
  m.scope = "/";
  return new Response(JSON.stringify(m), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(openUxManifest, "openUxManifest");
function openUxScript() {
  return new Response("(" + openUxClient.toString() + ")();", {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(openUxScript, "openUxScript");

function openUxClient() {
  if (document.getElementById('open-ux-v2-style')) return;
  const labels = {Active:'active', 'Near Sell':'near_sell', 'Buy Pending':'buy_pending', Open:'open'};
  const names = {trending:'Trending', gaining_momentum:'Momentum', meta_leader:'M.E.T.A.'};
  const tests = {
    active: () => true,
    near_sell: p => p.status === 'NEAR_SELL',
    buy_pending: p => p.status === 'BUY_PENDING',
    open: p => p.status === 'OPEN',
    off_screener: p => p.screener_status === 'OFF_SCREENER' && !p.price_stale
  };
  let positions = [], ready = false, selected = null, timer = null, loading = false;
  const style = document.createElement('style');
  style.id = 'open-ux-v2-style';
  style.textContent = '[data-ou-key]{cursor:pointer}[data-ou-key][aria-pressed="true"],[data-ou-key]:focus-visible{outline:2px solid #2dd4bf;outline-offset:-2px}[data-ou-off-card]{grid-column:1/-1}.ou-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}.ou-b{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid}.ou-off{color:#b86b00}.ou-sw{color:#1682a8}.ou-stale{color:#d34a4a}';
  document.head.appendChild(style);
  style.textContent += '#openList .card[hidden]{display:none!important}';
  const norm = s => String(s || '').trim().toUpperCase().replace(/^MYX:/,'').replace(/\.KL$/,'').replace(/^0+(?=\d)/,'');
  const observer = new MutationObserver(schedule);
  function schedule() {
    // Throttle: page updates must not postpone initialization indefinitely.
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; apply(); }, 50);
  }
  function watch() {
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  function match(card) {
    const symbol = norm(card.querySelector('.ticker')?.textContent);
    const title = (card.querySelector('.name')?.textContent || '').trim();
    const strategy = Object.keys(names).find(k => title.endsWith('· ' + names[k]));
    return positions.find(p => norm(p.symbol) === symbol && p.strategy === strategy);
  }
  function badges(card,p) {
    const parts = [];
    if (p.price_stale) parts.push(['ou-stale','Stale price since ' + (p.last_trade_date || 'unknown')]);
    else if (p.screener_status === 'OFF_SCREENER') parts.push(['ou-off','Off screener' + (p.off_days != null ? ' ' + p.off_days + 'd' : '')]);
    else if (p.screener_status === 'SWITCHED') parts.push(['ou-sw','Now on ' + (p.on_screeners || []).map(k => names[k] || k).join(', ')]);
    let box = card.querySelector('.ou-badges');
    if (!parts.length) { if(box) box.remove(); return; }
    if (!box) { box=document.createElement('div'); box.className='ou-badges'; card.querySelector('.top').after(box); }
    box.replaceChildren(...parts.map(([cls,text]) => { const b=document.createElement('span'); b.className='ou-b '+cls; b.textContent=text; return b; }));
  }
  function bind(card,key) {
    card.dataset.ouKey=key;
    card.setAttribute('role','button'); card.tabIndex=0;
    card.setAttribute('aria-pressed',String(selected===key));
  }
  function apply() {
    const root=document.getElementById('openList');
    if (!root) return;
    observer.disconnect();
    try {
      const stats=root.querySelector('.stats');
      if (!stats) return;
      const cards={};
      stats.querySelectorAll('.stat').forEach(card => {
        if(card.hasAttribute('data-ou-off-card')) return;
        const key=labels[(card.querySelector('span')?.textContent || '').trim()];
        if(key) cards[key]=card;
      });
      if (!cards.buy_pending || !cards.open) return;
      Object.entries(cards).forEach(([key,card]) => bind(card,key));
      let off=stats.querySelector('[data-ou-off-card]');
      if (!off) {
        off=document.createElement('div');off.className=cards.open.className;
        off.setAttribute('data-ou-off-card','1');
        const count=document.createElement('b'),label=document.createElement('span');
        label.textContent='Off screener';off.append(count,label);stats.append(off);
      }
      bind(off,'off_screener');
      let offCount=0, matched=0, shown=0;
      root.querySelectorAll('.card').forEach(card => {
        // Match actual position structure, including Buy Pending cards.
        if(!card.querySelector('.top .ticker') || !card.querySelector('.top .name')) return;
        const p=match(card);
        if(!p) {card.hidden=false;return;}
        matched++; if(tests.off_screener(p)) offCount++;
        badges(card,p);
        const show=!selected || tests[selected](p);
        card.hidden=!show; if(show) shown++;
      });
      off.querySelector('b').textContent=ready ? String(offCount) : '—';
      let empty=root.querySelector('[data-ou-empty]');
      if(ready && selected && matched && !shown) {
        if(!empty) {empty=document.createElement('div');empty.className='empty';empty.dataset.ouEmpty='1';root.append(empty);}
        empty.textContent='No matching positions for this filter.';
      } else if(empty) empty.remove();
    } finally {watch();}
  }
  function pick(event) {
    const card=event.target.closest('[data-ou-key]');
    if(!card || !card.closest('#openList')) return;
    if(event.type==='keydown' && event.key!=='Enter' && event.key!==' ') return;
    event.preventDefault();
    selected=selected===card.dataset.ouKey ? null : card.dataset.ouKey;
    apply();
  }
  async function load() {
    if(loading) return; loading=true;
    try {
      const response=await fetch('/api/positions',{cache:'no-store'});
      if(!response.ok) throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(!data.ok || !Array.isArray(data.positions)) throw new Error('Invalid positions response');
      positions=data.positions;ready=true;apply();
    } catch(error) {console.warn('Open filters: unable to refresh positions',error);}
    finally {loading=false;}
  }
  document.addEventListener('click',pick);
  document.addEventListener('keydown',pick);
  document.addEventListener('visibilitychange',() => {if(!document.hidden) load();});
  watch();apply();load();setInterval(load,120000);
}

__name(openUxClient, "openUxClient");
export {
  classifySameDatePayload,
  constantTimeEqual,
  decorateScreenerMembership,
  index_default as default,
  payloadHash,
  validatePayload,
  verifyToken
};
