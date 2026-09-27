const tq=s=>document.querySelector(s);
const tesc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tlabels={trending:'Trending',gaining_momentum:'Momentum',meta_leader:'M.E.T.A.'};
const tevent={BUY_SIGNAL:'BUY SIGNAL',ENTRY_CONFIRMED:'ENTRY CONFIRMED',NEAR_SELL:'NEAR SELL',SELL:'SELL'};
const tstate={BUY_PENDING:'BUY SIGNAL',OPEN:'ENTRY CONFIRMED',NEAR_SELL:'NEAR SELL'};
const tStrategies=['trending','gaining_momentum','meta_leader'];

let tStrategy='gaining_momentum';
let tMembership='current';
let tEventFilter='ALL';
let tTradeView='changes';
let tDashboard=null;
let tPositions=[];
let tDisplayScreener=null;
let tObserver=null;
let tTimer=null;
let tRendering=false;

const tNum=v=>{
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
};
const tMoney=v=>{const n=tNum(v);return n===null?'—':'RM '+n.toFixed(n<1?3:2)};
const tAtrMoney=v=>{const n=tNum(v);return n===null?'—':'RM '+n.toFixed(n<1?3:2)};
const tPct=v=>{const n=tNum(v);return n===null?'—':`${n>=0?'+':''}${n.toFixed(2)}%`};
const tSym=v=>String(v||'').trim().toUpperCase().replace(/^MYX:/,'').replace(/\.KL$/,'');
const tKey=x=>`${x.strategy}|${tSym(x.symbol)}`;
const tClamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));

function tTime(iso){
  if(!iso)return 'Last update —';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return 'Last update —';
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:true
  }).format(d)+' MYT';
}

function tLocalStrength(strategy,x){
  const adx=tNum(x.adx)??0,rsi=tNum(x.rsi),vol=tNum(x.vol_ratio)??0,roc=tNum(x.roc10)??0;
  const a=tClamp(adx/50),v=tClamp(vol/3),r=tClamp(Math.max(roc,0)/15);
  const q=rsi===null?0:tClamp(1-Math.abs(rsi-62.5)/12.5);
  let s;
  if(strategy==='trending')s=.50*a+.30*q+.20*v;
  else if(strategy==='gaining_momentum')s=.50*r+.30*v+.20*a;
  else if(strategy==='meta_leader')s=.40*a+.40*v+.20*r;
  else s=(a+v+r)/3;
  return Math.round(1000*tClamp(s))/10;
}

function preparedRows(s,strategy){
  const rows=Array.isArray(s?.hits?.[strategy])?s.hits[strategy]:[];
  const ready=rows.every(x=>tNum(x.strength_rank)!==null&&tNum(x.strength_score)!==null);
  if(ready){
    return [...rows].sort((a,b)=>Number(a.strength_rank)-Number(b.strength_rank)||Number(b.strength_score)-Number(a.strength_score)||String(a.symbol||'').localeCompare(String(b.symbol||'')));
  }
  return [...rows]
    .map(x=>({...x,strength_score:tLocalStrength(strategy,x)}))
    .sort((a,b)=>Number(b.strength_score)-Number(a.strength_score)||Number(b.vol_ratio||0)-Number(a.vol_ratio||0)||String(a.symbol||'').localeCompare(String(b.symbol||'')))
    .map((x,i)=>({...x,strength_rank:i+1}));
}

function membershipBadge(x){
  if(x.membership_status==='NEW')return '<span class="membership-badge membership-new">NEW</span>';
  if(x.membership_status==='RE_ENTERED')return '<span class="membership-badge membership-reentered">RE-ENTERED</span>';
  return '';
}
function rankMove(x){
  const n=tNum(x.rank_change);
  if(n===null||x.membership_status!=='CONTINUING')return '';
  if(n>0)return `<span class="rank-move rank-up">↑${n}</span>`;
  if(n<0)return `<span class="rank-move rank-down">↓${Math.abs(n)}</span>`;
  return '<span class="rank-move rank-flat">—</span>';
}

function eventMap(){
  const map=new Map(),pri={SELL:4,NEAR_SELL:3,ENTRY_CONFIRMED:2,BUY_SIGNAL:1};
  for(const e of tDashboard?.events||[]){
    const key=tKey(e),prev=map.get(key);
    if(!prev||(pri[e.event_type]||0)>(pri[prev.event_type]||0))map.set(key,e);
  }
  return map;
}
function lifecycleBadge(strategy,symbol){
  const e=eventMap().get(`${strategy}|${tSym(symbol)}`);
  return e?`<span class="badge ${tesc(e.event_type)}">${tesc(tevent[e.event_type]||e.event_type)}</span>`:'';
}

function rawCard(strategy,x){
  const score=tNum(x.strength_score),rank=tNum(x.strength_rank);
  return `<div class="card preview-raw-card">
    <div class="top">
      <div>
        <div class="ticker-line"><span class="ticker">#${rank===null?'—':rank} ${tesc(tSym(x.symbol))}</span>${membershipBadge(x)}</div>
        <div class="name">${tesc(x.name||'')}</div>
      </div>
      <div class="price">${tMoney(x.close)}<div class="badge-row">
        ${score===null?'':`<span class="strength-badge">Strength ${score.toFixed(1)}</span>`}${rankMove(x)}${lifecycleBadge(strategy,x.symbol)}
      </div></div>
    </div>
    <div class="meta">
      <div class="kv"><span>RSI</span><b>${tNum(x.rsi)===null?'—':Number(x.rsi).toFixed(1)}</b></div>
      <div class="kv"><span>ADX</span><b>${tNum(x.adx)===null?'—':Number(x.adx).toFixed(1)}</b></div>
      <div class="kv"><span>Volume</span><b>${tNum(x.vol_ratio)===null?'—':Number(x.vol_ratio).toFixed(2)+'×'}</b></div>
      <div class="kv"><span>ROC10</span><b>${tPct(x.roc10)}</b></div>
    </div>
  </div>`;
}

function removedAge(x){
  const n=tNum(x.trading_days_removed);
  if(n===null||n<=0)return 'Removed this scan';
  return `Removed ${n} trading day${n===1?'':'s'} ago`;
}
function removedCard(strategy,x){
  const score=tNum(x.strength_score),rank=tNum(x.strength_rank);
  return `<div class="card removed-card">
    <div class="top">
      <div><div class="ticker-line"><span class="ticker">${tesc(tSym(x.symbol))}</span><span class="membership-badge membership-removed">REMOVED</span></div><div class="name">${tesc(x.name||'')}</div></div>
      <div class="price">${tMoney(x.close)}<div class="badge-row">${score===null?'':`<span class="strength-badge muted-strength">Last strength ${score.toFixed(1)}</span>`}${lifecycleBadge(strategy,x.symbol)}</div></div>
    </div>
    <div class="meta">
      <div class="kv"><span>Last rank</span><b>${rank===null?'—':'#'+rank}</b></div>
      <div class="kv"><span>Removed on</span><b>${tesc(x.removed_on||'—')}</b></div>
      <div class="kv"><span>Age</span><b>${tesc(removedAge(x))}</b></div>
      <div class="kv"><span>Status</span><b>SCREENER ONLY</b></div>
    </div>
    <div class="msg">No longer qualifies for this screener. This is not a SELL signal and does not close an open ATR strategy position.</div>
  </div>`;
}

function signalCard(e){
  return `<div class="card">
    <div class="top"><div><div class="ticker">${tesc(tSym(e.symbol))}</div><div class="name">${tesc(e.name||'')} · ${tesc(tlabels[e.strategy]||e.strategy)}</div></div>
      <div class="price">${tMoney(e.price)}<div class="badge-row"><span class="badge ${tesc(e.event_type)}">${tesc(tevent[e.event_type]||e.event_type)}</span></div></div>
    </div>
    <div class="msg">${tesc(e.message||'')}</div>
  </div>`;
}

function continuingReturn(x){
  if(tNum(x.return_pct)!==null)return tNum(x.return_pct);
  const latest=tNum(x.latest_close),entry=tNum(x.entry_price);
  return latest!==null&&entry!==null&&entry>0?(latest/entry-1)*100:null;
}
function continuingCard(x){
  const status=tstate[x.status]||String(x.status||'').replaceAll('_',' ');
  const badgeClass=x.status==='NEAR_SELL'?'NEAR_SELL':x.status==='BUY_PENDING'?'BUY_SIGNAL':'ENTRY_CONFIRMED';
  const price=x.status==='BUY_PENDING'?x.latest_close:(x.latest_close??x.entry_price);
  return `<div class="card">
    <div class="top"><div><div class="ticker">${tesc(tSym(x.symbol))}</div><div class="name">${tesc(x.name||'')} · ${tesc(tlabels[x.strategy]||x.strategy)}</div></div>
      <div class="price">${tMoney(price)}<div class="badge-row"><span class="badge ${badgeClass}">${tesc(status)}</span><span class="rank-move rank-flat">CONTINUING</span></div></div>
    </div>
    <div class="meta">
      <div class="kv"><span>Entry</span><b>${x.status==='BUY_PENDING'?'NEXT OPEN':tMoney(x.entry_price)}</b></div>
      <div class="kv"><span>ATR stop</span><b>${x.status==='BUY_PENDING'?'PENDING':tAtrMoney(x.atr_stop)}</b></div>
      <div class="kv"><span>Return</span><b>${tPct(continuingReturn(x))}</b></div>
      <div class="kv"><span>Held</span><b>${Number(x.hold_days||0)}d</b></div>
    </div>
    <div class="msg">No lifecycle status change on ${tesc(tDashboard?.trade_date||'the latest official trade date')}.</div>
  </div>`;
}

function sameDatePreviewFallback(d,previewJson){
  if(d?.screener)return d.screener;
  const p=previewJson?.screener;
  if(!p||String(p.trade_date||'')!==String(d?.trade_date||''))return null;

  // Display-only backfill for a historical official date whose raw screener
  // snapshot predates the official-screener storage feature. Do not reuse
  // Preview membership history because Preview and Official have separate baselines.
  const hits={};
  const counts={};
  for(const st of tStrategies){
    hits[st]=(Array.isArray(p.hits?.[st])?p.hits[st]:[]).map(x=>({...x,membership_status:'CONTINUING',rank_change:null}));
    counts[st]=hits[st].length;
  }
  return {
    ...p,
    source:'official_display_backfill',
    counts,
    hits,
    removed:Object.fromEntries(tStrategies.map(st=>[st,[]])),
    membership_counts:Object.fromEntries(tStrategies.map(st=>[st,{current:counts[st],new:0,reentered:0,continuing:counts[st],removed_visible:0}])),
    membership:{baseline:true,display_backfill:true,comparison:'same-date closed-market snapshot',removed_retention_trading_days:20,history_retention_trading_days:252}
  };
}

function summaryHtml(d,s){
  const screened=Number(d?.last_run?.stocks_screened||s?.stocks_screened||0);
  const current=Number(d?.last_run?.rows_received||0);
  const counts=s?.counts||{};
  const matches=Number(counts.trending||0)+Number(counts.gaining_momentum||0)+Number(counts.meta_leader||0);
  const active=tPositions.length;
  return [['Screened',screened],['Current bars',current],['Matches',matches],['Active trades',active]]
    .map(([label,value])=>`<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('');
}

function rawTabsHtml(s){
  const counts=s?.counts||{};
  return tStrategies.map(st=>`<button class="${st===tStrategy?'on':''}" data-today-strategy="${st}">${tesc(tlabels[st])} ${Number(counts[st]||0)}</button>`).join('');
}
function membershipTabsHtml(s){
  const m=s?.membership_counts?.[tStrategy]||{};
  const current=Number(m.current??s?.counts?.[tStrategy]??0);
  const newlyAdded=Number(m.new||0)+Number(m.reentered||0);
  const removed=Number(m.removed_visible??(s?.removed?.[tStrategy]||[]).length??0);
  return `<button class="${tMembership==='current'?'on':''}" data-today-membership="current">Current ${current}</button>
          <button class="${tMembership==='new'?'on':''}" data-today-membership="new">New ${newlyAdded}</button>
          <button class="${tMembership==='removed'?'on':''}" data-today-membership="removed">Removed ${removed}</button>`;
}
function membershipSummary(s){
  if(s?.membership?.display_backfill)return `Official date ${tesc(s.trade_date||'')} · screener display reconstructed from the same-date closed-market snapshot`;
  const m=s?.membership_counts?.[tStrategy];
  if(!m)return 'Current official screener matches';
  if(s?.membership?.baseline)return 'Membership baseline created · changes will be tracked from the next official scan';
  const migrated=s?.membership?.migrated_from_previous_snapshot?' · previous official snapshot recovered':'';
  const deferred=Number(m.deferred_unavailable||0)>0?` · ${Number(m.deferred_unavailable)} unavailable deferred`:'';
  return `${Number(m.new||0)} NEW · ${Number(m.reentered||0)} re-entered · ${Number(m.continuing||0)} continuing${deferred}${migrated}`;
}

function renderRawScreener(s){
  const source=tq('#todayRawSource'),tabs=tq('#todayRawTabs'),memberTabs=tq('#todayMembershipTabs'),summary=tq('#todayMembershipSummary'),list=tq('#todayRawList');
  if(!tabs||!memberTabs||!summary||!list)return;
  const counts=s?.counts||{};
  const total=Number(counts.trending||0)+Number(counts.gaining_momentum||0)+Number(counts.meta_leader||0);
  if(source)source.textContent=s?`${total} current matches · strength-ranked`:'No official screener snapshot yet';
  tabs.innerHTML=rawTabsHtml(s);
  tabs.querySelectorAll('[data-today-strategy]').forEach(b=>b.onclick=()=>{tStrategy=b.dataset.todayStrategy;tMembership='current';renderRawScreener(tDisplayScreener)});
  memberTabs.innerHTML=membershipTabsHtml(s);
  memberTabs.querySelectorAll('[data-today-membership]').forEach(b=>b.onclick=()=>{tMembership=b.dataset.todayMembership;renderRawScreener(tDisplayScreener)});
  if(!s){summary.textContent='Waiting for an official screener snapshot.';list.innerHTML='<div class="empty">Official screener snapshot unavailable.</div>';return;}
  const membershipCounts=s?.membership_counts?.[tStrategy]||{};
  if(tMembership==='current'){
    summary.textContent=membershipSummary(s);
  }else if(tMembership==='new'){
    summary.textContent=`${Number(membershipCounts.new||0)} NEW · ${Number(membershipCounts.reentered||0)} re-entered · strength-ranked`;
  }else{
    summary.textContent=`Removed counters are retained for ${Number(s?.membership?.removed_retention_trading_days||20)} trading days · not SELL signals`;
  }
  if(tMembership==='removed'){
    const rows=Array.isArray(s?.removed?.[tStrategy])?s.removed[tStrategy]:[];
    list.innerHTML=rows.length?rows.map(x=>removedCard(tStrategy,x)).join(''):`<div class="empty compact">No recently removed ${tesc(tlabels[tStrategy])} counters.</div>`;
    return;
  }
  const rows=preparedRows(s,tStrategy);
  const visibleRows=tMembership==='new'
    ?rows.filter(x=>x.membership_status==='NEW'||x.membership_status==='RE_ENTERED')
    :rows;
  list.innerHTML=visibleRows.length?visibleRows.map(x=>rawCard(tStrategy,x)).join(''):`<div class="empty compact">${tMembership==='new'?'No newly added or re-entered':'No'} ${tesc(tlabels[tStrategy])} ${tMembership==='new'?'counters':'matches'}.</div>`;
}

function renderConfluence(d){
  const host=tq('#confluence');
  if(!host)return;
  const rows=Array.isArray(d?.confluence)?d.confluence:[];
  host.innerHTML=rows.length?rows.map(x=>`<div class="card"><div class="top"><div><div class="ticker">🔥 ${tesc(tSym(x.symbol))}</div><div class="name">${tesc(x.name||'')}</div></div><div class="badge BUY_SIGNAL">${Number(x.confluence||0)}/3 BUY</div></div><div class="msg">${tesc(String(x.strategies||'').split(',').map(s=>tlabels[s]||s).join(' · '))}</div></div>`).join(''):'<div class="empty compact">No multi-strategy official buys on the latest official trade date.</div>';
}

function ensureTradeTabs(){
  const section=tq('#todayList')?.closest('.section');
  if(!section)return;
  const h2=section.querySelector('h2');
  if(h2)h2.textContent='Official Trade Status';
  let tabs=tq('#todayTradeTabs');
  if(!tabs){
    tabs=document.createElement('div');
    tabs.id='todayTradeTabs';
    tabs.className='membership-tabs';
    const filters=section.querySelector('.filters');
    if(filters)section.insertBefore(tabs,filters);
    else section.insertBefore(tabs,tq('#todayList'));
  }
  tabs.innerHTML=`<button class="${tTradeView==='changes'?'on':''}" data-trade-view="changes">Changes ${(tDashboard?.events||[]).length}</button>
                  <button class="${tTradeView==='continuing'?'on':''}" data-trade-view="continuing">Continuing ${continuingPositions().length}</button>`;
  tabs.querySelectorAll('[data-trade-view]').forEach(b=>b.onclick=()=>{tTradeView=b.dataset.tradeView;renderTradeStatus()});
}

function continuingPositions(){
  const changed=new Set((tDashboard?.events||[]).map(tKey));
  return tPositions.filter(x=>['BUY_PENDING','OPEN','NEAR_SELL'].includes(x.status)&&!changed.has(tKey(x)));
}

function groupedTradeHtml(rows,cardFn,emptyWord){
  return tStrategies.map(strategy=>{
    const a=rows.filter(x=>x.strategy===strategy);
    const counts={
      buy:a.filter(x=>(x.event_type==='BUY_SIGNAL'||x.status==='BUY_PENDING')).length,
      entry:a.filter(x=>(x.event_type==='ENTRY_CONFIRMED'||x.status==='OPEN')).length,
      near:a.filter(x=>(x.event_type==='NEAR_SELL'||x.status==='NEAR_SELL')).length,
      sell:a.filter(x=>x.event_type==='SELL').length
    };
    return `<section class="preview-signal-group strategy-${tesc(strategy)}">
      <div class="preview-signal-head"><div><div class="strategy-title">${tesc(tlabels[strategy]||strategy)}</div><div class="strategy-sub">${a.length} ${emptyWord}</div></div>
        <div class="strategy-mini-counts"><span class="mini-buy">B ${counts.buy}</span>${counts.entry?`<span class="mini-entry">E ${counts.entry}</span>`:''}<span class="mini-near">N ${counts.near}</span>${counts.sell?`<span class="mini-sell">S ${counts.sell}</span>`:''}</div>
      </div>
      <div class="stack">${a.length?a.map(cardFn).join(''):`<div class="empty compact">No ${tesc(tlabels[strategy])} ${emptyWord}.</div>`}</div>
    </section>`;
  }).join('');
}

function renderTradeStatus(){
  ensureTradeTabs();
  const host=tq('#todayList');
  const filters=host?.closest('.section')?.querySelector('.filters');
  if(!host)return;
  if(tTradeView==='continuing'){
    if(filters)filters.style.display='none';
    const rows=continuingPositions().sort((a,b)=>tStrategies.indexOf(a.strategy)-tStrategies.indexOf(b.strategy)||String(a.symbol||'').localeCompare(String(b.symbol||'')));
    host.innerHTML=groupedTradeHtml(rows,continuingCard,'continuing active trade'+(rows.length===1?'':'s'));
    return;
  }
  if(filters)filters.style.display='flex';
  const events=Array.isArray(tDashboard?.events)?tDashboard.events:[];
  const filtered=events.filter(x=>tEventFilter==='ALL'||x.event_type===tEventFilter);
  host.innerHTML=groupedTradeHtml(filtered,signalCard,'official change'+(filtered.length===1?'':'s'));
  bindEventFilters();
}

function bindEventFilters(){
  document.querySelectorAll('[data-event]').forEach(b=>{
    b.onclick=()=>{
      tEventFilter=b.dataset.event;
      document.querySelectorAll('[data-event]').forEach(x=>x.classList.toggle('on',x===b));
      renderTradeStatus();
    };
  });
}

function renderToday(){
  const d=tDashboard;
  if(!d)return;
  tRendering=true;
  if(tObserver)tObserver.disconnect();
  try{
    const run=d.last_run||null;
    const runState=tq('#runState'),stamp=tq('#lastUpdated'),stats=tq('#stats');
    if(runState)runState.textContent=run?`Latest official Bursa trade date · ${run.trade_date||d.trade_date||''}`:'Waiting for first verified official scan';
    if(stamp)stamp.textContent=run?`Accepted ${tTime(run.generated_at)}`:'Last update —';
    if(stats)stats.innerHTML=summaryHtml(d,tDisplayScreener);
    renderRawScreener(tDisplayScreener);
    renderConfluence(d);
    renderTradeStatus();
  }finally{
    tRendering=false;
    connectObserver();
  }
}

function connectObserver(){
  const page=document.querySelector('.page[data-page="today"]');
  if(!page)return;
  if(!tObserver)tObserver=new MutationObserver(()=>{
    if(tRendering||!tDashboard)return;
    clearTimeout(tTimer);
    tTimer=setTimeout(renderToday,30);
  });
  tObserver.observe(page,{childList:true,subtree:true,characterData:true});
}

async function loadToday(){
  try{
    const [dr,pr,vr]=await Promise.all([
      fetch('/api/dashboard',{cache:'no-store'}),
      fetch('/api/positions',{cache:'no-store'}),
      fetch('/api/preview',{cache:'no-store'})
    ]);
    const [d,p,v]=await Promise.all([dr.json(),pr.json(),vr.json()]);
    if(!dr.ok)throw new Error(d.error||dr.statusText);
    if(!pr.ok)throw new Error(p.error||pr.statusText);
    tDashboard=d;
    tPositions=Array.isArray(p.positions)?p.positions:[];
    tDisplayScreener=sameDatePreviewFallback(d,vr.ok?v:null);
    renderToday();
  }catch(e){
    const source=tq('#todayRawSource'),raw=tq('#todayRawList');
    if(source)source.textContent='Official data error';
    if(raw)raw.innerHTML=`<div class="empty">${tesc(e.message)}</div>`;
  }
}

connectObserver();
loadToday();
document.querySelector('[data-nav="today"]')?.addEventListener('click',()=>setTimeout(loadToday,80));
document.querySelector('#refresh')?.addEventListener('click',()=>setTimeout(loadToday,450));
setInterval(loadToday,60000);
