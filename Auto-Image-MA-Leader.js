(()=>{
// Auto-Image-MA-Leader.js — Multi-Account Leader for wplace.live
// Basado en la idea de bookmarklet del repo público; UI mínima + BroadcastChannel.

const $ = s=>document.querySelector(s);
const el=(t,c,txt)=>{const e=document.createElement(t); if(c) e.className=c; if(txt) e.textContent=txt; return e;};
const randId=()=>Math.random().toString(36).slice(2,10);
const clamp=v=>Math.max(0,Math.min(255,v|0));

const STATE={
  roomId:'team1',
  selfId:'leader-'+randId(),
  palette:null,
  queue:[],
  inflight:new Map(),
  placed:0, failed:0,
  running:false, paused:false,
  cfg:{offsetX:0,offsetY:0,scale:1,tolerance:24,dithering:true,jitter:0},
  startedAt:null
};

let BC=null, LOADED_IMG=null;

function mountUI(){
  if($('#mai_leader')) return;
  const box=el('div','mai_panel'); box.id='mai_leader';
  box.innerHTML=`
    <div class="hdr"><b>Auto-Image — Líder</b></div>
    <div class="row">
      <label>Room <input id="mai_room" value="team1" style="width:120px"></label>
      <button id="mai_join">Unirme</button>
    </div>
    <div class="row">
      <input type="file" id="mai_file" accept="image/*">
    </div>
    <div class="row">
      <label>OffX <input id="mai_offx" type="number" value="0" style="width:70px"></label>
      <label>OffY <input id="mai_offy" type="number" value="0" style="width:70px"></label>
      <label>Escala <input id="mai_scale" type="number" min="1" value="1" style="width:70px"></label>
    </div>
    <div class="row">
      <label>Tolerancia <input id="mai_tol" type="number" min="0" max="128" value="24" style="width:80px"></label>
      <label><input id="mai_dith" type="checkbox" checked> Dithering</label>
      <label>Jitter <input id="mai_jit" type="number" min="0" max="1" step="0.1" value="0" style="width:70px"></label>
    </div>
    <div class="row">
      <button id="mai_build">Generar Cola</button>
      <button id="mai_start" disabled>▶ Iniciar</button>
      <button id="mai_pause" disabled>⏸</button>
      <button id="mai_stop" disabled>■</button>
    </div>
    <div class="row">
      <progress id="mai_prog" value="0" max="100" style="width:100%"></progress>
      <div id="mai_stats"></div>
    </div>
    <div class="log" id="mai_log"></div>
    <style>
      .mai_panel{position:fixed; top:12px; right:12px; z-index:999999; width:360px; font:12px system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#111; background:#fff; border:1px solid #ddd; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.15)}
      .hdr{padding:8px 12px; background:#f6f7f9; border-bottom:1px solid #eee}
      .row{display:flex; gap:8px; align-items:center; padding:8px; flex-wrap:wrap}
      .log{font-family:ui-monospace,Menlo,Consolas,monospace; margin:8px; padding:6px; background:#fafafa; border:1px solid #eee; border-radius:8px; max-height:160px; overflow:auto; white-space:pre-wrap}
      button{cursor:pointer; padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#fafafa}
    </style>
  `;
  document.body.appendChild(box);
  $('#mai_join').onclick=joinRoom;
  $('#mai_file').onchange=onFile;
  $('#mai_build').onclick=buildQueue;
  $('#mai_start').onclick=startLeader;
  $('#mai_pause').onclick=()=>{STATE.paused=!STATE.paused; $('#mai_pause').textContent=STATE.paused?'▶':'⏸';};
  $('#mai_stop').onclick=stopLeader;
}

function log(s){ const L=$('#mai_log'); if(L){ L.textContent+=s+'\n'; L.scrollTop=L.scrollHeight; } }
function setProgress(done,total){
  const pct = total? Math.round(100*done/total):0;
  const p=$('#mai_prog'); if(p) p.value=pct;
  const s=$('#mai_stats');
  if(s){ s.innerHTML = `Progreso: ${done}/${total} · fallidos:${STATE.failed}`; }
}

function joinRoom(){
  const rid=($('#mai_room').value||'team1').trim();
  STATE.roomId=rid;
  if(BC) BC.close();
  BC=new BroadcastChannel('ai_room_'+rid);
  BC.onmessage = onMsg;
  log(`Líder unido a sala "${rid}" (${STATE.selfId})`);
  send({type:'announce', from:STATE.selfId});
}

function send(msg){ if(!BC) return; msg._ts=Date.now(); BC.postMessage(msg); }
function onMsg(ev){
  const m=ev.data||{};
  if(m.type==='hello') send({type:'ack', to:m.from});
  if(m.type==='reqJob' && STATE.running && !STATE.paused) assignJob(m.from);
  if(m.type==='jobDone'){ STATE.placed++; setProgress(STATE.placed, STATE.placed + STATE.queue.length); }
  if(m.type==='jobFailed'){ STATE.failed++; setProgress(STATE.placed, STATE.placed + STATE.queue.length); }
}

function onFile(ev){
  const f=ev.target.files?.[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=()=>{ const img=new Image(); img.onload=()=>{ LOADED_IMG=img; log(`Imagen: ${img.width}x${img.height}`); }; img.src=fr.result; };
  fr.readAsDataURL(f);
}

async function loadPalette(){
  const nodes=[...document.querySelectorAll('button,div')];
  const samples=[];
  for(const n of nodes){
    const aria=n.getAttribute?.('aria-label')||'';
    if(/color|pintar|paint/i.test(aria) || /color/i.test(n.className||'')){
      const cs=getComputedStyle(n);
      const bg=cs.backgroundColor||cs.color;
      const m=bg&&bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if(m) samples.push({el:n,r:+m[1],g:+m[2],b:+m[3]});
    }
  }
  const uniq=[]; const seen=new Set();
  for(const s of samples){ const k=`${s.r},${s.g},${s.b}`; if(!seen.has(k)){ seen.add(k); uniq.push(s); } }
  STATE.palette = uniq.map((s,i)=>({id:i,r:s.r,g:s.g,b:s.b,el:s.el}));
  if(!STATE.palette.length) log('Abre la sección de “Pintar” para detectar la paleta.');
  else log(`Paleta: ${STATE.palette.length} colores.`);
}
function nearestColor(r,g,b,tol){
  if(!STATE.palette?.length) return null;
  let best=null, bestD=1e9;
  for(const c of STATE.palette){ const dr=r-c.r,dg=g-c.g,db=b-c.b; const d=dr*dr+dg*dg+db*db; if(d<bestD){bestD=d;best=c;} }
  return (Math.sqrt(bestD)>tol)? null : best;
}
function floydSteinberg(data,w,h,tol){
  const out=new Uint8ClampedArray(data), idx=(x,y)=>4*(y*w+x);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=idx(x,y), a=out[i+3]; if(a<10) continue;
    const nrgb=nearestColor(out[i],out[i+1],out[i+2],tol);
    const nr = nrgb?nrgb.r:out[i], ng=nrgb?nrgb.g:out[i+1], nb=nrgb?nrgb.b:out[i+2];
    const er=out[i]-nr, eg=out[i+1]-ng, eb=out[i+2]-nb;
    out[i]=nr; out[i+1]=ng; out[i+2]=nb;
    const add=(x2,y2,f)=>{ if(x2<0||x2>=w||y2<0||y2>=h) return; const j=idx(x2,y2); out[j]+=er*f; out[j+1]+=eg*f; out[j+2]+=eb*f; out[j]=clamp(out[j]); out[j+1]=clamp(out[j+1]); out[j+2]=clamp(out[j+2]);};
    add(x+1,y  ,7/16); add(x-1,y+1,3/16); add(x,y+1,5/16); add(x+1,y+1,1/16);
  }
  return out;
}

async function buildQueue(){
  if(!LOADED_IMG){ log('Carga una imagen.'); return; }
  await loadPalette();
  const offx=STATE.cfg.offsetX= +$('#mai_offx').value|0;
  const offy=STATE.cfg.offsetY= +$('#mai_offy').value|0;
  const scale=STATE.cfg.scale  = Math.max(1, +$('#mai_scale').value|0);
  const tol  =STATE.cfg.tolerance = Math.min(128, Math.max(0, +$('#mai_tol').value|0));
  STATE.cfg.dithering = $('#mai_dith').checked;
  STATE.cfg.jitter    = Math.max(0, Math.min(1, +$('#mai_jit').value));

  const c=document.createElement('canvas');
  c.width=(LOADED_IMG.width*scale)|0; c.height=(LOADED_IMG.height*scale)|0;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=(scale>1);
  ctx.drawImage(LOADED_IMG,0,0,c.width,c.height);
  const w=c.width, h=c.height, img=ctx.getImageData(0,0,w,h);
  let data=img.data;
  if(STATE.cfg.dithering) data=floydSteinberg(data,w,h,tol);

  const q=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=4*(y*w+x), a=data[i+3]; if(a<10) continue;
    const r=data[i],g=data[i+1],b=data[i+2];
    const nc=nearestColor(r,g,b,tol); if(!nc) continue;
    const jx=STATE.cfg.jitter?(Math.random()*STATE.cfg.jitter*2-STATE.cfg.jitter):0;
    const jy=STATE.cfg.jitter?(Math.random()*STATE.cfg.jitter*2-STATE.cfg.jitter):0;
    q.push({x:(x+offx+jx)|0, y:(y+offy+jy)|0, color:{r:nc.r,g:nc.g,b:nc.b}});
  }
  // orden serpentina por filas
  q.sort((A,B)=> (A.y-B.y) || ((A.y&1)?(B.x-A.x):(A.x-B.x)));
  STATE.queue=q; STATE.placed=0; STATE.failed=0; STATE.startedAt=Date.now();
  setProgress(0, q.length);
  log(`Cola creada: ${q.length} píxeles`);
  $('#mai_start').disabled=false; $('#mai_pause').disabled=false; $('#mai_stop').disabled=false;
}

function startLeader(){
  STATE.running=true; STATE.paused=false;
  log('Líder iniciado. Trabajadores pueden pedir trabajo.');
  send({type:'leaderStatus', done:STATE.placed, total:STATE.placed+STATE.queue.length});
}
function stopLeader(){
  STATE.running=false; STATE.paused=false;
  log('Líder detenido.');
}

function assignJob(workerId){
  if(!STATE.queue.length){ send({type:'noJob', to:workerId}); return; }
  const job=STATE.queue.shift();
  const jobId='j-'+randId();
  STATE.inflight.set(jobId, job);
  send({type:'grantJob', to:workerId, job:{id:jobId, x:job.x, y:job.y, color:job.color}});
  setProgress(STATE.placed, STATE.placed + STATE.queue.length);
}

mountUI();

})();
