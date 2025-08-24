(()=>{ // Auto-Image-MA-Leader.js — Líder multi-cuenta con estilo/UX del Auto-Image original

// ===== Config & utilidades (compatibles con tu script) =====
const CONFIG = {
  COOLDOWN_DEFAULT: 31000,
  TRANSPARENCY_THRESHOLD: 100,
  WHITE_THRESHOLD: 250,
  LOG_INTERVAL: 10,
  THEME: { primary:'#000', secondary:'#111', accent:'#222', text:'#fff', highlight:'#775ce3', success:'#0f0', error:'#f00', warning:'#ffaa00' }
};
const state = {
  roomId: 'team1',
  running:false, paused:false, minimized:false,
  imageLoaded:false, colorsChecked:false, stopFlag:false,
  startPosition:null, region:null, lastPosition:{x:0,y:0},
  totalPixels:0, paintedPixels:0,
  availableColors:[], cooldown:CONFIG.COOLDOWN_DEFAULT,
  imageData:null, queue:[], inflight:new Map(),
  strategy:'cola', // 'cola' | 'zonas'
  zones:4, alias2zone:new Map(),
};
const $ = s=>document.querySelector(s);
const clamp=v=>Math.max(0,Math.min(255,v|0));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const colorDist = (a,b)=>Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
function isWhitePixel(r,g,b){ return r>=CONFIG.WHITE_THRESHOLD && g>=CONFIG.WHITE_THRESHOLD && b>=CONFIG.WHITE_THRESHOLD; }
function extractAvailableColors(){
  const colorElements = document.querySelectorAll('[id^="color-"]');
  return Array.from(colorElements)
    .filter(el => !el.querySelector('svg'))
    .filter(el => { const id=parseInt(el.id.replace('color-','')); return id!==0 && id!==5; })
    .map(el => {
      const id=parseInt(el.id.replace('color-',''));
      const rgbStr = el.style.backgroundColor.match(/\d+/g);
      const rgb = rgbStr? rgbStr.map(Number): [0,0,0];
      return { id, rgb };
    });
}
function findClosestColor(rgb, palette){
  return palette.reduce((best,c)=>{
    const d = colorDist(rgb,c.rgb);
    if(d<best.d) return {id:c.id, d};
    return best;
  }, {id:palette[0].id, d:colorDist(rgb,palette[0].rgb)}).id;
}

// ===== WPlace API (igual a tu script) =====
const WPlace = {
  async paintPixelInRegion(regionX, regionY, pixelX, pixelY, colorId){
    try{
      const res = await fetch(`https://backend.wplace.live/s0/pixel/${regionX}/${regionY}`, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=UTF-8'},
        credentials:'include',
        body: JSON.stringify({ coords:[pixelX,pixelY], colors:[colorId] })
      });
      const data = await res.json();
      return data?.painted===1;
    }catch{ return false; }
  },
  async getCharges(){
    try{
      const res = await fetch('https://backend.wplace.live/me', {credentials:'include'});
      const data = await res.json();
      return { charges: data.charges?.count||0, cooldown: data.charges?.cooldownMs||CONFIG.COOLDOWN_DEFAULT };
    }catch{ return {charges:0, cooldown:CONFIG.COOLDOWN_DEFAULT}; }
  }
};

// ===== Broadcast =====
let BC=null;
function bcSend(m){ if(!BC) return; m._ts=Date.now(); BC.postMessage(m); }
function ensureBC(){
  if(BC) BC.close();
  BC = new BroadcastChannel('ai_room_'+state.roomId);
  BC.onmessage = onMsg;
  bcSend({type:'leader_hello'});
}
function onMsg(ev){
  const m=ev.data||{};
  if(m.type==='worker_hello'){
    // asignación de zona en modo 'zonas'
    if(state.strategy==='zonas' && m.alias){
      if(!state.alias2zone.has(m.alias)){
        const idx = state.alias2zone.size % Math.max(1,state.zones);
        state.alias2zone.set(m.alias, idx);
      }
    }
    // publica meta para que el worker conozca región y dims
    if(state.region && state.imageData){
      bcSend({type:'leader_meta', region:state.region, dims:{w:state.imageData.width, h:state.imageData.height}});
    }
  }
  if(m.type==='reqJob'){
    if(!state.running || state.paused) return;
    assignJob(m.to, m.alias);
  }
  if(m.type==='jobDone'){ state.paintedPixels++; updateProgress(); }
  if(m.type==='jobFailed'){ updateProgress(); }
}

// ===== UI (estilo de tu Auto-Image: header draggable, botones, etc.) =====
function mountUI(){
  if($('#wplace-leader')) return;

  // Fuente de iconos como en tu script
  const fa = document.createElement('link');
  fa.rel='stylesheet';
  fa.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(fa);

  const css = document.createElement('style');
  css.textContent = `
    @keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    #wplace-leader{
      position:fixed; top:24px; right:24px; width:340px; background:${CONFIG.THEME.primary};
      color:${CONFIG.THEME.text}; border:1px solid ${CONFIG.THEME.accent}; border-radius:8px;
      box-shadow:0 10px 24px rgba(0,0,0,.45); z-index:99999; animation:slideIn .3s ease-out; overflow:hidden
    }
    #wplace-leader .hdr{
      padding:12px 14px; background:${CONFIG.THEME.secondary}; color:${CONFIG.THEME.highlight};
      display:flex; align-items:center; justify-content:space-between; cursor:move; user-select:none
    }
    #wplace-leader .body{ padding:12px }
    .row{ display:flex; gap:8px; align-items:center; margin:8px 0; flex-wrap:wrap }
    .tag{ background:${CONFIG.THEME.secondary}; padding:4px 8px; border-radius:6px; font-size:12px; opacity:.9 }
    .btn{ padding:8px 10px; border:none; border-radius:6px; cursor:pointer; font-weight:600 }
    .btn:disabled{opacity:.5; cursor:not-allowed}
    .b1{ background:${CONFIG.THEME.accent}; color:#fff }
    .b2{ background:${CONFIG.THEME.success}; color:#000 }
    .b3{ background:${CONFIG.THEME.error}; color:#fff }
    .b4{ background:${CONFIG.THEME.highlight}; color:#000 }
    .box{ background:${CONFIG.THEME.secondary}; border-radius:6px; padding:10px }
    progress{ width:100% }
    .mini{font-size:12px; opacity:.85}
  `;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id='wplace-leader';
  root.innerHTML = `
    <div class="hdr">
      <div><i class="fa-solid fa-users"></i> Auto-Image — Líder</div>
      <div class="row" style="margin:0">
        <span class="tag" id="roomTag">Sala: ${state.roomId}</span>
        <button class="btn" id="minBtn" title="Minimizar"><i class="fa-solid fa-minus"></i></button>
      </div>
    </div>
    <div class="body">
      <div class="row">
        <label class="mini">Sala</label>
        <input id="roomInput" value="${state.roomId}" style="flex:1;min-width:120px;padding:6px;border-radius:6px;border:1px solid ${CONFIG.THEME.accent};background:#000;color:#fff"/>
        <button class="btn b1" id="roomApply">Cambiar</button>
      </div>

      <div class="row">
        <button class="btn b1" id="checkColors"><i class="fa-solid fa-palette"></i> Detectar Colores</button>
        <button class="btn" id="uploadBtn"><i class="fa-solid fa-upload"></i> Cargar Imagen</button>
        <button class="btn b4" id="selectPos"><i class="fa-solid fa-crosshairs"></i> Posición</button>
      </div>

      <div class="row">
        <select id="strategySel" style="flex:1;min-width:140px;padding:6px;border-radius:6px;background:#000;color:#fff;border:1px solid ${CONFIG.THEME.accent}">
          <option value="cola" selected>Reparto: Cola global</option>
          <option value="zonas">Reparto: Por zonas</option>
        </select>
        <label class="mini">Zonas</label>
        <input id="zonesInp" type="number" min="1" value="4" style="width:70px;padding:6px;border-radius:6px;border:1px solid ${CONFIG.THEME.accent};background:#000;color:#fff"/>
      </div>

      <div class="row">
        <button class="btn b2" id="buildQueue"><i class="fa-solid fa-list"></i> Generar Cola</button>
        <button class="btn b2" id="startBtn" disabled><i class="fa-solid fa-play"></i> Iniciar</button>
        <button class="btn" id="pauseBtn" disabled>⏸</button>
        <button class="btn b3" id="stopBtn" disabled>■</button>
      </div>

      <div class="box">
        <progress id="prog" value="0" max="100"></progress>
        <div class="mini" id="stats">—</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // drag (como tu Auto-Image)
  const header = root.querySelector('.hdr');
  let pos1=0,pos2=0,pos3=0,pos4=0;
  header.onmousedown = e=>{
    if(e.target.id==='minBtn') return;
    e.preventDefault(); pos3=e.clientX; pos4=e.clientY;
    document.onmouseup=()=>{document.onmouseup=null; document.onmousemove=null;};
    document.onmousemove=ev=>{
      ev.preventDefault(); pos1=pos3-ev.clientX; pos2=pos4-ev.clientY; pos3=ev.clientX; pos4=ev.clientY;
      root.style.top=(root.offsetTop-pos2)+"px"; root.style.left=(root.offsetLeft-pos1)+"px";
    };
  };

  // UI events
  $('#minBtn').onclick=()=>{
    state.minimized=!state.minimized;
    root.querySelector('.body').style.display = state.minimized?'none':'block';
    $('#minBtn').innerHTML = state.minimized? '<i class="fa-solid fa-expand"></i>':'<i class="fa-solid fa-minus"></i>';
  };
  $('#roomApply').onclick = ()=>{
    state.roomId = ($('#roomInput').value||'team1').trim();
    $('#roomTag').textContent = 'Sala: '+state.roomId;
    ensureBC();
  };
  $('#checkColors').onclick = ()=>{
    state.availableColors = extractAvailableColors();
    state.colorsChecked = state.availableColors.length>0;
    updateStats('Colores: '+state.availableColors.length);
    if(!state.colorsChecked) alert('Abrí la paleta de colores del juego y volvé a intentar.');
  };
  $('#uploadBtn').onclick = async ()=>{
    const input = document.createElement('input');
    input.type='file'; input.accept='image/png,image/jpeg';
    input.onchange = async ()=>{
      const fr=new FileReader();
      fr.onload = async ()=>{
        const img=new Image();
        img.onload=()=>{
          // volcado a canvas
          const c=document.createElement('canvas');
          c.width=img.width; c.height=img.height;
          const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
          const pixels = ctx.getImageData(0,0,c.width,c.height).data;
          // conteo válidos
          let total=0;
          for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++){
            const i=4*(y*c.width+x); const a=pixels[i+3];
            if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
            const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
            if(isWhitePixel(r,g,b)) continue; total++;
          }
          state.imageData={width:c.width,height:c.height,pixels,totalPixels:total};
          state.totalPixels=total; state.paintedPixels=0; state.imageLoaded=true;
          updateProgress();
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(input.files[0]);
    };
    input.click();
  };
  $('#selectPos').onclick = selectPositionFlow;
  $('#strategySel').onchange = ()=>state.strategy=$('#strategySel').value;
  $('#zonesInp').onchange = ()=>state.zones=Math.max(1, +$('#zonesInp').value|0);
  $('#buildQueue').onclick = buildQueue;
  $('#startBtn').onclick = startLeader;
  $('#pauseBtn').onclick = ()=>{ state.paused=!state.paused; $('#pauseBtn').textContent=state.paused?'▶':'⏸'; };
  $('#stopBtn').onclick = stopLeader;

  // autoconectar
  ensureBC();
  updateStats('Conectado a sala "'+state.roomId+'".');
}

function updateProgress(){
  const p = (state.totalPixels? Math.round(100*state.paintedPixels/state.totalPixels):0);
  $('#prog').value=p;
  $('#stats').textContent = `Progreso ${p}% · pintados ${state.paintedPixels}/${state.totalPixels} · en cola ${state.queue.length}`;
}
function updateStats(msg){ $('#stats').textContent = msg; }

// ===== Selección de región/posición (igual mecanismo que tu script) =====
async function selectPositionFlow(){
  const originalFetch = window.fetch;
  updateStats('Pintá un pixel donde deba comenzar el arte…');
  window.fetch = async (url, options)=>{
    if(typeof url==='string' && url.includes('https://backend.wplace.live/s0/pixel/') && options?.method?.toUpperCase()==='POST'){
      try{
        const res = await originalFetch(url, options);
        const clone = res.clone(); const data = await clone.json();
        if(data?.painted===1){
          const m = url.match(/\/pixel\/(\d+)\/(\d+)/);
          if(m){ state.region={x:parseInt(m[1]),y:parseInt(m[2])}; }
          const body = JSON.parse(options.body||'{}');
          if(body?.coords){ state.startPosition={x:body.coords[0], y:body.coords[1]}; state.lastPosition={x:0,y:0}; }
          window.fetch=originalFetch;
          if(state.region && state.startPosition) {
            updateStats(`Región ${state.region.x},${state.region.y} · Inicio ${state.startPosition.x},${state.startPosition.y}`);
            // anuncia meta a los workers
            bcSend({type:'leader_meta', region:state.region, dims: state.imageData? {w:state.imageData.width,h:state.imageData.height}:null});
          }
        }
        return res;
      }catch{ return originalFetch(url,options); }
    }
    return originalFetch(url,options);
  };
  // timeout 2 min
  setTimeout(()=>{ window.fetch=originalFetch; }, 120000);
}

// ===== Construir cola =====
function buildQueue(){
  if(!state.colorsChecked || !state.imageLoaded || !state.startPosition || !state.region){
    alert('Falta detectar colores, cargar imagen y seleccionar posición.');
    return;
  }
  const {width,height,pixels} = state.imageData;
  const startX = state.startPosition.x, startY = state.startPosition.y;
  const pal = state.availableColors;

  const q=[];
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const i=4*(y*width+x);
      const a=pixels[i+3]; if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
      const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      if(isWhitePixel(r,g,b)) continue;
      const colorId = findClosestColor([r,g,b], pal);
      const absX = startX + x, absY = startY + y;
      const zone = Math.floor((x / width) * Math.max(1,state.zones));
      q.push({x:absX, y:absY, colorId, zone});
    }
  }
  // orden serpentina por filas para mejorar resultado visual
  q.sort((A,B)=> (A.y-B.y) || ((A.y&1)? (B.x-A.x):(A.x-B.x)));
  state.queue=q;
  state.paintedPixels=0;
  updateStats(`Cola creada: ${q.length} píxeles`);
  updateProgress();
  $('#startBtn').disabled=false; $('#pauseBtn').disabled=false; $('#stopBtn').disabled=false;
}

// ===== Asignación de trabajos =====
function startLeader(){
  if(!state.queue.length){ alert('Generá la cola primero.'); return; }
  state.running=true; state.paused=false;
  updateStats('Líder iniciado. Trabajadores pueden pedir trabajo.');
  // broadcast meta por si alguien llega tarde
  bcSend({type:'leader_meta', region:state.region, dims:{w:state.imageData.width,h:state.imageData.height}});
}
function stopLeader(){ state.running=false; state.paused=false; updateStats('Líder detenido.'); }

function assignJob(workerId, alias){
  let job=null;
  if(state.strategy==='zonas' && alias){
    const zone = state.alias2zone.get(alias);
    if(zone!=null){
      const idx = state.queue.findIndex(p=>p.zone===zone);
      if(idx>=0){ job = state.queue.splice(idx,1)[0]; }
    }
  }
  if(!job){ job = state.queue.shift(); }
  if(!job){ bcSend({type:'noJob', to:workerId}); return; }
  const jobId = 'j-'+Math.random().toString(36).slice(2,10);
  state.inflight.set(jobId,job);
  bcSend({type:'grantJob', to:workerId, job:{id:jobId, x:job.x, y:job.y, colorId:job.colorId, region:state.region}});
  updateProgress();
}

// ===== Init =====
mountUI();

})();
