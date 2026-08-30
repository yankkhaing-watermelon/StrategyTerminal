/**
 * Bursa Strategy Terminal — single Worker.
 *
 * Responsibilities (no Pages, no KV, no D1):
 *   GET  /                 -> the terminal UI (inlined HTML/CSS/JS)
 *   GET  /api/:name        -> proxy data/:name.json from raw.githubusercontent
 *                             (today | preview | removals | history)
 *   POST /run              -> workflow_dispatch the Preview screen on GitHub
 *
 * Required vars (wrangler.toml [vars] + one secret):
 *   GH_OWNER, GH_REPO, GH_BRANCH, PREVIEW_WORKFLOW   (plain vars)
 *   GH_DISPATCH_TOKEN                                (secret: contents:read + actions:write)
 */

const ALLOWED = new Set(["today", "preview", "removals", "history"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/" || pathname === "/index.html") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (pathname.startsWith("/api/")) {
      const name = pathname.slice(5).replace(/\.json$/, "");
      if (!ALLOWED.has(name)) return json({ error: "unknown feed" }, 404);
      const raw = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/${env.GH_BRANCH}/data/${name}.json`;
      const r = await fetch(raw, { cf: { cacheTtl: 60, cacheEverything: true } });
      if (!r.ok) return json({ error: "feed not published yet", status: r.status }, 404);
      return new Response(r.body, {
        headers: { "content-type": "application/json; charset=utf-8",
                   "cache-control": "public, max-age=60" },
      });
    }

    if (pathname === "/run" && request.method === "POST") {
      if (!env.GH_DISPATCH_TOKEN) return json({ error: "dispatch token not set" }, 500);
      const wf = env.PREVIEW_WORKFLOW || "preview.yml";
      const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${wf}/dispatches`;
      const r = await fetch(api, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${env.GH_DISPATCH_TOKEN}`,
          "accept": "application/vnd.github+json",
          "user-agent": "bursa-strategy-terminal",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ref: env.GH_BRANCH }),
      });
      if (r.status === 204) return json({ ok: true });
      return json({ error: "dispatch failed", status: r.status, detail: await r.text() }, 502);
    }

    return json({ error: "not found" }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const PAGE = /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bursa Strategy Terminal</title>
<style>
  :root{
    --bg:#0a0e14; --panel:#111823; --panel2:#0f1620; --line:#1c2733;
    --ink:#e6edf3; --dim:#8b98a5; --accent:#2dd4bf; --accent2:#38bdf8;
    --new:#38bdf8; --buy:#34d399; --warn:#f59e0b; --bad:#f87171;
  }
  *{box-sizing:border-box} html,body{margin:0}
  body{background:var(--bg);color:var(--ink);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:520px;margin:0 auto;padding:16px 14px 90px}
  header{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .mk{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-weight:800;color:#05221f;font-size:13px}
  header h1{font-size:16px;margin:0;font-weight:700;flex:1}
  .run{display:flex;align-items:center;gap:6px;background:var(--accent);color:#05221f;border:0;font-weight:700;padding:8px 14px;border-radius:9px;cursor:pointer;font-size:13px}
  .run:disabled{opacity:.55;cursor:progress}
  .modebar{display:flex;gap:8px;margin-bottom:14px}
  .modebar button{flex:1;background:var(--panel);color:var(--dim);border:1px solid var(--line);padding:9px;border-radius:10px;font-weight:600;cursor:pointer}
  .modebar button.on{color:var(--ink);border-color:var(--accent);background:var(--panel2)}
  .banner{font-size:11px;letter-spacing:.14em;color:var(--accent);font-weight:700;text-transform:uppercase;margin:2px 0 4px}
  .date{font-size:12px;color:var(--dim);margin-bottom:14px}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .stat b{font-size:26px;font-weight:800;display:block}
  .stat span{font-size:12px;color:var(--dim)}
  .filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .chip{background:var(--panel);color:var(--dim);border:1px solid var(--line);padding:7px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer}
  .chip.on{color:var(--ink);border-color:var(--accent);background:var(--panel2)}
  .chip .n{color:var(--accent)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}
  .top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .sym{font-weight:800;font-size:15px}
  .tag{font-size:9px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:6px;margin-left:7px;vertical-align:middle}
  .tag.new{background:rgba(56,189,248,.15);color:var(--new)}
  .tag.buy{background:rgba(52,211,153,.15);color:var(--buy)}
  .name{color:var(--dim);font-size:12px;margin-top:2px}
  .price{font-weight:800;font-size:15px;text-align:right;white-space:nowrap}
  .strength{display:inline-block;margin-top:6px;font-size:11px;font-weight:700;color:var(--accent);background:rgba(45,212,191,.12);padding:3px 9px;border-radius:7px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
  .cell span{display:block;font-size:9px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}
  .cell b{font-size:13px;font-weight:700}
  .pos{color:var(--buy)} .neg{color:var(--bad)}
  .rm{display:flex;justify-content:space-between;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:13px}
  .rm small{color:var(--dim);font-size:11px}
  .empty{color:var(--dim);text-align:center;padding:40px 0}
  .foot{color:var(--dim);font-size:11px;text-align:center;margin-top:20px}
</style></head><body><div class="wrap">
  <header>
    <div class="mk">MK</div><h1>Bursa Strategy Terminal</h1>
    <button class="run" id="run">▶ Run</button>
  </header>

  <div class="modebar">
    <button id="m-today" class="on" onclick="setMode('today')">Today · After-Close</button>
    <button id="m-preview" onclick="setMode('preview')">Preview · Intraday</button>
  </div>

  <div class="banner" id="banner">Full Bursa · Official After-Close View</div>
  <div class="date" id="date">Loading…</div>

  <div class="stats">
    <div class="stat"><b id="s-screened">–</b><span>Screened</span></div>
    <div class="stat"><b id="s-hits">–</b><span>Matches</span></div>
    <div class="stat"><b id="s-new">–</b><span>New</span></div>
    <div class="stat"><b id="s-removed">–</b><span>Removed (20d)</span></div>
  </div>

  <div class="filters" id="filters"></div>
  <div id="list"></div>
  <div class="foot" id="foot"></div>
</div>
<script>
const CUR = { RM:"RM" };
let STATE = { mode:"today", strat:"all", onlyNew:false, showRemoved:false, data:null };

function setMode(m){
  STATE.mode = m; STATE.showRemoved = false; STATE.strat = "all"; STATE.onlyNew = false;
  document.getElementById("m-today").classList.toggle("on", m==="today");
  document.getElementById("m-preview").classList.toggle("on", m==="preview");
  document.getElementById("banner").textContent = m==="today"
    ? "Full Bursa · Official After-Close View" : "Full Bursa · Intraday Preview (not official)";
  load();
}

async function load(){
  const el = document.getElementById("list"); el.innerHTML = '<div class="empty">Loading…</div>';
  try{
    const r = await fetch("/api/"+STATE.mode, {cache:"no-store"});
    if(!r.ok) throw new Error("no feed");
    STATE.data = await r.json(); render();
  }catch(e){
    el.innerHTML = '<div class="empty">No '+STATE.mode+' screen published yet.'+
      (STATE.mode==="preview"?'<br>Tap ▶ Run to generate one.':'')+'</div>';
    document.getElementById("date").textContent = "—";
    ["screened","hits","new","removed"].forEach(k=>document.getElementById("s-"+k).textContent="–");
    document.getElementById("filters").innerHTML="";
  }
}

function render(){
  const d = STATE.data, cur = CUR[d.currency] || d.currency || "";
  document.getElementById("date").textContent =
    (d.official?"Official · ":"Preview · ") + "Bursa date " + (d.scan_date||"") +
    " · generated " + new Date(d.generated_at).toLocaleString();
  document.getElementById("s-screened").textContent = d.stocks_screened ?? "–";
  document.getElementById("s-hits").textContent = d.total_hits ?? d.stocks?.length ?? "–";
  document.getElementById("s-new").textContent = d.new_count ?? "–";
  document.getElementById("s-removed").textContent = (d.removals?.length ?? 0);

  // filter chips
  const f = document.getElementById("filters"); f.innerHTML = "";
  const chip = (label, on, fn) => { const b=document.createElement("button");
    b.className="chip"+(on?" on":""); b.innerHTML=label; b.onclick=fn; f.appendChild(b); };
  chip("All <span class='n'>"+d.stocks.length+"</span>", STATE.strat==="all"&&!STATE.showRemoved,
    ()=>{STATE.strat="all";STATE.showRemoved=false;render();});
  (d.strategies||[]).forEach(s=>chip(s.label+" <span class='n'>"+s.count+"</span>",
    STATE.strat===s.key&&!STATE.showRemoved, ()=>{STATE.strat=s.key;STATE.showRemoved=false;render();}));
  chip("New <span class='n'>"+(d.new_count||0)+"</span>", STATE.onlyNew&&!STATE.showRemoved,
    ()=>{STATE.onlyNew=!STATE.onlyNew;STATE.showRemoved=false;render();});
  if(d.official) chip("Removed <span class='n'>"+(d.removals?.length||0)+"</span>", STATE.showRemoved,
    ()=>{STATE.showRemoved=!STATE.showRemoved;render();});

  const list = document.getElementById("list");
  if(STATE.showRemoved){ renderRemovals(d, list); return; }

  let rows = d.stocks.slice();
  if(STATE.strat!=="all") rows = rows.filter(s=>(s.strategies||[s.strategy]).includes(STATE.strat));
  if(STATE.onlyNew) rows = rows.filter(s=>s.is_new);
  if(!rows.length){ list.innerHTML='<div class="empty">No matches.</div>'; return; }

  list.innerHTML = rows.map((s,i)=>{
    const chg = s.change_pct ?? 0, roc = s.roc10 ?? 0;
    const tag = s.is_new ? '<span class="tag new">NEW</span>' :
      (s.strength>=60?'<span class="tag buy">STRONG</span>':'');
    return \`<div class="card">
      <div class="top">
        <div><span class="sym">#\${i+1} \${s.symbol}</span>\${tag}
          <div class="name">\${s.name||""}</div>
          <div class="strength">Strength \${s.strength ?? "–"}</div></div>
        <div class="price">\${cur} \${fmt(s.price)}</div>
      </div>
      <div class="grid">
        \${cell("RSI", s.rsi)}\${cell("ADX", s.adx)}
        \${cell("VOLUME", (s.vol_ratio!=null?s.vol_ratio+"×":"–"))}
        \${cell("ROC10", (roc>=0?"+":"")+roc.toFixed(2)+"%", roc>=0?"pos":"neg")}
      </div></div>\`;
  }).join("");
}

function renderRemovals(d, list){
  const rm = d.removals||[];
  if(!rm.length){ list.innerHTML='<div class="empty">No removals in the last 20 days.</div>'; return; }
  list.innerHTML = rm.map(e=>\`<div class="rm">
    <div><b>\${e.symbol}</b> <small>\${e.name||""}</small></div>
    <div style="text-align:right"><small>removed \${e.removed_on}<br>last seen \${e.last_seen||"–"}</small></div>
  </div>\`).join("");
}

function cell(label,val,cls){ return \`<div class="cell"><span>\${label}</span><b class="\${cls||""}">\${val??"–"}</b></div>\`; }
function fmt(n){ if(n==null) return "–"; return Number(n)<1?Number(n).toFixed(3):Number(n).toFixed(2); }

// ----- Run button: dispatch Preview, then poll for a fresher timestamp -----
document.getElementById("run").onclick = async ()=>{
  const btn = document.getElementById("run"); btn.disabled=true; btn.textContent="⏳ Running…";
  const before = await currentPreviewStamp();
  try{
    const r = await fetch("/run",{method:"POST"});
    if(!r.ok) throw new Error("dispatch failed");
    setMode("preview");
    await pollPreview(before, btn);
  }catch(e){ btn.textContent="⚠ Failed"; setTimeout(()=>{btn.disabled=false;btn.textContent="▶ Run";},2500); }
};
async function currentPreviewStamp(){
  try{ const r=await fetch("/api/preview",{cache:"no-store"}); if(!r.ok) return null;
       return (await r.json()).generated_at; }catch{ return null; }
}
async function pollPreview(before, btn){
  const deadline = Date.now()+7*60*1000;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,12000));
    const now = await currentPreviewStamp();
    if(now && now!==before){ load(); btn.disabled=false; btn.textContent="▶ Run"; return; }
  }
  btn.disabled=false; btn.textContent="▶ Run";  // timed out; feed will appear when ready
}

setMode("today");
</script></body></html>`;
