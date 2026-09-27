const pe=s=>document.querySelector(s);
const pesc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plabels={trending:'Trending',gaining_momentum:'Momentum',meta_leader:'M.E.T.A.'};
const pEvent={BUY_SIGNAL:'BUY SIGNAL',ENTRY_CONFIRMED:'ENTRY CONFIRMED',NEAR_SELL:'NEAR SELL',SELL:'SELL'};
const pMoney=n=>Number.isFinite(Number(n))?'RM '+Number(n).toFixed(Number(n)<1?3:2):'—';
const pPct=n=>Number.isFinite(Number(n))?`${Number(n)>=0?'+':''}${Number(n).toFixed(2)}%`:'—';
const pStrategies=['trending','gaining_momentum','meta_leader'];

let pRawStrategy='gaining_momentum';
let pMembershipView='current';
let pEventFilter='ALL';
let pLast=null;

function pTime(iso){
  if(!iso)return 'No preview yet';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return 'No preview yet';
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:true
  }).format(d)+' MYT';
}

// Backward-compatible local score. New scans already carry strength_score and
// strength_rank from StrategyTerminal's Python publisher; this fallback lets an
// older cached preview still render sensibly until the next scan completes.
function pClamp(v,lo=0,hi=1){return Math.max(lo,Math.min(hi,v))}
function pLocalStrength(strategy,x){
  const adx=Number.isFinite(Number(x.adx))?Number(x.adx):0;
  const rsi=Number.isFinite(Number(x.rsi))?Number(x.rsi):null;
  const vol=Number.isFinite(Number(x.vol_ratio))?Number(x.vol_ratio):0;
  const roc=Number.isFinite(Number(x.roc10))?Number(x.roc10):0;
  const a=pClamp(adx/50),v=pClamp(vol/3),r=pClamp(Math.max(roc,0)/15);
  const q=rsi==null?0:pClamp(1-Math.abs(rsi-62.5)/12.5);
  let s;
  if(strategy==='trending')s=.50*a+.30*q+.20*v;
  else if(strategy==='gaining_momentum')s=.50*r+.30*v+.20*a;
  else if(strategy==='meta_leader')s=.40*a+.40*v+.20*r;
  else s=(a+v+r)/3;
  return Math.round(1000*pClamp(s))/10;
}

function preparedCurrentRows(s,strategy){
  const rows=Array.isArray(s?.hits?.[strategy])?s.hits[strategy]:[];
  const haveRanks=rows.every(x=>Number.isFinite(Number(x.strength_rank))&&Number.isFinite(Number(x.strength_score)));
  if(haveRanks)return rows;
  return [...rows]
    .map(x=>({...x,strength_score:pLocalStrength(strategy,x)}))
    .sort((a,b)=>Number(b.strength_score)-Number(a.strength_score)||Number(b.vol_ratio||0)-Number(a.vol_ratio||0)||String(a.symbol||'').localeCompare(String(b.symbol||'')))
    .map((x,i)=>({...x,strength_rank:i+1}));
}

function membershipBadge(x){
  if(x.membership_status==='NEW')return '<span class="membership-badge membership-new">NEW</span>';
  if(x.membership_status==='RE_ENTERED')return '<span class="membership-badge membership-reentered">RE-ENTERED</span>';
  return '';
}

function rankMove(x){
  const n=Number(x.rank_change);
  if(!Number.isFinite(n)||x.membership_status!=='CONTINUING')return '';
  if(n>0)return `<span class="rank-move rank-up">↑${n}</span>`;
  if(n<0)return `<span class="rank-move rank-down">↓${Math.abs(n)}</span>`;
  return '<span class="rank-move rank-flat">—</span>';
}

function rawCard(x){
  const sym=String(x.symbol||'').replace('.KL','');
  const score=Number(x.strength_score);
  const rank=Number(x.strength_rank);
  return `<div class="card preview-raw-card">
    <div class="top">
      <div>
        <div class="ticker-line"><span class="ticker">#${Number.isFinite(rank)?rank:'—'} ${pesc(sym)}</span>${membershipBadge(x)}</div>
        <div class="name">${pesc(x.name||'')}</div>
      </div>
      <div class="price">
        ${pMoney(x.close)}
        <div class="badge-row">
          ${Number.isFinite(score)?`<span class="strength-badge">Strength ${score.toFixed(1)}</span>`:''}
          ${rankMove(x)}
        </div>
      </div>
    </div>
    <div class="meta">
      <div class="kv"><span>RSI</span><b>${Number.isFinite(Number(x.rsi))?Number(x.rsi).toFixed(1):'—'}</b></div>
      <div class="kv"><span>ADX</span><b>${Number.isFinite(Number(x.adx))?Number(x.adx).toFixed(1):'—'}</b></div>
      <div class="kv"><span>Volume</span><b>${Number.isFinite(Number(x.vol_ratio))?Number(x.vol_ratio).toFixed(2)+'×':'—'}</b></div>
      <div class="kv"><span>ROC10</span><b>${Number.isFinite(Number(x.roc10))?pPct(x.roc10):'—'}</b></div>
    </div>
  </div>`;
}

function removedAge(x){
  const n=Number(x.trading_days_removed);
  if(!Number.isFinite(n)||n<=0)return 'Removed this scan';
  return `Removed ${n} trading day${n===1?'':'s'} ago`;
}

function removedCard(x){
  const sym=String(x.symbol||'').replace('.KL','');
  const score=Number(x.strength_score);
  const rank=Number(x.strength_rank);
  return `<div class="card removed-card">
    <div class="top">
      <div>
        <div class="ticker-line"><span class="ticker">${pesc(sym)}</span><span class="membership-badge membership-removed">REMOVED</span></div>
        <div class="name">${pesc(x.name||'')}</div>
      </div>
      <div class="price">
        ${pMoney(x.close)}
        <div class="badge-row">${Number.isFinite(score)?`<span class="strength-badge muted-strength">Last strength ${score.toFixed(1)}</span>`:''}</div>
      </div>
    </div>
    <div class="meta">
      <div class="kv"><span>Last rank</span><b>${Number.isFinite(rank)?'#'+rank:'—'}</b></div>
      <div class="kv"><span>Removed on</span><b>${pesc(x.removed_on||'—')}</b></div>
      <div class="kv"><span>Age</span><b>${pesc(removedAge(x))}</b></div>
      <div class="kv"><span>Status</span><b>SCREENER ONLY</b></div>
    </div>
    <div class="msg">No longer qualifies for this screener. This is not a SELL signal and does not close an open ATR strategy position.</div>
  </div>`;
}

function pCard(e){
  return `<div class="card">
    <div class="top">
      <div>
        <div class="ticker">${pesc(String(e.symbol||'').replace('.KL',''))}</div>
        <div class="name">${pesc(e.name||'')} · ${pesc(plabels[e.strategy]||e.strategy)}</div>
      </div>
      <div class="price">
        ${pMoney(e.price)}
        <div class="badge-row"><span class="badge ${pesc(e.event_type)}">PREVIEW ${pesc(pEvent[e.event_type]||e.event_type)}</span></div>
      </div>
    </div>
    <div class="msg">${pesc(e.message||'')}</div>
  </div>`;
}

function summaryHtml(p,s){
  const b=p?.breadth||{};
  const screened=Number(s?.stocks_screened||p?.stocks_screened||0);
  const current=Number(p?.rows_received||0);
  return [
    ['Screened',screened],
    ['Current bars',current],
    ['Advancers',Number(b.advancers||0)],
    ['Decliners',Number(b.decliners||0)]
  ].map(([label,value])=>`<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('');
}

function rawTabsHtml(s){
  const counts=s?.counts||{};
  return pStrategies.map(st=>
    `<button class="${st===pRawStrategy?'on':''}" data-raw-strategy="${st}">${pesc(plabels[st])} ${Number(counts[st]||0)}</button>`
  ).join('');
}

function membershipTabsHtml(s){
  const m=s?.membership_counts?.[pRawStrategy]||{};
  const current=Number(m.current??s?.counts?.[pRawStrategy]??0);
  const removed=Number(m.removed_visible??(s?.removed?.[pRawStrategy]||[]).length??0);
  return `<button class="${pMembershipView==='current'?'on':''}" data-membership-view="current">Current ${current}</button>
          <button class="${pMembershipView==='removed'?'on':''}" data-membership-view="removed">Removed ${removed}</button>`;
}

function membershipSummary(s){
  const m=s?.membership_counts?.[pRawStrategy];
  if(!m)return 'Current screener matches';
  if(s?.membership?.baseline)return 'Membership baseline created · changes will be tracked from the next preview scan';
  const migrated=s?.membership?.migrated_from_previous_snapshot?' · previous preview snapshot recovered':'';
  const deferred=Number(m.deferred_unavailable||0)>0?` · ${Number(m.deferred_unavailable)} unavailable deferred`:'';
  return `${Number(m.new||0)} NEW · ${Number(m.reentered||0)} re-entered · ${Number(m.continuing||0)} continuing${deferred}${migrated}`;
}

function confluenceRows(events){
  const by=new Map();
  for(const e of events.filter(x=>x.event_type==='BUY_SIGNAL')){
    const key=String(e.symbol||'');
    const x=by.get(key)||{symbol:key,name:e.name||'',strategies:new Set()};
    x.strategies.add(e.strategy);
    if(!x.name&&e.name)x.name=e.name;
    by.set(key,x);
  }
  return [...by.values()]
    .filter(x=>x.strategies.size>=2)
    .sort((a,b)=>b.strategies.size-a.strategies.size||a.symbol.localeCompare(b.symbol));
}

function renderConfluence(events){
  const host=pe('#previewConfluence');
  if(!host)return;
  const rows=confluenceRows(events);
  host.innerHTML=rows.length?rows.map(x=>`<div class="card">
    <div class="top">
      <div>
        <div class="ticker">🔥 ${pesc(String(x.symbol||'').replace('.KL',''))}</div>
        <div class="name">${pesc(x.name||'')}</div>
      </div>
      <div class="badge BUY_SIGNAL">${x.strategies.size}/3 BUY</div>
    </div>
    <div class="msg">${[...x.strategies].map(s=>pesc(plabels[s]||s)).join(' · ')}</div>
  </div>`).join(''):'<div class="empty compact">No multi-strategy potential buys in this preview.</div>';
}

function renderPotentialSignals(events){
  const host=pe('#previewSignals');
  if(!host)return;
  const filtered=events.filter(x=>pEventFilter==='ALL'||x.event_type===pEventFilter);

  host.innerHTML=pStrategies.map(strategy=>{
    const rows=filtered.filter(x=>x.strategy===strategy);
    const all=events.filter(x=>x.strategy===strategy);
    const counts={
      buy:all.filter(x=>x.event_type==='BUY_SIGNAL').length,
      entry:all.filter(x=>x.event_type==='ENTRY_CONFIRMED').length,
      near:all.filter(x=>x.event_type==='NEAR_SELL').length,
      sell:all.filter(x=>x.event_type==='SELL').length
    };
    return `<section class="preview-signal-group strategy-${pesc(strategy)}">
      <div class="preview-signal-head">
        <div>
          <div class="strategy-title">${pesc(plabels[strategy]||strategy)}</div>
          <div class="strategy-sub">${all.length} potential event${all.length===1?'':'s'}</div>
        </div>
        <div class="strategy-mini-counts">
          <span class="mini-buy">B ${counts.buy}</span>
          ${counts.entry?`<span class="mini-entry">E ${counts.entry}</span>`:''}
          <span class="mini-near">N ${counts.near}</span>
          <span class="mini-sell">S ${counts.sell}</span>
        </div>
      </div>
      <div class="stack">
        ${rows.length?rows.map(pCard).join(''):`<div class="empty compact">No matching ${pesc(plabels[strategy])} preview signals.</div>`}
      </div>
    </section>`;
  }).join('');
}

function renderRawScreener(s){
  const source=pe('#previewRawSource');
  const tabs=pe('#previewRawTabs');
  const memberTabs=pe('#previewMembershipTabs');
  const rawList=pe('#previewRawList');
  if(!tabs||!memberTabs||!rawList)return;

  const counts=s?.counts||{};
  const total=Number(counts.trending||0)+Number(counts.gaining_momentum||0)+Number(counts.meta_leader||0);
  if(source)source.textContent=s?`${total} current matches · strength-ranked`:'No raw scan yet';

  tabs.innerHTML=rawTabsHtml(s);
  tabs.querySelectorAll('[data-raw-strategy]').forEach(b=>{
    b.onclick=()=>{
      pRawStrategy=b.dataset.rawStrategy;
      pMembershipView='current';
      renderRawScreener(pLast?.screener||null);
    };
  });

  memberTabs.innerHTML=membershipTabsHtml(s);
  memberTabs.querySelectorAll('[data-membership-view]').forEach(b=>{
    b.onclick=()=>{
      pMembershipView=b.dataset.membershipView;
      renderRawScreener(pLast?.screener||null);
    };
  });

  if(!s){
    rawList.innerHTML='<div class="empty">No screener preview yet.</div>';
    return;
  }

  const summary=pe('#previewMembershipSummary');
  if(summary){
    summary.textContent=pMembershipView==='current'
      ?membershipSummary(s)
      :`Removed counters are retained for ${Number(s?.membership?.removed_retention_trading_days||20)} trading days · not SELL signals`;
  }

  if(pMembershipView==='removed'){
    const rows=Array.isArray(s?.removed?.[pRawStrategy])?s.removed[pRawStrategy]:[];
    rawList.innerHTML=rows.length
      ?rows.map(removedCard).join('')
      :`<div class="empty compact">No recently removed ${pesc(plabels[pRawStrategy])} counters.</div>`;
    return;
  }

  const rows=preparedCurrentRows(s,pRawStrategy);
  rawList.innerHTML=rows.length
    ?rows.map(rawCard).join('')
    :`<div class="empty compact">No ${pesc(plabels[pRawStrategy])} matches.</div>`;
}

function renderPreview(j){
  pLast=j;
  const p=j.preview||null;
  const s=j.screener||null;

  const stamp=pe('#previewStamp');
  const status=pe('#previewStatus');
  const stats=pe('#previewStats');
  if(!stamp||!stats)return;

  const generated=s?.generated_at||p?.generated_at;
  const tradeDate=s?.trade_date||p?.trade_date||'';
  stamp.textContent=generated?`${tradeDate} · ${pTime(generated)}`:'No preview yet';
  if(status)status.textContent=(s||p)?'Preview only · official records unchanged':'Waiting for first preview scan';
  stats.innerHTML=summaryHtml(p,s);

  renderRawScreener(s);

  const events=Array.isArray(p?.events)?p.events:[];
  renderConfluence(events);
  renderPotentialSignals(events);
}

async function loadPreview(){
  const stamp=pe('#previewStamp');
  try{
    const r=await fetch('/api/preview',{cache:'no-store'});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||r.statusText);
    renderPreview(j);
  }catch(e){
    if(stamp)stamp.textContent='Preview error';
    const raw=pe('#previewRawList');
    const sig=pe('#previewSignals');
    if(raw)raw.innerHTML=`<div class="empty">${pesc(e.message)}</div>`;
    if(sig)sig.innerHTML='<div class="empty">Preview data unavailable.</div>';
  }
}

document.querySelectorAll('[data-preview-event]').forEach(b=>{
  b.onclick=()=>{
    pEventFilter=b.dataset.previewEvent;
    document.querySelectorAll('[data-preview-event]').forEach(x=>x.classList.toggle('on',x===b));
    renderPotentialSignals(Array.isArray(pLast?.preview?.events)?pLast.preview.events:[]);
  };
});

document.querySelector('[data-nav="preview"]')?.addEventListener('click',loadPreview);
pe('#refresh')?.addEventListener('click',loadPreview);

loadPreview();
setInterval(loadPreview,60000);
