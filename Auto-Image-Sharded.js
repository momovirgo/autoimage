(async () => {
/* ===========================
   Auto-Image-Sharded.js
   — WPlace Auto-Image multi-cuenta por SHARDING (módulo)
   — Basado en tu Auto-Image (UI, API real, drag, resize)
   — Todas las cuentas en la misma PC; sin coordinación externa
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
    title: "WPlace Auto-Image (Sharded)",
    initBot: "Iniciar Auto-BOT",
    uploadImage: "Subir imagen",
    resizeImage: "Redimensionar imagen",
    selectPosition: "Seleccionar posición",
    startPainting: "Iniciar pintura",
    stopPainting: "Detener",
    checkingColors: "🔍 Buscando colores disponibles...",
    noColorsFound: "❌ Abrí la paleta de colores del sitio y probá de nuevo",
    colorsFound: "✅ {count} colores disponibles",
    loadingImage: "🖼️ Cargando imagen...",
    imageLoaded: "✅ Imagen cargada con {count} píxeles válidos",
    imageError: "❌ Error al cargar la imagen",
    selectPositionAlert: "Pintá 1 pixel donde querés que empiece el arte",
    waitingPosition: "👆 Esperando tu pixel de referencia...",
    positionSet: "✅ Posición definida",
    positionTimeout: "❌ Tiempo agotado al seleccionar posición",
    startPaintingMsg: "🎨 Empezando pintura...",
    paintingProgress: "🧱 Progreso: {painted}/{total} píxeles...",
    noCharges: "⌛ Sin cargas. Esperando {time}...",
    paintingStopped: "⏹️ Pintura detenida por el usuario",
    paintingComplete: "✅ Pintura terminada! {count} píxeles pintados.",
    paintingError: "❌ Error durante la pintura",
    missingRequirements: "❌ Cargá una imagen y seleccioná la posición antes",
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
    shardTotal: "Total cuentas",
    shardSlot: "Tu nº"
  },
  en: {
    title: "WPlace Auto-Image (Sharded)",
    initBot: "Start Auto-BOT",
    uploadImage: "Upload Image",
    resizeImage: "Resize Image",
    selectPosition: "Select Position",
    startPainting: "Start Painting",
    stopPainting: "Stop",
    checkingColors: "🔍 Checking available colors...",
    noColorsFound: "❌ Open the site's color palette and try again",
    colorsFound: "✅ {count} available colors",
    loadingImage: "🖼️ Loading image...",
    imageLoaded: "✅ Image loaded with {count} valid pixels",
    imageError: "❌ Error loading image",
    selectPositionAlert: "Paint a single pixel where you want the art to start",
    waitingPosition: "👆 Waiting for your reference pixel...",
    positionSet: "✅ Position set",
    positionTimeout: "❌ Timeout when selecting position",
    startPaintingMsg: "🎨 Starting painting...",
    paintingProgress: "🧱 Progress: {painted}/{total} pixels...",
    noCharges: "⌛ No charges. Waiting {time}...",
    paintingStopped: "⏹️ Painting stopped by user",
    paintingComplete: "✅ Painting complete! {count} pixels painted.",
    paintingError: "❌ Error while painting",
    missingRequirements: "❌ Load an image and select a position first",
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
    shardTotal: "Total accounts",
    shardSlot: "Your #"
  }
};

const state = {
  running: false,
  imageLoaded: false,
  processing: false,
  totalPixels: 0,
  paintedPixels: 0,
  availableColors: [],
  currentCharges: 0,
  cooldown: CONFIG.COOLDOWN_DEFAULT,
  imageData: null,
  stopFlag: false,
  colorsChecked: false,
  startPosition: null,
  selectingPosition: false,
  region: null,
  minimized: false,
  lastPosition: { x: 0, y: 0 },
  estimatedTime: 0,
  language: 'es',
  // SHARDING
  totalWorkers: 1,
  workerSlot: 1
};

/* ---------- Utils ---------- */
function detectLanguage(){
  const userLang = (navigator.language||'es').split('-')[0];
  state.language = (TEXTS[userLang] ? userLang : 'es');
}
const t = (key, params={})=>{
  let s = (TEXTS[state.language][key] || TEXTS.en[key] || key);
  for(const [k,v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const colorDistance = (a,b)=>Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
function isWhitePixel(r,g,b){ return r>=CONFIG.WHITE_THRESHOLD && g>=CONFIG.WHITE_THRESHOLD && b>=CONFIG.WHITE_THRESHOLD; }
function formatTime(ms){
  const s = Math.floor((ms/1000)%60),
        m = Math.floor((ms/(1000*60))%60),
        h = Math.floor((ms/(1000*60*60))%24),
        d = Math.floor(ms/(1000*60*60*24));
  return (d?d+'d ':'') + (h?h+'h ':'') + (m?m+'m ':'') + s+'s';
}
function showAlert(message, type='info'){
  const div=document.createElement('div');
  div.style.cssText = `
    position:fixed; top:20px; left:50%; transform:translateX(-50%);
    padding:12px 16px; background:${CONFIG.THEME.accent}; color:${CONFIG.THEME.text};
    border:1px solid ${CONFIG.THEME.highlight}; border-radius:8px; z-index:10000;
    box-shadow:0 6px 20px rgba(0,0,0,.45); font:13px/1.3 system-ui,Segoe UI,Roboto,Arial;
  `;
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(()=>{ div.style.opacity='0'; div.style.transition='opacity .4s'; setTimeout(()=>div.remove(),400); }, 2200);
}
function extractAvailableColors(){
  const colorElements = document.querySelectorAll('[id^="color-"]');
  return Array.from(colorElements)
    .filter(el=>!el.querySelector('svg'))
    .filter(el=>{ const id = parseInt(el.id.replace('color-','')); return id!==0 && id!==5; })
    .map(el=>{
      const id = parseInt(el.id.replace('color-',''));
      const rgbStr = el.style.backgroundColor.match(/\d+/g);
      const rgb = rgbStr ? rgbStr.map(Number) : [0,0,0];
      return { id, rgb };
    });
}
function findClosestColor(rgb, palette){
  return palette.reduce((best,cur)=>{
    const d = colorDistance(rgb,cur.rgb);
    return (d<best.d)? {id:cur.id,d} : best;
  }, {id:palette[0].id, d:colorDistance(rgb,palette[0].rgb)}).id;
}
function calculateEstimatedTime(remainingPixels, currentCharges, cooldown){
  const perCycle = Math.max(currentCharges, 1);
  const cycles = Math.ceil(Math.max(remainingPixels - currentCharges, 0)/perCycle);
  return (cycles * cooldown) + (Math.max(remainingPixels-1,0) * 100);
}

/* ---------- WPlace API ---------- */
const WPlace = {
  async paintPixelInRegion(regionX, regionY, pixelX, pixelY, color){
    try{
      const res = await fetch(`https://backend.wplace.live/s0/pixel/${regionX}/${regionY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        credentials: 'include',
        body: JSON.stringify({ coords:[pixelX,pixelY], colors:[color] })
      });
      const data = await res.json();
      return data?.painted===1;
    }catch{ return false; }
  },
  async getCharges(){
    try{
      const res = await fetch('https://backend.wplace.live/me', { credentials:'include' });
      const data = await res.json();
      return { charges: data.charges?.count||0, cooldown: data.charges?.cooldownMs||CONFIG.COOLDOWN_DEFAULT };
    }catch{
      return { charges: 0, cooldown: CONFIG.COOLDOWN_DEFAULT };
    }
  }
};

/* ---------- Image Processor ---------- */
class ImageProcessor{
  constructor(src){
    this.img = new Image();
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.preview = document.createElement('canvas');
    this.pctx = this.preview.getContext('2d');
    this.src = src;
  }
  async load(){ return new Promise((res,rej)=>{ this.img.onload=()=>{ this.canvas.width=this.img.width; this.canvas.height=this.img.height; this.ctx.drawImage(this.img,0,0); res(); }; this.img.onerror=rej; this.img.src=this.src; }); }
  getPixelData(){ return this.ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data; }
  getDimensions(){ return { width:this.canvas.width, height:this.canvas.height }; }
  resize(w,h){
    const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h; const tctx=tmp.getContext('2d');
    tctx.drawImage(this.img,0,0,w,h);
    this.canvas.width=w; this.canvas.height=h; this.ctx.drawImage(tmp,0,0);
    return this.getPixelData();
  }
  previewDataURL(w,h){ this.preview.width=w; this.preview.height=h; this.pctx.imageSmoothingEnabled=false; this.pctx.drawImage(this.img,0,0,w,h); return this.preview.toDataURL(); }
}

/* ---------- UI ---------- */
function createUI(){
  detectLanguage();

  const fa=document.createElement('link');
  fa.rel='stylesheet';
  fa.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(fa);

  const style=document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
    #wplace-image-bot-container {
      position:fixed; top:20px; right:20px; width:320px; background:${CONFIG.THEME.primary};
      border:1px solid ${CONFIG.THEME.accent}; border-radius:8px; padding:0; box-shadow:0 5px 15px rgba(0,0,0,0.5);
      z-index:99998; color:${CONFIG.THEME.text}; font:14px/1.3 system-ui,Segoe UI,Roboto,Arial; overflow:hidden; animation:slideIn .3s ease-out;
    }
    .wplace-header { padding:12px 15px; background:${CONFIG.THEME.secondary}; color:${CONFIG.THEME.highlight}; display:flex; justify-content:space-between; align-items:center; cursor:move; user-select:none; }
    .wplace-content { padding:14px; }
    .wplace-btn { padding:9px 10px; border:none; border-radius:6px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:transform .15s }
    .wplace-btn:hover{ transform:translateY(-1px) }
    .wplace-btn-primary { background:${CONFIG.THEME.accent}; color:#fff }
    .wplace-btn-upload { background:${CONFIG.THEME.secondary}; color:#fff; border:1px dashed ${CONFIG.THEME.text} }
    .wplace-btn-start { background:${CONFIG.THEME.success}; color:#000 }
    .wplace-btn-stop { background:${CONFIG.THEME.error}; color:#fff }
    .wplace-btn-select { background:${CONFIG.THEME.highlight}; color:#000 }
    .wplace-btn:disabled { opacity:.5; cursor:not-allowed; transform:none }
    .wplace-progress { width:100%; background:${CONFIG.THEME.secondary}; border-radius:4px; margin:10px 0; overflow:hidden }
    .wplace-progress-bar { height:10px; background:${CONFIG.THEME.highlight}; transition:width .3s }
    .wplace-stats { background:${CONFIG.THEME.secondary}; padding:10px; border-radius:6px; margin-bottom:10px; }
    .row { display:flex; gap:8px; align-items:center; margin:8px 0; flex-wrap:wrap; }
    label.slab { display:flex; align-items:center; gap:6px; }
    input.shard { width:74px; padding:6px; border-radius:6px; border:1px solid #444; background:#000; color:#fff }
    .status { padding:8px; border-radius:4px; text-align:center; font-size:13px; background:rgba(255,255,255,.08) }
    .resize-container { display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:${CONFIG.THEME.primary}; padding:16px; border-radius:8px; z-index:10000; box-shadow:0 0 20px rgba(0,0,0,.5); max-width:90%; max-height:90%; overflow:auto }
    .resize-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); display:none; z-index:9999 }
    .resize-preview { max-width:100%; max-height:300px; margin:10px 0; border:1px solid ${CONFIG.THEME.accent} }
  `;
  document.head.appendChild(style);

  const html = `
    <div class="wplace-header">
      <div><i class="fa-solid fa-image"></i> ${t('title')}</div>
      <button id="minimizeBtn" class="wplace-btn" style="background:none;border:none;color:${CONFIG.THEME.text}" title="${t('minimize')}"><i class="fa-solid fa-minus"></i></button>
    </div>
    <div class="wplace-content">
      <div class="row">
        <button id="initBotBtn"   class="wplace-btn wplace-btn-primary"><i class="fa-solid fa-robot"></i><span>${t('initBot')}</span></button>
        <button id="uploadBtn"    class="wplace-btn wplace-btn-upload" disabled><i class="fa-solid fa-upload"></i><span>${t('uploadImage')}</span></button>
      </div>
      <div class="row">
        <button id="resizeBtn"    class="wplace-btn wplace-btn-primary" disabled><i class="fa-solid fa-expand"></i><span>${t('resizeImage')}</span></button>
        <button id="selectPosBtn" class="wplace-btn wplace-btn-select" disabled><i class="fa-solid fa-crosshairs"></i><span>${t('selectPosition')}</span></button>
      </div>

      <div class="row" style="margin-top:6px">
        <label class="slab">${t('shardTotal')} <input id="shardTotal" class="shard" type="number" min="1" value="1"></label>
        <label class="slab">${t('shardSlot')}  <input id="shardSlot"  class="shard" type="number" min="1" value="1"></label>
      </div>

      <div class="row">
        <button id="startBtn" class="wplace-btn wplace-btn-start" disabled><i class="fa-solid fa-play"></i><span>${t('startPainting')}</span></button>
        <button id="stopBtn"  class="wplace-btn wplace-btn-stop"  disabled><i class="fa-solid fa-stop"></i><span>${t('stopPainting')}</span></button>
      </div>

      <div class="wplace-progress"><div id="progressBar" class="wplace-progress-bar" style="width:0%"></div></div>
      <div class="wplace-stats"><div id="statsArea"><div>${t('initMessage')}</div></div></div>
      <div id="statusText" class="status">${t('waitingInit')}</div>
    </div>
  `;

  const container = document.createElement('div');
  container.id='wplace-image-bot-container';
  container.innerHTML = html;
  document.body.appendChild(container);

  // drag
  const header = container.querySelector('.wplace-header');
  let p1=0,p2=0,p3=0,p4=0;
  header.onmousedown = (e)=>{ if(e.target.closest('#minimizeBtn')) return;
    e.preventDefault(); p3=e.clientX; p4=e.clientY;
    document.onmouseup=()=>{document.onmouseup=null;document.onmousemove=null;};
    document.onmousemove=(ev)=>{ ev.preventDefault(); p1=p3-ev.clientX; p2=p4-ev.clientY; p3=ev.clientX; p4=ev.clientY;
      container.style.top=(container.offsetTop-p2)+'px'; container.style.left=(container.offsetLeft-p1)+'px';
    };
  };

  const resizeOverlay = document.createElement('div'); resizeOverlay.className='resize-overlay';
  const resizeContainer = document.createElement('div'); resizeContainer.className='resize-container';
  resizeContainer.innerHTML = `
    <h3 style="margin:0 0 8px 0">${t('resizeImage')}</h3>
    <div>
      <label>${t('width')}: <span id="widthValue">0</span>px <input id="widthSlider" type="range" min="10" max="1000" value="100" style="width:100%"></label>
      <label>${t('height')}: <span id="heightValue">0</span>px <input id="heightSlider" type="range" min="10" max="1000" value="100" style="width:100%"></label>
      <label><input id="keepAspect" type="checkbox" checked> ${t('keepAspect')}</label>
      <img id="resizePreview" class="resize-preview" src="">
      <div class="row">
        <button id="confirmResize" class="wplace-btn wplace-btn-primary"><i class="fa-solid fa-check"></i> ${t('apply')}</button>
        <button id="cancelResize"  class="wplace-btn wplace-btn-stop"><i class="fa-solid fa-xmark"></i> ${t('cancel')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(resizeOverlay);
  document.body.appendChild(resizeContainer);

  // refs
  const minimizeBtn   = container.querySelector('#minimizeBtn');
  const initBotBtn    = container.querySelector('#initBotBtn');
  const uploadBtn     = container.querySelector('#uploadBtn');
  const resizeBtn     = container.querySelector('#resizeBtn');
  const selectPosBtn  = container.querySelector('#selectPosBtn');
  const startBtn      = container.querySelector('#startBtn');
  const stopBtn       = container.querySelector('#stopBtn');
  const progressBar   = container.querySelector('#progressBar');
  const statsArea     = container.querySelector('#statsArea');
  const statusText    = container.querySelector('#statusText');

  const widthSlider   = resizeContainer.querySelector('#widthSlider');
  const heightSlider  = resizeContainer.querySelector('#heightSlider');
  const widthValue    = resizeContainer.querySelector('#widthValue');
  const heightValue   = resizeContainer.querySelector('#heightValue');
  const keepAspect    = resizeContainer.querySelector('#keepAspect');
  const resizePreview = resizeContainer.querySelector('#resizePreview');
  const confirmResize = resizeContainer.querySelector('#confirmResize');
  const cancelResize  = resizeContainer.querySelector('#cancelResize');

  const shardTotalInp = container.querySelector('#shardTotal');
  const shardSlotInp  = container.querySelector('#shardSlot');

  function updateUI(key, type='default', params={}){
    statusText.textContent = t(key, params);
  }
  async function updateStats(){
    if(!state.colorsChecked || !state.imageLoaded) return;
    const {charges, cooldown} = await WPlace.getCharges();
    state.currentCharges = Math.floor(charges);
    state.cooldown = cooldown;

    const progress = state.totalPixels? Math.round(100*state.paintedPixels/state.totalPixels):0;
    const remaining = Math.max(state.totalPixels - state.paintedPixels, 0);
    state.estimatedTime = calculateEstimatedTime(remaining, state.currentCharges, state.cooldown);
    progressBar.style.width = progress + '%';

    statsArea.innerHTML = `
      <div><b>${t('progress')}:</b> ${progress}%</div>
      <div><b>${t('pixels')}:</b> ${state.paintedPixels}/${state.totalPixels}</div>
      <div><b>${t('charges')}:</b> ${state.currentCharges}</div>
      ${state.imageLoaded ? `<div><b>${t('estimatedTime')}:</b> ${formatTime(state.estimatedTime)}</div>`:''}
      <div><b>Shard:</b> ${state.workerSlot} / ${state.totalWorkers}</div>
    `;
  }

  minimizeBtn.addEventListener('click', ()=>{
    state.minimized=!state.minimized;
    container.querySelector('.wplace-content').style.display = state.minimized?'none':'block';
    minimizeBtn.innerHTML = state.minimized? '<i class="fa-solid fa-expand"></i>' : '<i class="fa-solid fa-minus"></i>';
  });

  initBotBtn.addEventListener('click', async ()=>{
    try{
      updateUI('checkingColors','default');
      state.availableColors = extractAvailableColors();
      if(state.availableColors.length===0){
        showAlert(t('noColorsFound'),'error');
        updateUI('noColorsFound','error');
        return;
      }
      state.colorsChecked = true;
      uploadBtn.disabled = false;
      selectPosBtn.disabled = false;
      initBotBtn.style.display='none';
      updateUI('colorsFound','success',{count:state.availableColors.length});
      updateStats();
    }catch{ updateUI('imageError','error'); }
  });

  uploadBtn.addEventListener('click', async ()=>{
    try{
      updateUI('loadingImage','default');
      const input=document.createElement('input'); input.type='file'; input.accept='image/png,image/jpeg';
      input.onchange = async ()=>{
        const fr=new FileReader();
        fr.onload = async ()=>{
          const proc=new ImageProcessor(fr.result);
          await proc.load();
          const {width,height} = proc.getDimensions();
          const pixels = proc.getPixelData();
          let total=0;
          for(let y=0;y<height;y++) for(let x=0;x<width;x++){
            const i=4*(y*width+x); const a=pixels[i+3]; if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
            const r=pixels[i],g=pixels[i+1],b=pixels[i+2]; if(isWhitePixel(r,g,b)) continue; total++;
          }
          state.imageData = { width,height,pixels,totalPixels:total, processor:proc };
          state.totalPixels = total; state.paintedPixels=0; state.imageLoaded=true; state.lastPosition={x:0,y:0};
          resizeBtn.disabled=false; if(state.startPosition) startBtn.disabled=false;
          updateStats(); updateUI('imageLoaded','success',{count:total});
        };
        fr.readAsDataURL(input.files[0]);
      };
      input.click();
    }catch{ updateUI('imageError','error'); }
  });

  // Resize dialog
  function openResize(proc){
    const {width,height} = proc.getDimensions();
    const AR = width/height;
    widthSlider.value = width; heightSlider.value = height;
    widthValue.textContent = width; heightValue.textContent = height;
    resizePreview.src = proc.img.src;
    const updatePreview = ()=>{ const w=+widthSlider.value, h=+heightSlider.value; widthValue.textContent=w; heightValue.textContent=h; resizePreview.src = proc.previewDataURL(w,h); };
    widthSlider.oninput = ()=>{ if(keepAspect.checked){ const w=+widthSlider.value; heightSlider.value = Math.round(w/AR); } updatePreview(); };
    heightSlider.oninput= ()=>{ if(keepAspect.checked){ const h=+heightSlider.value; widthSlider.value = Math.round(h*AR); } updatePreview(); };
    confirmResize.onclick = ()=>{
      const w=+widthSlider.value, h=+heightSlider.value;
      const px = proc.resize(w,h);
      let total=0;
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const i=4*(y*w+x), a=px[i+3]; if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
        const r=px[i],g=px[i+1],b=px[i+2]; if(isWhitePixel(r,g,b)) continue; total++;
      }
      state.imageData.pixels=px; state.imageData.width=w; state.imageData.height=h; state.imageData.totalPixels=total;
      state.totalPixels=total; state.paintedPixels=0;
      updateStats(); updateUI('resizeSuccess','success',{width:w,height:h});
      resizeOverlay.style.display='none'; resizeContainer.style.display='none';
    };
    cancelResize.onclick = ()=>{ resizeOverlay.style.display='none'; resizeContainer.style.display='none'; };
    resizeOverlay.style.display='block'; resizeContainer.style.display='block';
  }
  resizeBtn.addEventListener('click', ()=>{ if(state.imageLoaded && state.imageData.processor) openResize(state.imageData.processor); });

  // Select position (intercept fetch as en tu script)
  selectPosBtn.addEventListener('click', async ()=>{
    if(state.selectingPosition) return;
    state.selectingPosition = true; state.startPosition=null; state.region=null; startBtn.disabled=true;
    showAlert(t('selectPositionAlert'),'info'); updateUI('waitingPosition','default');
    const originalFetch = window.fetch;
    window.fetch = async (url, options)=>{
      if(typeof url==='string' && url.includes('https://backend.wplace.live/s0/pixel/') && options?.method?.toUpperCase()==='POST'){
        try{
          const res = await originalFetch(url, options);
          const clone = res.clone(); const data = await clone.json();
          if(data?.painted===1){
            const m=url.match(/\/pixel\/(\d+)\/(\d+)/);
            if(m){ state.region={x:parseInt(m[1]), y:parseInt(m[2])}; }
            const body=JSON.parse(options.body||'{}');
            if(body?.coords){ state.startPosition={x:body.coords[0], y:body.coords[1]}; state.lastPosition={x:0,y:0}; }
            window.fetch=originalFetch; state.selectingPosition=false; updateUI('positionSet','success');
            if(state.imageLoaded) startBtn.disabled=false;
          }
          return res;
        }catch{ return originalFetch(url,options); }
      }
      return originalFetch(url,options);
    };
    setTimeout(()=>{ if(state.selectingPosition){ window.fetch=originalFetch; state.selectingPosition=false; updateUI('positionTimeout','error'); showAlert(t('positionTimeout'),'error'); } }, 120000);
  });

  // Sharding inputs
  shardTotalInp.addEventListener('change', ()=>{
    state.totalWorkers = Math.max(1, parseInt(shardTotalInp.value)||1);
    if(state.workerSlot>state.totalWorkers) { state.workerSlot=state.totalWorkers; shardSlotInp.value=state.workerSlot; }
    updateStats();
  });
  shardSlotInp.addEventListener('change', ()=>{
    state.workerSlot = Math.max(1, Math.min(state.totalWorkers, parseInt(shardSlotInp.value)||1));
    updateStats();
  });

  // Start/stop
  startBtn.addEventListener('click', async ()=>{
    if(!state.imageLoaded || !state.startPosition || !state.region){ updateUI('missingRequirements','error'); return; }
    state.running=true; state.stopFlag=false;
    startBtn.disabled=true; stopBtn.disabled=false; uploadBtn.disabled=true; selectPosBtn.disabled=true; resizeBtn.disabled=true;
    updateUI('startPaintingMsg','success');
    try{ await processImage(); }catch{ updateUI('paintingError','error'); }
    finally{
      state.running=false; stopBtn.disabled=true;
      if(!state.stopFlag){ startBtn.disabled=true; uploadBtn.disabled=false; selectPosBtn.disabled=false; resizeBtn.disabled=false; }
      else{ startBtn.disabled=false; }
    }
  });
  stopBtn.addEventListener('click', ()=>{ state.stopFlag=true; state.running=false; stopBtn.disabled=true; updateUI('paintingStopped','warning'); });

  // initial stats
  updateStats();

  // minimize state
  const content = container.querySelector('.wplace-content');
  minimizeBtn.addEventListener('click', ()=>{
    state.minimized=!state.minimized;
    content.style.display = state.minimized?'none':'block';
    minimizeBtn.innerHTML = state.minimized? '<i class="fa-solid fa-expand"></i>' : '<i class="fa-solid fa-minus"></i>';
  });
}

/* ---------- Core painting with SHARDING ---------- */
async function processImage(){
  const {width,height,pixels} = state.imageData;
  const {x:startX, y:startY} = state.startPosition;
  const {x:regionX, y:regionY} = state.region;

  let startRow = state.lastPosition.y||0;
  let startCol = state.lastPosition.x||0;
  let validIdx = 0; // índice global de píxeles válidos (misma imagen/filtros en todas)

  outer:
  for(let y=startRow; y<height; y++){
    for(let x=(y===startRow? startCol:0); x<width; x++){
      if(state.stopFlag){ state.lastPosition={x,y}; updateUI('paintingPaused','warning',{x,y}); break outer; }

      const i=4*(y*width+x);
      const r=pixels[i], g=pixels[i+1], b=pixels[i+2], a=pixels[i+3];
      if(a<CONFIG.TRANSPARENCY_THRESHOLD) continue;
      if(isWhitePixel(r,g,b)) continue;

      // SHARD FILTER
      validIdx++;
      if( (validIdx-1) % state.totalWorkers !== (state.workerSlot-1) ){
        continue; // este pixel lo pinta otra de tus cuentas
      }

      // Charges
      if(state.currentCharges < 1){
        updateUI('noCharges','warning',{time:formatTime(state.cooldown)});
        await sleep(state.cooldown);
        const upd = await WPlace.getCharges();
        state.currentCharges = Math.floor(upd.charges); state.cooldown = upd.cooldown;
      }

      const colorId = findClosestColor([r,g,b], state.availableColors);
      const px = startX + x, py = startY + y;
      const ok = await WPlace.paintPixelInRegion(regionX, regionY, px, py, colorId);
      if(ok){
        state.paintedPixels++;
        state.currentCharges = Math.max(0, state.currentCharges-1);
        if(state.paintedPixels % CONFIG.LOG_INTERVAL===0){
          await updateStats();
          updateUI('paintingProgress','default',{painted:state.paintedPixels,total:state.totalPixels});
        }
      }
    }
  }

  if(state.stopFlag){ updateUI('paintingStopped','warning'); }
  else{ updateUI('paintingComplete','success',{count:state.paintedPixels}); state.lastPosition={x:0,y:0}; }
  await updateStats();
}

/* ---------- boot ---------- */
createUI();

})();
