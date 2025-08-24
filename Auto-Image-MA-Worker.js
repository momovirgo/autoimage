(()=>{
// Auto-Image-MA-Worker.js — Multi-Account Worker for wplace.live

const $ = s=>document.querySelector(s);
const el=(t,c,txt)=>{const e=document.createElement(t); if(c) e.className=c; if(txt) e.textContent=txt; return e;};

const STATE={
  roomId:'team1',
  alias:'user-'+Math.random().toString(36).slice(2,6),
  selfId:'worker-'+Math.random().toString(36).slice(2,10),
  token:'',
  useToken:false,
  cooldownMs:1500, lastPlaceTs:0, paused:false,
  palette:null
};

let BC=null;

function mountUI(){
  if($('#maw_worker')) return;
  const box=el('div','maw_panel'); box.id='maw_worker';
  box.innerHTML=`
    <div class="hdr"><b>Auto-Image — Trabajador</b></div>
    <div class="row">
      <label>Room <input id="maw_room" value="team1" style="width:120px"></label>
      <label>Alias <input id="maw_alias" value="${STATE.alias}" style="width:120px"></label>
      <button id="maw_join">Unirme</button>
    </div>
    <div class="row">
      <label><input id="maw_usertk" type="checkbox"> Usar token (experimental)</label>
      <input id="maw_token" placeholder="pega tu token aquí" style="flex:1; min-width:160px">
    </div>
    <div class="row">
      <button id="maw_pause">⏸ Pausa</button>
    </div>
    <div class="row">
      <div id="maw_stats">cooldown≈—</div>
    </div>
    <div class="log" id="maw_log"></div>
    <style>
      .maw_panel{position:fixed; top:12px; left:12px; z-index:999999; width:360px; font:12px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#111; background:#fff; border:1px solid #ddd; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.15)}
      .hdr{padding:8px 12px; background:#f6f7f9; border-bottom:1px solid #eee}
      .row{display:flex; gap:8px; align-items:center; padding:8px; flex-wrap:wrap}
      .log{font-family:ui-monospace,Menlo,Consolas,monospace; margin:8px; padding:6px; background:#fafafa; border:1px solid #eee; border-radius:8px; max-height:160px; overflow:auto; white-space:pre-wrap}
      button{cursor:pointer; padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#fafafa}
      #maw_token{font-family:ui-monospace,Menlo,Consolas,monospace}
    </style>
  `;
  document.body.appendChild(box);
  $('#maw_join').onclick = joinRoom;
  $('#maw_pause').onclick= ()=>{STATE.paused=!STATE.paused; $('#maw_pause').textContent=STATE.paused?'▶ Reanudar':'⏸ Pausa'; if(!STATE.paused) pumpWorker();};
  $('#maw_usertk').onchange=()=> STATE.useToken = $('#maw_usertk').checked;
  $('#maw_token').oninput = ()=> STATE.token = $('#maw_token').value.trim();
}

function log(s){ const L=$('#maw_log'); if(L){ L.textContent+=s+'\n'; L.scrollTop=L.scrollHeight; } }
function stats(){ const S=$('#maw_stats'); if(S){ S.textContent = `alias:${STATE.alias} · cooldown≈${STATE.cooldownMs}ms`; } }

function joinRoom(){
  STATE.roomId = ($('#maw_room').value||'team1').trim();
  STATE.alias  = ($('#maw_alias').value||STATE.alias).trim();
  if(BC) BC.close();
  BC=new BroadcastChannel('ai_room_'+STATE.roomId);
  BC.onmessage = onMsg;
  log(`Trabajador "${STATE.alias}" unido a sala "${STATE.roomId}" (${STATE.selfId})`);
  send({type:'hello', from:STATE.selfId, alias:STATE.alias});
  pumpWorker();
}

function send(m){ if(!BC) return; m._ts=Date.now(); BC.postMessage(m); }
function onMsg(ev){
  const m=ev.data||{};
  if(m.type==='ack' && m.to===STATE.selfId){ log('Líder activo.'); }
  if(m.type==='grantJob' && m.to===STATE.selfId){ doJob(m.job); }
  if(m.type==='leaderStatus'){ /* opcional: mostrar progreso global */ }
}

function readCooldownMs(){
  const cand=[...document.querySelectorAll('*')].find(n=>{
    const t=n.textContent||''; return /cooldown|en\s+\d+(?:\.\d+)?s|seg/i.test(t);
  });
  if(cand){
    const m=(cand.textContent||'').match(/(\d+(?:\.\d+)?)\s*s/);
    if(m){ STATE.cooldownMs = Math.max(500, Math.round(+m[1]*1000)); }
  }
  stats();
}

async function loadPalette(){
  if(STATE.palette?.length) return;
  const nodes=[...document.querySelectorAll('button,div')];
  const samples=[];
  for(const n of nodes){
    const aria=n.getAttribute?.('aria-label')||'';
    if(/color|pintar|paint/i.test(aria) || /color/i.test(n.className||'')){
      const cs=getComputedStyle(n);
      const bg=cs.backgroundColor||cs.color;
      const mm=bg&&bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if(mm) samples.push({el:n,r:+mm[1],g:+mm[2],b:+mm[3]});
    }
  }
  const uniq=[]; const seen=new Set();
  for(const s of samples){ const k=`${s.r},${s.g},${s.b}`; if(!seen.has(k)){ seen.add(k); uniq.push(s); } }
  STATE.palette = uniq.map((s,i)=>({id:i,r:s.r,g:s.g,b:s.b,el:s.el}));
  if(!STATE.palette.length) log('Abre “Pintar” para detectar paleta.');
}

async function selectColorRGB(rgb){
  await loadPalette();
  let best=null, bestD=1e9;
  for(const c of STATE.palette||[]){
    const dr=rgb.r-c.r, dg=rgb.g-c.g, db=rgb.b-c.b; const d=dr*dr+dg*dg+db*db;
    if(d<bestD){ bestD=d; best=c; }
  }
  if(best?.el) best.el.click();
}

async function placePixelWithClick(x,y,rgb){
  await selectColorRGB(rgb);
  const canvas=document.querySelector('canvas');
  if(!canvas) throw new Error('Canvas no encontrado');
  const rect=canvas.getBoundingClientRect();
  const cx = rect.left + Math.max(0, Math.min(rect.width-1, x));
  const cy = rect.top  + Math.max(0, Math.min(rect.height-1, y));
  canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:cx,clientY:cy}));
  canvas.dispatchEvent(new MouseEvent('mouseup'  ,{bubbles:true,clientX:cx,clientY:cy}));
  readCooldownMs();
}

async function placePixelWithToken(token, x,y,rgb){
  // ✳️ RELLENA AQUÍ si tienes endpoint oficial/permitido por wplace:
  // Ejemplo (ficticio):
  // const res = await fetch("https://wplace.live/api/paint", {
  //   method:"POST",
  //   headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
  //   body: JSON.stringify({ x, y, color: rgb })
  // });
  // if(!res.ok) throw new Error("API "+res.status);
  // // Si la respuesta trae cooldown, úsalo para ajustar STATE.cooldownMs
  // const j=await res.json(); if(j.cooldown) STATE.cooldownMs = Math.max(500, j.cooldown*1000);
  // Por defecto, si no hay endpoint, lanzamos para que caiga al modo click:
  throw new Error("API token no configurada");
}

function pumpWorker(){
  if(STATE.paused) return;
  const now=Date.now();
  const wait = Math.max(0, (STATE.lastPlaceTs + STATE.cooldownMs) - now);
  if(wait>0){ setTimeout(pumpWorker, wait); return; }
  send({type:'reqJob', from:STATE.selfId, alias:STATE.alias});
}

async function doJob(job){
  try{
    if(STATE.useToken && STATE.token){
      try{
        await placePixelWithToken(STATE.token, job.x, job.y, job.color);
      }catch(e){
        log('Fallo API token ('+(e?.message||e)+') → usando clicks.');
        await placePixelWithClick(job.x, job.y, job.color);
      }
    }else{
      await placePixelWithClick(job.x, job.y, job.color);
    }
    STATE.lastPlaceTs=Date.now();
    send({type:'jobDone', id:job.id, from:STATE.selfId, alias:STATE.alias});
  }catch(err){
    send({type:'jobFailed', id:job.id, from:STATE.selfId, alias:STATE.alias, error:(err?.message||'err')});
  }finally{
    setTimeout(pumpWorker, Math.max(150, STATE.cooldownMs*0.95));
  }
}

mountUI();
stats();

})();
