(async () => {
/* ===========================
   Auto-Image-Zones.js
   — WPlace Auto-Image multi-cuenta por ZONAS (franjas)
   — Misma UI/flujo que Sharded, pero filtra por zona fija
   =========================== */

const CONFIG = {
  COOLDOWN_DEFAULT: 31000,
  TRANSPARENCY_THRESHOLD: 100,
  WHITE_THRESHOLD: 250,
  LOG_INTERVAL: 10,
  THEME: {
    primary: '#000000',
    secondary: '#111111',
    accent: '#222222',
    text: '#ffffff',
    highlight: '#775ce3',
    success: '#00ff00',
    error: '#ff0000',
    warning: '#ffaa00'
  }
};

const TEXTS = {
  es: {
    title: "WPlace Auto-Image (Zonas)",
    initBot: "Iniciar Auto-BOT",
    uploadImage: "Subir imagen",
    resizeImage: "Redimensionar imagen",
    selectPosition: "Seleccionar posición",
    startPainting: "Iniciar pintura",
    stopPainting: "Detener",
    checkingColors: "🔍 Buscando colores...",
    noColorsFound: "❌ Abrí la paleta de colores y probá otra vez",
    colorsFound: "✅ {count} colores disponibles",
    loadingImage: "🖼️ Cargando imagen...",
    imageLoaded: "✅ Imagen cargada con {count} píxeles válidos",
    imageError: "❌ Error al cargar la imagen",
    selectPositionAlert: "Pintá un pixel para fijar el inicio",
    waitingPosition: "👆 Esperando pixel de referencia...",
    positionSet: "✅ Posición definida",
    positionTimeout: "❌ Tiempo agotado",
    startPaintingMsg: "🎨 Empezando…",
    paintingProgress: "🧱 Progreso: {painted}/{total} píxeles…",
    noCharges: "⌛ Sin cargas. Esperando {time}…",
    paintingStopped: "⏹️ Pintura detenida",
    paintingComplete: "✅ Listo! {count} píxeles pintados.",
    paintingError: "❌ Error durante la pintura",
    missingRequirements: "❌ Cargá imagen + posición primero",
    progress: "Progreso",
    pixels: "Píxeles",
    charges: "Cargas",
    estimatedTime: "Tiempo estimado",
    initMessage: "Clic en 'Iniciar Auto-BOT' para comenzar",
    waitingInit: "Esperando inicialización...",
    resizeSuccess: "✅ Imagen redimensionada a {width}x{height}",
    paintingPaused: "⏸️ Pausa en X: {x}, Y: {y}",
    keepAspect: "Mantener proporción",
    width: "Ancho",
    height: "Alto",
    apply: "Aplicar",
    cancel: "Cancelar",
    minimize: "Minimizar",
    zonesTotal: "Zonas totales",
    zoneMine: "Tu zona #",
    orientation: "Orientación",
    vertical: "Vertical",
    horizontal: "Horizontal"
  },
  en: {
    title: "WPlace Auto-Image (Zones)",
    initBot: "Start Auto-BOT",
    uploadImage: "Upload Image",
    resizeImage: "Resize Image",
    selectPosition: "Select Position",
    startPainting: "Start Painting",
    stopPainting: "Stop",
    checkingColors: "🔍 Checking colors...",
    noColorsFound: "❌ Open the palette and try again",
    colorsFound: "✅ {count} available colors",
    loadingImage: "🖼️ Loading image...",
    imageLoaded: "✅ Image loaded with {count} valid pixels",
    imageError: "❌ Error loading image",
    selectPositionAlert: "Paint one pixel to set the start",
    waitingPosition: "👆 Waiting reference pixel...",
    positionSet: "✅ Position set",
    positionTimeout: "❌ Timeout",
    startPaintingMsg: "🎨 Starting…",
    paintingProgress: "🧱 Progress: {painted}/{total} pixels…",
    noCharges: "⌛ No charges. Waiting {time}…",
    paintingStopped: "⏹️ Painting stopped",
    paintingComplete: "✅ Done! {count} pixels painted.",
    paintingError: "❌ Error while painting",
    missingRequirements: "❌ Load image + select position first",
    progress: "Progress",
    pixels: "Pixels",
    charges: "Charges",
    estimatedTime: "Estimated time",
    initMessage: "Click 'Start Auto-BOT' to begin",
    waitingInit: "Waiting for initialization...",
    resizeSuccess: "✅ Image resized to {width}x{height}",
    paintingPaused: "⏸️ Paused at X: {x}, Y: {y}",
    keepAspect: "Keep aspect",
    width: "Width",
    height: "Height",
    apply: "Apply",
    cancel: "Cancel",
    minimize: "Minimize",
    zonesTotal: "Total zones",
    zoneMine: "Your zone #",
    orientation: "Orientation",
    vertical: "Vertical",
    horizontal: "Horizontal"
  }
};

const state = {
  running:false, imageLoaded:false, processing:false,
  totalPixels:0, paintedPixels:0, availableColors:[],
  currentCharges:0, cooldown:CONFIG.COOLDOWN_DEFAULT,
  imageData:null, stopFlag:false, colorsChecked:false,
  startPosition:null, selectingPosition:false, region:null,
  minimized:false, lastPosition:{x:0,y:0}, estimatedTime:0,
  language:'es',
  // ZONAS
  zonesTotal: 2,
  zoneMine: 1,
  orientation: 'vertical' // 'vertical' | 'horizontal'
};

/* --- utils & api (idénticos a sharded salvo textos) --- */
function detectLanguage(){ const l=(navigator.language||'es').split('-')[0]; state.language = (TEXTS[l]? l:'es'); }
const t=(k,p={})=>{ let s=(TEXTS[state.language][k]||TEXTS.en[k]||k); for(const [a,b] of Object.entries(p)) s=s.replace(`{${a}}`,b); return s; };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const colorDistance=(a,b)=>Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
function isWhitePixel(r,g,b){ return r>=CONFIG.WHITE_THRESHOLD && g>=CONFIG.WHITE_THRESHOLD && b>=CONFIG.WHITE_THRESHOLD; }
function formatTime(ms){ const s=Math.floor((ms/1000)%60), m=Math.floor((ms/(1000*60))%60), h=Math.floor((ms/(1000*60*60))%24), d=Math.floor(ms/(1000*60*60*24)); return (d?d+'d ':'')+(h?h+'h ':'')+(m?m+'m ':'')+s+'s'; }
function showAlert(msg){ const d=document.createElement('div'); d.style.cssText=`position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:12px 16px;background:${CONFIG.THEME.accent};color:${CONFIG.THEME.text};border:1px solid ${CONFIG.THEME.highlight};border-radius:8px;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.45);font:13px system-ui`; d.textContent=msg; document.body.appendChild(d); setTimeout(()=>{d.style.opacity='0'; d.style.transition='opacity .4s'; setTimeout(()=>d.remove(),400);},2200); }
function extractAvailableColors(){ const els=document.querySelectorAll('[id^="color-"]'); return Array.from(els).filter(el=>!el.querySelector('svg')).filter(el=>{const id=+el.id.replace('color-',''); return id!==0&&id!==5;}).map(el=>{const id=+el.id.replace('color-',''); const rgbStr = el.style.backgroundColor.match(/\d+/g); const rgb = rgbStr? rgbStr.map(Number):[0,0,0]; return {id,rgb};}); }
function findClosestColor(rgb, pal){ return pal.reduce((b,c)=>{const d=colorDistance(rgb,c.rgb);return d<b.d?{id:c.id,d}:b;},{id:pal[0].id,d:colorDistance(rgb,pal[0].rgb)}).id; }
function calculateEstimatedTime(rem, charges, cd){ const per=Math.max(charges,1); const cycles=Math.ceil(Math.max(rem-charges,0)/per); return (cycles*cd)+(Math.max(rem-1,0)*100); }
const WPlace = {
  async paint(regionX,regionY,x,y,color){ try{ const r=await fetch(`https://backend.wplace.live/s0/pixel/${regionX}/${regionY}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},credentials:'include',body:JSON.stringify({coords:[x,y],colors:[color]})}); const j=await r.json(); return j?.painted===1; }catch{return false;} },
  async charges(){ try{ const r=await fetch('https://backend.wplace.live/me',{credentials:'include'}); const j=await r.json(); return {charges:j.charges?.count||0, cooldown:j.charges?.cooldownMs||CONFIG.COOLDOWN_DEFAULT}; }catch{return {charges:0,cooldown:CONFIG.COOLDOWN_DEFAULT};} }
};
class ImageProcessor{ constructor(src){this.img=new Image();this.c=document.createElement('canvas');this.x=this.c.getContext('2d');this.pv=document.createElement('canvas');this.pvx=this.pv.getContext('2d');this.src=src;} async load(){return new Promise((res,rej)=>{this.img.onload=()=>{this.c.width=this.img.width;this.c.height=this.img.height;this.x.drawImage(this.img,0,0);res();};this.img.onerror=rej;this.img.src=this.src;});} getPixelData(){return this.x.getImageData(0,0,this.c.width,this.c.height).data;} getDimensions(){return {width:this.c.width,height:this.c.height};} resize(w,h){const t=document.createElement('canvas');t.width=w;t.height=h;const tx=t.getContext('2d');tx.drawImage(this.img,0,0,w,h);this.c.width=w;this.c.height=h;this.x.drawImage(t,0,0);return this.getPixelData();} previewDataURL(w,h){this.pv.width=w;this.pv.height=h;this.pvx.imageSmoothingEnabled=false;this.pvx.drawImage(this.img,0,0,w,h);return this.pv.toDataURL();}}

/* --- UI --- */
function createUI(){
  detectLanguage();
  const fa=document.createElement('link'); fa.rel='stylesheet'; fa.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'; document.head.appendChild(fa);
  const css=document.createElement('style'); css.textContent=`
    #wplace-zones{position:fixed;top:20px;right:20px;width:330px;background:${CONFIG.THEME.primary};border:1px solid ${CONFIG.THEME.accent};border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.5);z-index:99998;color:${CONFIG.THEME.text);overflow:hidden}
    #wplace-zones .hdr{padding:12px 14px;background:${CONFIG.THEME.secondary};color:${CONFIG.THEME.highlight};display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
    #wplace-zones .body{padding:12px;font:14px system-ui}
    .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
    .btn{padding:8px 10px;border:none;border-radius:6px;cursor:pointer;font-weight:600}
    .b1{background:${CONFIG.THEME.accent};color:#fff}
    .b2{background:${CONFIG.THEME.success};color:#000}
    .b3{background:${CONFIG.THEME.error};color:#fff}
    .b4{background:${CONFIG.THEME.highlight};color:#000}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .box{background:${CONFIG.THEME.secondary};padding:10px;border-radius:6px}
    progress{width:100%}
    select,input[type=number]{padding:6px;border-radius:6px;border:1px solid #444;background:#000;color:#fff}
    .status{padding:8px;border-radius:4px;background:rgba(255,255,255,.08);text-align:center}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;z-index:9999}
    .modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:${CONFIG.THEME.primary};padding:16px;border-radius:8px;z-index:10000;display:none;box-shadow:0 0 18px rgba(0,0,0,.5)}
    .preview{max-width:100%;max-height:300px;margin:10px 0;border:1px solid ${CONFIG.THEME.accent}}
  `; document.head.appendChild(css);

  const root=document.createElement('div'); root.id='wplace-zones'; root.innerHTML=`
    <div class="hdr"><div><i class="fa-solid fa-image"></i> ${t('title')}</div><button id="min" class="btn" style="background:none;border:none;color:${CONFIG.THEME.text}"><i class="fa-solid fa-minus"></i></button></div>
    <div class="body">
      <div class="row">
        <button id="init" class="btn b1"><i class="fa-solid fa-robot"></i> ${t('initBot')}</button>
        <button id="up"   class="btn"    style="background:${CONFIG.THEME.secondary};color:#fff;border:1px dashed #fff" disabled><i class="fa-solid fa-upload"></i> ${t('uploadImage')}</button>
      </div>
      <div class="row">
        <button id="rz" class="btn b1" disabled><i class="fa-solid fa-expand"></i> ${t('resizeImage')}</button>
        <button id="pos" class="btn b4" disabled><i class="fa-solid fa-crosshairs"></i> ${t('selectPosition')}</button>
      </div>
      <div class="row">
        <label>${t('orientation')} <select id="ori"><option value="vertical">${t('vertical')}</option><option value="horizontal">${t('horizontal')}</option></select></label>
      </div>
      <div class="row">
        <label>${t('zonesTotal')} <input id="zones" type="number" min="1" value="2" style="width:80px"></label>
        <label>${t('zoneMine')}  <input id="mine"  type="number" min="1" value="1" style="width:80px"></label>
      </div>
      <div class="row">
        <button id="start" class="btn b2" disabled><i class="fa-solid fa-play"></i> ${t('startPainting')}</button>
        <button id="stop"  class="btn b3" disabled><i class="fa-solid fa-stop"></i> ${t('stopPainting')}</button>
      </div>
      <div class="box"><progress id="pg" value="0" max="100"></progress><div id="stats" style="font-size:12px;opacity:.9;margin-top:6px">—</div></div>
      <div id="status" class="status">${t('waitingInit')}</div>
    </div>
  `;
  document.body.appendChild(root);

  // drag
  const hdr=root.querySelector('.hdr'); let a=0,b=0,c=0,d=0;
  hdr.onmousedown=e=>{ if(e.target.id==='min') return; e.preventDefault(); c=e.clientX; d=e.clientY;
    document.onmouseup=()=>{document.onmouseup=null;document.onmousemove=null;};
    document.onmousemove=ev=>{ ev.preventDefault(); a=c-ev.clientX; b=d-ev.clientY; c=ev.clientX; d=ev.clientY; root.style.top=(root.offsetTop-b)+'px'; root.style.left=(root.offsetLeft-a)+'px'; };
  };

  // overlay + modal resize
  const ov=document.createElement('div'); ov.className='overlay';
  const md=document.createElement('div'); md.className='modal';
  md.innerHTML=`
    <h3 style="margin:0 0 8px 0">${t('resizeImage')}</h3>
    <label>${t('width')}: <span id="wval">0</span>px <input id="wsl" type="range" min="10" max="1000" value="100" style="width:100%"></label>
    <label>${t('height')}: <span id="hval">0</span>px <input id="hsl" type="range" min="10" max="1000" value="100" style="width:100%"></label>
    <label><input id="keep" type="checkbox" checked> ${t('keepAspect')}</label>
    <img id="pv" class="preview" src="">
    <div class="row">
      <button id="ok" class="btn b1">${t('apply')}</button>
      <button id="ko" class="btn b3">${t('cancel')}</button>
    </div>
  `;
  document.body.appendChild(ov); document.body.appendChild(md);

  // refs
  const S = id=>root.querySelector('#'+id);
  const min=S('min'), init=S('init'), up=S('up'), rz=S('rz'), pos=S('pos'), start=S('start'), stop=S('stop'), pg=S('pg'), stats=S('stats'), status=S('status');
  const ori=S('ori'), zones=S('zones'), mine=S('mine');
  const wsl=md.querySelector('#wsl'), hsl=md.querySelector('#hsl'), wval=md.querySelector('#wval'), hval=md.querySelector('#hval'), keep=md.querySelector('#keep'), pv=md.querySelector('#pv'), ok=md.querySelector('#ok'), ko=md.querySelector('#ko');

  function setStatus(msg){ status.textContent = msg; }
  async function refreshStats(){
    if(!state.colorsChecked || !state.imageLoaded) return;
    const {charges,cooldown} = await WPlace.charges(); state.currentCharges=Math.floor(charges); state.cooldown=cooldown;
    const prog = state.totalPixels? Math.round(100*state.paintedPixels/state.totalPixels):0;
    const remain = Math.max(state.totalPixels-state.paintedPixels,0);
    state.estimatedTime = calculateEstimatedTime(remain, state.currentCharges, state.cooldown);
    pg.value=prog;
    stats.innerHTML = `<div><b>${t('progress')}:</b> ${prog}%</div><div><b>${t('pixels')}:</b> ${state.paintedPixels}/${state.totalPixels}</div><div><b>${t('charges')}:</b> ${state.currentCharges}</div><div><b>${t('estimatedTime')}:</b> ${formatTime(state.estimatedTime)}</div>`;
  }

  min.onclick=()=>{ const body=root.querySelector('.body'); const icon=min.querySelector('i'); const disp=body.style.display!=='none'; body.style.display=disp?'none':'block'; icon.className = disp? 'fa-solid fa-expand':'fa-solid fa-minus'; };

  init.onclick=()=>{ state.availableColors = extractAvailableColors(); state.colorsChecked = state.availableColors.length>0; if(!state.colorsChecked){ setStatus(t('noColorsFound')); showAlert(t('noColorsFound')); return; } up.disabled=false; pos.disabled=false; init.style.display='none'; setStatus(t('colorsFound',{count:state.availableColors.length})); refreshStats(); };

  up.onclick=()=>{ const input=document.createElement('input'); input.type='file'; input.accept='image/png,image/jpeg'; input.onchange=async ()=>{ const fr=new FileReader(); fr.onload=async ()=>{ const p=new ImageProcessor(fr.result); await p.load(); const {width,height}=p.getDimensions(); const pixels=p.getPixelData(); let total=0; for(let y=0;y<height;y++) for(let x=0;x<width;x++){ const i=4*(y*width+x); const a=pixels[i+3]; if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue; const r=pixels[i],g=pixels[i+1],b=pixels[i+2]; if(isWhitePixel(r,g,b)) continue; total++; } state.imageData={width,height,pixels,totalPixels:total,proc:p}; state.totalPixels=total; state.paintedPixels=0; state.imageLoaded=true; rz.disabled=false; if(state.startPosition) start.disabled=false; refreshStats(); setStatus(t('imageLoaded',{count:total})); }; fr.readAsDataURL(input.files[0]); }; input.click(); };

  // resize modal
  function openResize(proc){ const {width,height}=proc.getDimensions(); const AR=width/height; wsl.value=width; hsl.value=height; wval.textContent=width; hval.textContent=height; pv.src=proc.img.src; wsl.oninput=()=>{ if(keep.checked){ hsl.value=Math.round(+wsl.value/AR); } wval.textContent=wsl.value; hval.textContent=hsl.value; pv.src=proc.previewDataURL(+wsl.value,+hsl.value); }; hsl.oninput=()=>{ if(keep.checked){ wsl.value=Math.round(+hsl.value*AR); } wval.textContent=wsl.value; hval.textContent=hsl.value; pv.src=proc.previewDataURL(+wsl.value,+hsl.value); }; ok.onclick=()=>{ const w=+wsl.value, h=+hsl.value; const px=proc.resize(w,h); let total=0; for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=4*(y*w+x); const a=px[i+3]; if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue; const r=px[i],g=px[i+1],b=px[i+2]; if(isWhitePixel(r,g,b)) continue; total++; } state.imageData.pixels=px; state.imageData.width=w; state.imageData.height=h; state.imageData.totalPixels=total; state.totalPixels=total; state.paintedPixels=0; refreshStats(); setStatus(t('resizeSuccess',{width:w,height:h})); ov.style.display='none'; md.style.display='none'; }; ko.onclick=()=>{ ov.style.display='none'; md.style.display='none'; }; ov.style.display='block'; md.style.display='block'; }
  rz.onclick=()=>{ if(state.imageLoaded && state.imageData.proc) openResize(state.imageData.proc); };

  // select position
  pos.onclick=()=>{ if(state.selectingPosition) return; state.selectingPosition=true; state.startPosition=null; state.region=null; start.disabled=true; setStatus(t('waitingPosition')); const orig=window.fetch; window.fetch=async (url,opt)=>{ if(typeof url==='string'&&url.includes('https://backend.wplace.live/s0/pixel/')&&opt?.method?.toUpperCase()==='POST'){ try{ const res=await orig(url,opt); const c=res.clone(); const j=await c.json(); if(j?.painted===1){ const m=url.match(/\/pixel\/(\d+)\/(\d+)/); if(m){ state.region={x:+m[1],y:+m[2]}; } const body=JSON.parse(opt.body||'{}'); if(body?.coords){ state.startPosition={x:body.coords[0],y:body.coords[1]}; state.lastPosition={x:0,y:0}; } window.fetch=orig; state.selectingPosition=false; setStatus(t('positionSet')); if(state.imageLoaded) start.disabled=false; } return res; }catch{ return orig(url,opt); } } return orig(url,opt); }; setTimeout(()=>{ if(state.selectingPosition){ window.fetch=orig; state.selectingPosition=false; setStatus(t('positionTimeout')); showAlert(t('positionTimeout')); } },120000); };

  start.onclick=async ()=>{ if(!state.imageLoaded||!state.startPosition||!state.region){ setStatus(t('missingRequirements')); return; } state.running=true; state.stopFlag=false; start.disabled=true; stop.disabled=false; up.disabled=true; pos.disabled=true; rz.disabled=true; setStatus(t('startPaintingMsg')); try{ await processZones(); }catch{ setStatus(t('paintingError')); } finally{ state.running=false; stop.disabled=true; if(!state.stopFlag){ start.disabled=true; up.disabled=false; pos.disabled=false; rz.disabled=false; } else { start.disabled=false; } } };
  stop.onclick=()=>{ state.stopFlag=true; state.running=false; stop.disabled=true; setStatus(t('paintingStopped')); };
}

/* --- painting por zona --- */
async function processZones(){
  const {width,height,pixels} = state.imageData;
  const {x:startX,y:startY} = state.startPosition;
  const {x:rx,y:ry} = state.region;

  // calcular mi rango
  const Z = Math.max(1, +state.zonesTotal|0);
  const K = Math.max(1, Math.min(Z, +state.zoneMine|0));
  let x0=0,x1=width-1, y0=0,y1=height-1;
  if(state.orientation==='vertical'){
    const wPer = Math.floor(width / Z);
    x0 = wPer*(K-1);
    x1 = (K===Z) ? (width-1) : (x0 + wPer - 1);
  }else{
    const hPer = Math.floor(height / Z);
    y0 = hPer*(K-1);
    y1 = (K===Z) ? (height-1) : (y0 + hPer - 1);
  }

  outer:
  for(let y=0; y<height; y++){
    for(let x=0; x<width; x++){
      if(state.stopFlag){ setStatus(t('paintingPaused',{x,y})); break outer; }
      // filtrar por mi zona
      if( x<x0 || x>x1 || y<y0 || y>y1 ) continue;

      const i=4*(y*width+x);
      const r=pixels[i],g=pixels[i+1],b=pixels[i+2], a=pixels[i+3];
      if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
      if(isWhitePixel(r,g,b)) continue;

      if(state.currentCharges<1){
        setStatus(t('noCharges',{time:formatTime(state.cooldown)}));
        await sleep(state.cooldown);
        const ch=await WPlace.charges(); state.currentCharges=Math.floor(ch.charges); state.cooldown=ch.cooldown;
      }

      const colorId = findClosestColor([r,g,b], state.availableColors);
      const px = startX + x, py = startY + y;
      const ok = await WPlace.paint(rx,ry,px,py,colorId);
      if(ok){
        state.paintedPixels++;
        state.currentCharges = Math.max(0,state.currentCharges-1);
        if(state.paintedPixels % CONFIG.LOG_INTERVAL===0){
          await refreshStats();
          setStatus(t('paintingProgress',{painted:state.paintedPixels,total:state.totalPixels}));
        }
      }
    }
  }

  if(state.stopFlag){ setStatus(t('paintingStopped')); }
  else { setStatus(t('paintingComplete',{count:state.paintedPixels})); }
  await refreshStats();
}

/* --- boot --- */
createUI();

})();
