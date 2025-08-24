/* AutoImage-UI-Sharded.js — 24/08/2025
 * Pinta usando la UI real de WPlace (simulación de clicks).
 * - Paleta por getComputedStyle (incluye blanco si existe)
 * - Calibración 2-clicks para mapear píxel->pantalla
 * - Sharding por módulo (multi ventanas/cuentas sin pisarse)
 * - Respeta cargas/cooldown consultando /me
 */

(async () => {
  const THEME = {
    bg: '#0e0f13', panel: '#151725', ink: '#e6e6f0', border: '#242637',
    accent: '#7c5cff', ok: '#00d98b', warn: '#ffae42', err: '#ff5a5a'
  };
  const CONFIG = {
    TRANSPARENCY_THRESHOLD: 1,             // pinta todo salvo alpha ~0
    CHECK_INTERVAL: 25,                    // log de progreso
    COOLDOWN_FALLBACK: 31000,              // si /me falla
    TEAM_CHANNEL_PREFIX: 'wplace-ui-team-'
  };

  const S = {
    palette: [],            // [{id,rgb,el}]
    havePalette: false,
    // imagen (buffer RGBA)
    img: null,              // {w,h,pixels:Uint8ClampedArray}
    total: 0,               // píxeles a pintar después de filtros
    painted: 0,
    // calibración canvas
    anchorScreen: null,     // {x,y} click 1 (pantalla)
    cellDX: null,           // tamaño de celda en X (px pantalla)
    cellDY: null,           // asumimos cuadrado; usamos DX
    clickTarget: null,      // elemento del canvas que recibió el click
    // posicionamiento en tablero
    boardAx: 0,             // coord tableras (x,y) del click de ancla
    boardAy: 0,
    // sharding
    totalWorkers: 1,
    workerSlot: 1,
    teamId: null,
    role: 'member',         // 'leader' | 'member'
    channel: null,
    shard: null,            // {x0,y0,w,h}
    // ejecución
    running: false,
    stop: false,
    charges: 0,
    cooldown: CONFIG.COOLDOWN_FALLBACK,
  };

  /* ============== Utilidades UI ============== */
  function makeUI() {
    const box = document.createElement('div');
    box.style.cssText = `
      position:fixed; z-index:999999; top:20px; right:20px; width:360px;
      background:${THEME.panel}; color:${THEME.ink}; border:1px solid ${THEME.border};
      border-radius:10px; font:13px/1.35 ui-sans-serif,system-ui; box-shadow:0 6px 18px rgba(0,0,0,.4); overflow:hidden;
    `;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:${THEME.bg};padding:10px 12px">
        <b>WPlace AutoImage (UI • Sharded)</b>
        <button id="ui-min" style="border:none;background:none;color:${THEME.ink};cursor:pointer">—</button>
      </div>
      <div id="ui-body" style="padding:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <input id="team-id" placeholder="Team ID" style="grid-column:span 2;padding:8px;border:1px solid ${THEME.border};background:#0b0c10;color:${THEME.ink};border-radius:8px">
          <button id="btn-join" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:#1a1c2b;color:${THEME.ink}">Unirse</button>
          <button id="btn-lead" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:${THEME.accent};color:#fff">Soy líder</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <button id="btn-palette" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:#1a1c2b;color:${THEME.ink}">Detectar paleta</button>
          <button id="btn-img" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:#1a1c2b;color:${THEME.ink}">Subir imagen</button>
          <label style="display:flex;gap:6px;align-items:center;grid-column:span 2">
            W:<input id="in-w" type="number" min="1" value="64" style="width:80px;padding:6px;border-radius:8px;border:1px solid ${THEME.border};background:#0b0c10;color:${THEME.ink}">
            H:<input id="in-h" type="number" min="1" value="64" style="width:80px;padding:6px;border:1px solid ${THEME.border};background:#0b0c10;color:${THEME.ink};border-radius:8px">
            <button id="btn-resize" style="margin-left:auto;padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:#1a1c2b;color:${THEME.ink}">Redimensionar</button>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <label style="display:flex;gap:6px;align-items:center">
            Total cuentas <input id="in-total" type="number" min="1" value="1" style="width:70px;padding:6px;border-radius:8px;border:1px solid ${THEME.border};background:#0b0c10;color:${THEME.ink}">
          </label>
          <label style="display:flex;gap:6px;align-items:center">
            Tu nº <input id="in-slot" type="number" min="1" value="1" style="width:70px;padding:6px;border-radius:8px;border:1px solid ${THEME.border};background:#0b0c10;color:${THEME.ink}">
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <button id="btn-cal" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:${THEME.warn};color:#111">Calibrar (2 clicks)</button>
          <button id="btn-start" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:${THEME.ok};color:#111" disabled>Iniciar</button>
          <button id="btn-stop" style="padding:8px;border-radius:8px;border:1px solid ${THEME.border};background:${THEME.err};color:#111" disabled>Parar</button>
        </div>

        <div id="status" style="font-size:12px;opacity:.95"></div>
        <div style="height:8px;background:#1d2030;border-radius:6px;overflow:hidden;margin-top:8px">
          <div id="bar" style="height:100%;width:0%;background:${THEME.accent}"></div>
        </div>
      </div>
    `;
    document.body.appendChild(box);

    const body = box.querySelector('#ui-body');
    box.querySelector('#ui-min').onclick = () => {
      body.style.display = body.style.display === 'none' ? 'block':'none';
    };

    return {
      elTeam: box.querySelector('#team-id'),
      btnJoin: box.querySelector('#btn-join'),
      btnLead: box.querySelector('#btn-lead'),
      btnPalette: box.querySelector('#btn-palette'),
      btnImg: box.querySelector('#btn-img'),
      inW: box.querySelector('#in-w'),
      inH: box.querySelector('#in-h'),
      btnResize: box.querySelector('#btn-resize'),
      inTotal: box.querySelector('#in-total'),
      inSlot: box.querySelector('#in-slot'),
      btnCal: box.querySelector('#btn-cal'),
      btnStart: box.querySelector('#btn-start'),
      btnStop: box.querySelector('#btn-stop'),
      status: box.querySelector('#status'),
      bar: box.querySelector('#bar')
    };
  }

  /* ============== Paleta (UI real) ============== */
  function readPalette() {
    const els = Array.from(document.querySelectorAll('[id^="color-"]'));
    const out = [];
    for (const el of els) {
      const m = el.id.match(/color-(\d+)/);
      if (!m) continue;
      const id = parseInt(m[1],10);
      // no excluimos blanco; sí evita id=0 si existe (borrador)
      if (id === 0) continue;
      const rgbStr = getComputedStyle(el).backgroundColor || '';
      const mm = rgbStr.match(/\d+/g);
      if (!mm) continue;
      const rgb = mm.slice(0,3).map(Number);
      out.push({ id, rgb, el });
    }
    if (!out.length) return out;
    // ordenar por id por estabilidad
    out.sort((a,b)=>a.id-b.id);
    return out;
  }
  const dist = (a,b)=> Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
  function nearestColorId(rgb){
    if (!S.palette.length) return 1;
    let best=S.palette[0], bd=1e9;
    for (const c of S.palette) {
      const d = dist(rgb,c.rgb);
      if (d<bd){ bd=d; best=c; }
    }
    return best.id;
  }
  async function selectPaletteColor(id){
    const item = S.palette.find(c=>c.id===id);
    if (!item) return;
    item.el.click();
    await waitForPaintUIIdle(40);
  }

  /* ============== Imagen ============== */
  async function pickImage() {
    return new Promise((resolve,reject)=>{
      const i=document.createElement('input');
      i.type='file'; i.accept='image/png,image/jpeg';
      i.onchange=()=>{
        const f=i.files?.[0]; if(!f) return reject();
        const fr=new FileReader();
        fr.onload=()=> resolve(fr.result);
        fr.onerror=reject;
        fr.readAsDataURL(f);
      };
      i.click();
    });
  }
  async function loadImageToPixels(dataUrl){
    const img = new Image();
    img.crossOrigin='anonymous';
    await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(img,0,0);
    const { data } = ctx.getImageData(0,0,c.width,c.height);
    return { w:c.width, h:c.height, pixels:data };
  }
  function scaleNearest(src, W,H){
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    const tmp=document.createElement('canvas'); tmp.width=src.w; tmp.height=src.h;
    const tctx=tmp.getContext('2d',{willReadFrequently:true});
    tctx.imageSmoothingEnabled=false;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(src.pixels), src.w, src.h),0,0);
    ctx.drawImage(tmp,0,0,src.w,src.h,0,0,W,H);
    const { data } = ctx.getImageData(0,0,W,H);
    return { w:W, h:H, pixels:data };
  }
  function countDrawablePixels(buf){
    const {w,h,pixels}=buf;
    let n=0;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=4*(y*w+x);
      if (pixels[i+3] >= CONFIG.TRANSPARENCY_THRESHOLD) n++;
    }
    return n;
  }

  /* ============== Calibración (2 clicks) ============== */
  function waitPointerOnce() {
    return new Promise(resolve=>{
      const handler = (ev) => {
        document.removeEventListener('pointerdown', handler, true);
        resolve(ev);
      };
      document.addEventListener('pointerdown', handler, true);
    });
  }

  /* ============== Simular click real ============== */
  function dispatchClick(el, x, y) {
    const opts = { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup',   { ...opts, pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mouseup',   opts));
    el.dispatchEvent(new MouseEvent('click',     opts));
  }
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  async function waitForPaintUIIdle(ms=50){ await sleep(ms); }

  /* ============== Cargas/Cooldown ============== */
  async function getCharges(){
    try{
      const res = await fetch('https://backend.wplace.live/me', { credentials:'include' });
      const data = await res.json();
      S.charges = Math.floor(data?.charges?.count ?? 0);
      S.cooldown = data?.charges?.cooldownMs ?? CONFIG.COOLDOWN_FALLBACK;
    }catch{
      S.charges=0; S.cooldown=CONFIG.COOLDOWN_FALLBACK;
    }
  }

  /* ============== Team (shards) ============== */
  function onTeamMsg(ev){
    const m = ev.data; if(!m||!m.t) return;
    if (m.t==='img-meta' && S.role!=='leader'){
      // nada que hacer, Shard llegará después
    } else if (m.t==='giveShard' && S.role!=='leader'){
      S.shard = m.shard;
    }
  }
  if (!window.__UI_SHARDER__) window.__UI_SHARDER__ = { y:0 };
  function nextStripe(totalW,totalH){
    const stripeH = Math.max(1, Math.floor(totalH/4)); // 4 franjas por defecto
    const y0 = window.__UI_SHARDER__.y;
    if (y0 >= totalH) return null;
    const h = Math.min(stripeH, totalH - y0);
    window.__UI_SHARDER__.y += h;
    return { x0:0, y0, w: totalW, h };
  }

  /* ============== Pintura (loop UI) ============== */
  async function paintLoop(ui){
    const bar = (p)=> ui.bar.style.width = `${Math.max(0,Math.min(100,p))}%`;
    const log = (s)=> ui.status.innerHTML = s;

    // repartir shard
    let x0=0,y0=0,W=S.img.w,H=S.img.h;
    if (S.role==='leader' && S.channel){
      S.channel.onmessage = (ev)=>{
        const m=ev.data; if(m?.t==='needShard'){
          const sh = nextStripe(S.img.w, S.img.h);
          if (sh) S.channel.postMessage({ t:'giveShard', shard: sh });
        }
      };
      // líder pinta su franja
      const mine = nextStripe(S.img.w, S.img.h) || {x0:0,y0:0,w:S.img.w,h:S.img.h};
      x0=mine.x0; y0=mine.y0; W=mine.w; H=mine.h;
      // anunciar meta
      S.channel.postMessage({t:'img-meta', w:S.img.w, h:S.img.h});
    } else if (S.shard){
      x0=S.shard.x0; y0=S.shard.y0; W=S.shard.w; H=S.shard.h;
    }

    log(`🎯 Shard: x0=${x0}, y0=${y0}, w=${W}, h=${H}. Comenzando…`);

    const rect = S.clickTarget.getBoundingClientRect();
    const cell = S.cellDX; // asumimos cuadrado
    const baseX = S.anchorScreen.x - (x0 * cell);
    const baseY = S.anchorScreen.y - (y0 * cell);

    // recorrido fila a fila
    let validIdx = 0;
    for (let y=0; y<H; y++){
      for (let x=0; x<W; x++){
        if (S.stop) { log(`⏸️ Pausa en (${x0+x},${y0+y})`); return; }

        const i = 4 * ((y0+y)*S.img.w + (x0+x));
        const a = S.img.pixels[i+3];
        if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue;
        validIdx++;

        // sharding por módulo (entre cuentas/ventanas)
        if ( ((validIdx-1) % S.totalWorkers) !== (S.workerSlot-1) ) continue;

        const r=S.img.pixels[i], g=S.img.pixels[i+1], b=S.img.pixels[i+2];
        const colId = nearestColorId([r,g,b]);
        await selectPaletteColor(colId);

        // esperá cargas si hace falta
        if (S.charges <= 0) {
          await getCharges();
          if (S.charges <= 0) {
            log(`⌛ Sin cargas. Esperando ${Math.round(S.cooldown/1000)}s…`);
            await sleep(S.cooldown);
            await getCharges();
          }
        }

        // click real
        const cx = baseX + x*cell;
        const cy = baseY + y*cell;
        // asegúrate que el click cae dentro del canvas
        const sx = Math.round(cx), sy = Math.round(cy);
        if (sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom) {
          // si está fuera, probablemente moviste el zoom/pan; aborta
          log(`❌ El canvas se movió/zoom. Recalibra.`);
          S.stop = true; return;
        }
        dispatchClick(S.clickTarget, sx, sy);
        S.painted++; S.charges--;

        if (S.painted % CONFIG.CHECK_INTERVAL === 0){
          const p = Math.round(100 * S.painted / S.total);
          bar(p);
          log(`🧱 Progreso ${S.painted}/${S.total} (${p}%)`);
          await waitForPaintUIIdle(40);
        }
      }
    }
    bar(100); log(`✅ Shard completo. Pintados: ${S.painted}.`);
  }

  /* ============== Montaje UI y handlers ============== */
  const ui = makeUI();
  const say = (m)=> ui.status.innerHTML = m;

  ui.btnJoin.onclick = () => {
    const id = (ui.elTeam.value||'').trim();
    if (!id) return alert('Pon un Team ID');
    S.teamId = id;
    S.channel = new BroadcastChannel(CONFIG.TEAM_CHANNEL_PREFIX + id);
    S.channel.onmessage = onTeamMsg;
    say(`✅ Unido a <b>${id}</b>. Puedes liderar o esperar shards.`);
  };
  ui.btnLead.onclick = () => {
    if (!S.channel) return alert('Primero “Unirse”');
    S.role = 'leader';
    say(`⭐ Modo líder. Sube imagen, detecta paleta y calibra.`);
  };

  ui.btnPalette.onclick = () => {
    S.palette = readPalette();
    S.havePalette = S.palette.length>0;
    say(S.havePalette ? `🎨 Paleta detectada: ${S.palette.length} colores.` : `❌ Abre la paleta del juego y vuelve a intentar.`);
  };

  ui.btnImg.onclick = async () => {
    try{
      const d = await pickImage();
      S.img = await loadImageToPixels(d);
      S.total = countDrawablePixels(S.img);
      S.painted = 0;
      ui.bar.style.width='0%';
      say(`🖼️ Imagen ${S.img.w}×${S.img.h}. Píxeles a pintar: ${S.total}.`);
    }catch{ say(`❌ Error al cargar imagen`); }
  };
  ui.btnResize.onclick = () => {
    if (!S.img) return alert('Sube imagen primero');
    const W = Math.max(1, parseInt(ui.inW.value||'0',10));
    const H = Math.max(1, parseInt(ui.inH.value||'0',10));
    S.img = scaleNearest(S.img, W,H);
    S.total = countDrawablePixels(S.img);
    S.painted = 0; ui.bar.style.width='0%';
    say(`🔧 Redimensionado a ${W}×${H}. Píxeles a pintar: ${S.total}.`);
  };

  ui.inTotal.onchange = ()=> {
    S.totalWorkers = Math.max(1, parseInt(ui.inTotal.value||'1',10));
    if (S.workerSlot > S.totalWorkers) { S.workerSlot = S.totalWorkers; ui.inSlot.value = String(S.workerSlot); }
  };
  ui.inSlot.onchange = ()=> {
    S.workerSlot = Math.max(1, Math.min(S.totalWorkers, parseInt(ui.inSlot.value||'1',10)));
  };

  ui.btnCal.onclick = async () => {
    alert('CALIBRACIÓN: 1) Haz click EXACTO donde irá la ESQUINA SUPERIOR-IZQUIERDA de tu imagen. 2) Luego haz click en el píxel INMEDIATO a la DERECHA (misma fila). No muevas zoom/pan entre ambos.');
    say('📌 Esperando CLICK #1 (ancla)…');
    const ev1 = await waitPointerOnce();
    S.clickTarget = ev1.target;
    S.anchorScreen = { x: ev1.clientX, y: ev1.clientY };
    say('➡️ Esperando CLICK #2 (siguiente píxel a la derecha)…');
    const ev2 = await waitPointerOnce();
    if (ev2.target !== S.clickTarget) {
      alert('Hiciste el 2º click en otro elemento. Repite la calibración sin mover el canvas.');
      S.anchorScreen=null; S.clickTarget=null; return;
    }
    const dx = Math.abs(ev2.clientX - ev1.clientX);
    if (dx < 1) {
      alert('No detecté avance en X. Asegúrate de clicar EXACTAMENTE el píxel vecino a la derecha y con zoom suficiente.');
      S.anchorScreen=null; S.clickTarget=null; return;
    }
    S.cellDX = dx; S.cellDY = dx;
    // Guardamos las coords tableras del click #1 leyendo el último fetch del sitio:
    // En lugar de intentar parsear el fetch, te pedimos 1 dato:
    const txt = prompt('Ingresa las coordenadas tablero del CLICK #1 en formato "x,y" (lo ves en la UI del juego si la muestra). Si no sabes, deja 0,0:', '0,0') || '0,0';
    const parts = txt.split(',').map(s=>parseInt(s.trim(),10));
    S.boardAx = Number.isFinite(parts[0])?parts[0]:0;
    S.boardAy = Number.isFinite(parts[1])?parts[1]:0;

    ui.btnStart.disabled = !(S.havePalette && S.img);
    say(`✅ Calibrado. cell=${dx.toFixed(2)}px. Ancla tablero=(${S.boardAx},${S.boardAy}).`);
  };

  ui.btnStart.onclick = async ()=>{
    if (!(S.havePalette && S.img && S.anchorScreen && S.clickTarget)){
      return alert('Falta: paleta, imagen o calibración');
    }
    // sincroniza cargas iniciales
    await getCharges();
    S.stop = false; S.running=true;
    ui.btnStart.disabled = true; ui.btnStop.disabled = false;
    // Distribuye shards si eres líder (los miembros piden automáticamente)
    if (S.role==='leader' && S.channel){
      S.channel.onmessage = (ev)=>{
        const m=ev.data; if(m?.t==='needShard'){ const sh=nextStripe(S.img.w,S.img.h); if(sh) S.channel.postMessage({t:'giveShard', shard:sh}); }
      };
      // lanza una notificación de meta para que pidan shards
      S.channel.postMessage({t:'img-meta', w:S.img.w, h:S.img.h});
    } else if (S.channel && S.role!=='leader') {
      // pide un shard al líder
      S.channel.postMessage({t:'needShard'});
    }
    try{
      await paintLoop(ui);
    } finally {
      S.running=false; ui.btnStop.disabled=true; ui.btnStart.disabled=false;
    }
  };
  ui.btnStop.onclick = ()=> { S.stop=true; };

  // Autodetecta paleta (si la paleta está abierta ya)
  S.palette = readPalette(); S.havePalette = S.palette.length>0;
  if (!S.havePalette) ui.status.innerHTML = 'ℹ️ Abre la paleta de colores del juego y pulsa “Detectar paleta”.';
  else ui.status.innerHTML = `🎨 Paleta detectada: ${S.palette.length} colores.`;

})();
