(()=>{ // Auto-Image-MA-Worker.js — Trabajador multi-cuenta con API wplace y UI draggable

const CONFIG = { COOLDOWN_DEFAULT:31000, THEME:{ primary:'#000', secondary:'#111', accent:'#222', text:'#fff', highlight:'#775ce3' } };
const state = { roomId:'team1', alias:'user-'+Math.random().toString(36).slice(2,6), charges:0, cooldown:CONFIG.COOLDOWN_DEFAULT, paused:false, region:null };
const $ = s=>document.querySelector(s);

const WPlace = {
  async getCharges(){ try{ const r=await fetch('https://backend.wplace.live/me',{credentials:'include'}); const j=await r.json(); return {charges:j.charges?.count||0, cooldown:j.charges?.cooldownMs||CONFIG.COOLDOWN_DEFAULT}; }catch{ return {charges:0,cooldown:CONFIG.COOLDOWN_DEFAULT}; } },
  async paint(region,x,y,colorId){
    try{
      const r = await fetch(`https://backend.wplace.live/s0/pixel/${region.x}/${region.y}`,{
        method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, credentials:'include',
        body: JSON.stringify({coords:[x,y], colors:[colorId]})
      });
      const j = await r.json(); return j?.painted===1;
    }catch{ return false; }
  }
};

// ===== Broadcast =====
let BC=null;
function bcSend(m){ if(!BC) return; m._ts=Date.now(); BC.postMessage(m); }
function ensureBC(){
  if(BC) BC.close();
  BC = new BroadcastChannel('ai_room_'+state.roomId);
  BC.onmessage = onMsg;
  bcSend({type:'worker_hello', alias:state.alias});
}
function onMsg(ev){
  const m=ev.data||{};
  if(m.type==='leader_meta'){ if(m.region) state.region=m.region; }
  if(m.type==='grantJob' && m.to===selfId){
    if(!state.region) state.region = m.job.region; // por si no llegó meta aún
    doJob(m.job);
  }
}
const selfId = 'w-'+Math.random().toString(36).slice(2,9);

// ===== UI =====
function mountUI(){
  if($('#wplace-worker')) return;

  const fa=document.createElement('link'); fa.rel='stylesheet';
  fa.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'; document.head.appendChild(fa);
  const css=document.createElement('style'); css.textContent=`
    #wplace-worker{position:fixed;top:24px;left:24px;width:320px;background:${CONFIG.THEME.primary};color:${CONFIG.THEME.text};border:1px solid ${CONFIG.THEME.accent};border-radius:8px;box-shadow:0 10px 24px rgba(0,0,0,.45);z-index:99999;overflow:hidden}
    #wplace-worker .hdr{padding:12px 14px;background:${CONFIG.THEME.secondary};color:${CONFIG.THEME.highlight};display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none}
    #wplace-worker .body{padding:12px}
    .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
    .btn{padding:8px 10px;border:none;border-radius:6px;cursor:pointer;background:${CONFIG.THEME.accent};color:#fff}
    .tag{background:${CONFIG.THEME.secondary};padding:4px 8px;border-radius:6px;font-size:12px}
    .mini{font-size:12px;opacity:.85}
  `; document.head.appendChild(css);

  const root=document.createElement('div');
  root.id='wplace-worker';
  root.innerHTML=`
    <div class="hdr"><div><i class="fa-solid fa-user"></i> Auto-Image — Trabajador</div><div><span class="tag" id="roomTag">Sala: ${state.roomId}</span></div></div>
    <div class="body">
      <div class="row">
        <label class="mini">Alias</label>
        <input id="aliasInp" value="${state.alias}" style="flex:1;min-width:120px;padding:6px;border-radius:6px;border:1px solid ${CONFIG.THEME.accent};background:#000;color:#fff"/>
      </div>
      <div class="row">
        <label class="mini">Sala</label>
        <input id="roomInp" value="${state.roomId}" style="flex:1;min-width:120px;padding:6px;border-radius:6px;border:1px solid ${CONFIG.THEME.accent};background:#000;color:#fff"/>
        <button class="btn" id="applyBtn">Conectar</button>
      </div>
      <div class="row mini" id="stats">charges: — · cooldown: —</div>
      <div class="row">
        <button class="btn" id="pauseBtn">⏸ Pausa</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // drag
  const header=root.querySelector('.hdr'); let p1=0,p2=0,p3=0,p4=0;
  header.onmousedown = e=>{ e.preventDefault(); p3=e.clientX;p4=e.clientY;
    document.onmouseup=()=>{document.onmouseup=null;document.onmousemove=null;};
    document.onmousemove=ev=>{ev.preventDefault(); p1=p3-ev.clientX; p2=p4-ev.clientY; p3=ev.clientX; p4=ev.clientY;
      root.style.top=(root.offsetTop-p2)+"px"; root.style.left=(root.offsetLeft-p1)+"px";
    };
  };

  // events
  $('#applyBtn').onclick=()=>{
    state.alias = ($('#aliasInp').value||state.alias).trim();
    state.roomId = ($('#roomInp').value||state.roomId).trim();
    $('#roomTag').textContent = 'Sala: '+state.roomId;
    ensureBC();
  };
  $('#pauseBtn').onclick=()=>{ state.paused=!state.paused; $('#pauseBtn').textContent = state.paused?'▶ Reanudar':'⏸ Pausa'; if(!state.paused) pump(); };

  // auto connect
  ensureBC(); updateStats();
  pump();
}
function updateStats(){ $('#stats').textContent = `charges: ${state.charges} · cooldown: ${state.cooldown}ms`; }

// ===== Loop del trabajador =====
async function pump(){
  if(state.paused) return;
  // actualizar charges antes de pedir trabajo
  const ch = await WPlace.getCharges();
  state.charges = Math.floor(ch.charges); state.cooldown = ch.cooldown; updateStats();

  if(state.charges<1){
    // esperar cooldown y volver
    await sleep(state.cooldown);
    return pump();
  }
  bcSend({type:'reqJob', to:selfId, alias:state.alias});
}

async function doJob(job){
  try{
    if(!state.region) state.region = job.region;
    // pintar
    const ok = await WPlace.paint(state.region, job.x, job.y, job.colorId);
    if(ok){ state.charges = Math.max(0,state.charges-1); bcSend({type:'jobDone', id:job.id, from:selfId}); }
    else{ bcSend({type:'jobFailed', id:job.id, from:selfId}); }
  }catch{ bcSend({type:'jobFailed', id:job.id, from:selfId}); }
  finally{
    setTimeout(pump, Math.max(200, state.cooldown*0.95));
  }
}

// ===== Init =====
mountUI();

})();
