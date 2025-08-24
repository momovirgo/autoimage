/* WPLACE AUTO-IMAGE (SHARDED, FIX) – 24/08/2025
 * - Reutiliza el request real de WPlace (headers/Turnstile + query/body)
 * - Paleta por getComputedStyle (incluye blanco id=5, excluye solo borrador id=0)
 * - Reescalado sin suavizado
 * - Sharding local vía BroadcastChannel para múltiples cuentas/ventanas
 * Autor: tú + yo :)
 */
(async () => {
  // ------------------ CONFIG ------------------
  const CONFIG = {
    COOLDOWN_FALLBACK: 31000,
    TRANSPARENCY_THRESHOLD: 1,
    LOG_EVERY: 25,
    TEAM_CHANNEL_PREFIX: 'wplace-team-',
    UI_THEME: {
      bg: '#101014',
      panel: '#161821',
      ink: '#e6e6f0',
      accent: '#7c5cff',
      warn: '#ffae42',
      ok: '#00d98b',
      err: '#ff5a5a',
      border: '#242637'
    }
  };

  // ------------------ STATE ------------------
  const S = {
    // ui
    ready: false,
    minimized: false,
    // image
    imageData: null, // { w, h, pixels:Uint8ClampedArray }
    scaled: null, // { w,h,pixels }
    total: 0,
    painted: 0,
    // place
    palette: [],
    havePalette: false,
    region: null,         // {rx, ry}
    anchor: null,         // {ax, ay} pixel top-left
    lastPos: {x:0, y:0},
    // charges
    charges: 0,
    cooldown: CONFIG.COOLDOWN_FALLBACK,
    // run
    running: false,
    stopFlag: false,
    // template (captured real request)
    paintTemplate: null,  // { baseUrl, method, useQueryXY, schema, headers, credentials, mode, contentType }
    // team
    teamId: null,
    role: 'member',       // 'leader' | 'member'
    shard: null,          // {x0,y0,w,h}
    channel: null,
  };

  // ------------------ UTILS ------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fmtTime = (ms) => {
    const s = Math.floor(ms/1000)%60;
    const m = Math.floor(ms/60000)%60;
    const h = Math.floor(ms/3600000);
    return `${h?`${h}h `:''}${m?`${m}m `:''}${s}s`;
  };
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));

  // Manhattan distance faster than Euclidean and suficiente para paleta pequeña
  const colorDist = (a,b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);

  // ------------------ PALETA ------------------
  function readPalette() {
    const els = Array.from(document.querySelectorAll('[id^="color-"]'));
    if (!els.length) return [];
    const list = [];
    for (const el of els) {
      const id = parseInt(el.id.replace('color-',''),10);
      if (Number.isNaN(id)) continue;
      if (id === 0) continue;             // solo excluimos borrador
      // usar estilo computado (no inline) para obtener rgb
      const rgbStr = getComputedStyle(el).backgroundColor;
      const m = rgbStr && rgbStr.match(/\d+/g);
      const rgb = m ? m.slice(0,3).map(Number) : [0,0,0];
      list.push({id, rgb});
    }
    // ordenar por id por si el DOM viene mezclado
    list.sort((a,b)=>a.id-b.id);
    return list;
  }

  function nearestColorId(rgb) {
    let best = S.palette[0], bestD = 1e9;
    for (const c of S.palette) {
      const d = colorDist(rgb, c.rgb);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best?.id ?? 1;
  }

  // ------------------ CARGAS ------------------
  async function getCharges() {
    try {
      const res = await fetch('https://backend.wplace.live/me', {credentials:'include'});
      const data = await res.json();
      S.charges = Math.floor(data?.charges?.count ?? 0);
      S.cooldown = data?.charges?.cooldownMs ?? CONFIG.COOLDOWN_FALLBACK;
    } catch {
      // fallback
      S.charges = 0;
      S.cooldown = CONFIG.COOLDOWN_FALLBACK;
    }
  }

  // ------------------ CAPTURA REQUEST REAL ------------------
  // Cuando hagas un click manual en un píxel, clonamos ese request tal cual.
  function armCaptureOnceForPaintRequest(onCaptured) {
    const orig = window.fetch;
    window.fetch = async (url, options) => {
      try {
        if (typeof url === 'string' &&
            url.includes('/s0/pixel/') &&
            options?.method?.toUpperCase() === 'POST') {
          const parsed = new URL(url);
          const m = parsed.pathname.match(/\/s0\/pixel\/(\d+)\/(\d+)/);
          const rx = m ? parseInt(m[1],10) : null;
          const ry = m ? parseInt(m[2],10) : null;

          // lee body (string)
          let bodyText = '';
          try { bodyText = typeof options.body === 'string' ? options.body : ''; } catch {}
          let schema = 'unknown';
          let useQueryXY = false;
          let contentType = '';
          try {
            const h = new Headers(options.headers || {});
            contentType = h.get('content-type') || '';
            const qpX = parsed.searchParams.get('x');
            const qpY = parsed.searchParams.get('y');
            if (qpX !== null && qpY !== null) useQueryXY = true;

            if (bodyText) {
              try {
                const json = JSON.parse(bodyText);
                if (Array.isArray(json?.coords) && Array.isArray(json?.colors)) schema = 'coordsColors';
                else if ('x' in json && 'y' in json && 'color' in json) schema = 'xyColor';
                else if ('color' in json) schema = 'colorOnly';
              } catch { /* ignore */ }
            } else {
              // Algunos clientes mandan solo query + color en header personalizado—lo manejamos luego
              if (useQueryXY) schema = 'queryOnly';
            }

            const tpl = {
              baseUrl: 'https://backend.wplace.live/s0/pixel',
              method: 'POST',
              useQueryXY,
              schema,
              headers: Array.from(h.entries()),   // guardo como pares
              credentials: options.credentials || 'include',
              mode: options.mode || 'cors',
              contentType,
              regionFromCapture: (rx!==null&&ry!==null) ? {rx,ry} : null
            };
            window.fetch = orig; // restaurar
            onCaptured(tpl, parsed, options);
          } catch {
            window.fetch = orig;
          }
        }
      } finally {
        return orig(url, options);
      }
    };
  }

  // ------------------ PINTAR (USANDO LA PLANTILLA) ------------------
  async function paintOnePixel(regionX, regionY, pixelX, pixelY, colorId) {
    if (!S.paintTemplate) return {ok:false, status:'no-template'};
    const tpl = S.paintTemplate;

    const headers = new Headers(tpl.headers || []);
    // Nos aseguramos de content-type coherente si hay body
    let url = `${tpl.baseUrl}/${regionX}/${regionY}`;
    let body = null;

    if (tpl.useQueryXY) {
      const u = new URL(url);
      u.searchParams.set('x', String(pixelX));
      u.searchParams.set('y', String(pixelY));
      url = u.toString();
    }

    // Construyo body según el esquema detectado
    if (tpl.schema === 'coordsColors') {
      body = JSON.stringify({ coords: [pixelX, pixelY], colors: [colorId] });
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
    } else if (tpl.schema === 'xyColor') {
      body = JSON.stringify({ x: pixelX, y: pixelY, color: colorId });
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
    } else if (tpl.schema === 'colorOnly') {
      body = JSON.stringify({ color: colorId });
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
    } else if (tpl.schema === 'queryOnly') {
      // sin body, color podría ir en header si el server lo usa — probamos en body también
      body = JSON.stringify({ color: colorId });
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
    } else {
      // fallback compatible con bots conocidos
      body = JSON.stringify({ coords: [pixelX, pixelY], colors: [colorId] });
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: tpl.credentials || 'include',
        mode: tpl.mode || 'cors',
        headers,
        body
      });

      // si es 401/403 puede ser token caducado
      if (!res.ok) {
        return {ok:false, status:`http-${res.status}`};
      }
      const data = await res.json().catch(()=> ({}));
      // WPlace devuelve típicamente { painted: 1 }
      const painted = (data?.painted === 1) || (data?.success === true);
      return {ok: painted, status: painted ? 'ok' : 'no-painted', data};
    } catch (e) {
      return {ok:false, status:'fetch-error'};
    }
  }

  // ------------------ IMAGEN ------------------
  async function pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    return new Promise((resolve, reject) => {
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return reject(new Error('no file'));
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(f);
      };
      input.click();
    });
  }

  async function loadImageToPixels(dataUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej)=> {
      img.onload = res;
      img.onerror = rej;
      img.src = dataUrl;
    });
    // Canvas base (sin suavizado)
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);

    const { data } = ctx.getImageData(0,0,c.width,c.height);
    return { w: c.width, h: c.height, pixels: data };
  }

  function scaleNearest(src, W, H) {
    // Reescalado nearest-neighbor (sin suavizado)
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    const tmp = document.createElement('canvas');
    tmp.width = src.w; tmp.height = src.h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = false;

    const imgData = new ImageData(new Uint8ClampedArray(src.pixels), src.w, src.h);
    tctx.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0,0,src.w,src.h, 0,0,W,H);

    const out = ctx.getImageData(0,0,W,H).data;
    return { w: W, h: H, pixels: out };
  }

  // ------------------ UI ------------------
  function buildUI() {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed; z-index: 999999; top: 20px; right: 20px;
      width: 340px; background: ${CONFIG.UI_THEME.panel}; color: ${CONFIG.UI_THEME.ink};
      border: 1px solid ${CONFIG.UI_THEME.border}; border-radius: 10px; font-family: ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,.45); overflow: hidden;
    `;
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;background:${CONFIG.UI_THEME.bg};padding:10px 12px;">
        <div style="font-weight:700">WPlace Auto-Image (Sharded • FIX)</div>
        <div>
          <button id="wp-min" style="background:none;border:none;color:${CONFIG.UI_THEME.ink};cursor:pointer">—</button>
        </div>
      </div>
      <div id="wp-body" style="padding:12px;display:block">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <input id="wp-team" placeholder="Team ID" style="grid-column:span 2;padding:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#0e0f13;color:${CONFIG.UI_THEME.ink};border-radius:8px">
          <button id="wp-join" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#151725;color:${CONFIG.UI_THEME.ink};cursor:pointer">Unirse al equipo</button>
          <button id="wp-lead" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:${CONFIG.UI_THEME.accent};color:#fff;cursor:pointer">Soy líder</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <button id="wp-check" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#151725;color:${CONFIG.UI_THEME.ink};cursor:pointer">Detectar paleta</button>
          <button id="wp-load" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#151725;color:${CONFIG.UI_THEME.ink};cursor:pointer">Subir imagen</button>
          <label style="display:flex;gap:6px;align-items:center;grid-column:span 2">
            W:<input id="wp-w" type="number" min="1" value="64" style="width:80px;padding:6px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#0e0f13;color:${CONFIG.UI_THEME.ink}">
            H:<input id="wp-h" type="number" min="1" value="64" style="width:80px;padding:6px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#0e0f13;color:${CONFIG.UI_THEME.ink}">
            <button id="wp-res" style="margin-left:auto;padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:#151725;color:${CONFIG.UI_THEME.ink};cursor:pointer">Redimensionar</button>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <button id="wp-anchor" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:${CONFIG.UI_THEME.warn};color:#111;cursor:pointer">Elegir posición (haz 1 click)</button>
          <button id="wp-start" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:${CONFIG.UI_THEME.ok};color:#111;cursor:pointer" disabled>Iniciar</button>
          <button id="wp-stop" style="padding:8px;border-radius:8px;border:1px solid ${CONFIG.UI_THEME.border};background:${CONFIG.UI_THEME.err};color:#111;cursor:pointer" disabled>Parar</button>
        </div>

        <div id="wp-status" style="font-size:12px;opacity:.9;line-height:1.5"></div>
        <div id="wp-progress" style="height:8px;background:#1d1f2b;border-radius:6px;overflow:hidden;margin-top:8px">
          <div id="wp-bar" style="width:0%;height:100%;background:${CONFIG.UI_THEME.accent}"></div>
        </div>
      </div>
    `;
    document.body.appendChild(box);

    const body = box.querySelector('#wp-body');
    box.querySelector('#wp-min').onclick = () => {
      S.minimized = !S.minimized;
      body.style.display = S.minimized ? 'none' : 'block';
    };

    // refs
    const elTeam = box.querySelector('#wp-team');
    const elJoin = box.querySelector('#wp-join');
    const elLead = box.querySelector('#wp-lead');
    const elCheck = box.querySelector('#wp-check');
    const elLoad = box.querySelector('#wp-load');
    const elW = box.querySelector('#wp-w');
    const elH = box.querySelector('#wp-h');
    const elRes = box.querySelector('#wp-res');
    const elAnchor = box.querySelector('#wp-anchor');
    const elStart = box.querySelector('#wp-start');
    const elStop = box.querySelector('#wp-stop');
    const elStatus = box.querySelector('#wp-status');
    const elBar = box.querySelector('#wp-bar');

    function status(html) { elStatus.innerHTML = html; }
    function setBar(p) { elBar.style.width = `${clamp(p,0,100)}%`; }

    // ---- Team
    elJoin.onclick = () => {
      const id = (elTeam.value||'').trim();
      if (!id) { alert('Pon un Team ID'); return; }
      S.teamId = id;
      S.channel = new BroadcastChannel(CONFIG.TEAM_CHANNEL_PREFIX + id);
      S.channel.onmessage = onTeamMsg;
      status(`✅ Unido al equipo <b>${id}</b>. Ahora puedes ser líder o esperar shards.`);
    };
    elLead.onclick = () => {
      if (!S.channel) { alert('Primero “Unirse al equipo”'); return; }
      S.role = 'leader';
      status(`⭐ Modo líder activo. Sube imagen, detecta paleta y elige posición.`);
    };

    // ---- Paleta
    elCheck.onclick = () => {
      S.palette = readPalette();
      S.havePalette = S.palette.length > 0;
      status(S.havePalette
        ? `🎨 Paleta detectada: ${S.palette.length} colores`
        : `❌ Abre la paleta de colores en el sitio y vuelve a intentar`);
    };

    // ---- Imagen
    elLoad.onclick = async () => {
      try {
        const dataUrl = await pickImage();
        S.imageData = await loadImageToPixels(dataUrl);
        S.scaled = S.imageData;
        S.total = countDrawablePixels(S.scaled);
        S.painted = 0;
        setBar(0);
        status(`🖼️ Imagen cargada ${S.scaled.w}×${S.scaled.h}. Pixels a pintar: ${S.total}`);
      } catch {
        status(`❌ Error al cargar imagen`);
      }
    };
    elRes.onclick = () => {
      if (!S.imageData) { alert('Primero sube una imagen'); return; }
      const W = Math.max(1, parseInt(elW.value||'0',10));
      const H = Math.max(1, parseInt(elH.value||'0',10));
      S.scaled = scaleNearest(S.imageData, W, H);
      S.total = countDrawablePixels(S.scaled);
      S.painted = 0;
      setBar(0);
      status(`🔧 Redimensionado a ${W}×${H}. Pixels a pintar: ${S.total}`);
    };

    // ---- Anchor (captura template)
    elAnchor.onclick = () => {
      alert('PINTA 1 PIXEL A MANO donde vaya la ESQUINA SUPERIOR IZQUIERDA.\nVoy a copiar el request real para usar tu mismo token.');
      armCaptureOnceForPaintRequest((tpl, parsedUrl, opts) => {
        S.paintTemplate = tpl;
        // región desde URL capturada
        const mm = parsedUrl.pathname.match(/\/s0\/pixel\/(\d+)\/(\d+)/);
        if (mm) {
          S.region = { rx: parseInt(mm[1],10), ry: parseInt(mm[2],10) };
        }
        // extrae coords del click de referencia
        let ax = null, ay = null;
        if (tpl.useQueryXY) {
          ax = parseInt(parsedUrl.searchParams.get('x'),10);
          ay = parseInt(parsedUrl.searchParams.get('y'),10);
        } else {
          try {
            const bodyText = typeof opts.body === 'string' ? opts.body : '';
            const j = bodyText ? JSON.parse(bodyText) : null;
            if (j) {
              if (Array.isArray(j.coords)) { ax = j.coords[0]; ay = j.coords[1]; }
              else if ('x' in j && 'y' in j) { ax = j.x; ay = j.y; }
            }
          } catch {}
        }
        if (ax!=null && ay!=null) {
          S.anchor = { ax, ay };
          status(`📌 Posición definida. Región [${S.region.rx},${S.region.ry}] • Ancla (${ax},${ay}) • schema=${tpl.schema} ${tpl.useQueryXY?'(queryXY)':''}`);
          elStart.disabled = !S.havePalette || !S.scaled;
        } else {
          alert('No pude leer las coordenadas del click. Repite el “Elegir posición”.');
        }
      });
    };

    // ---- RUN
    elStart.onclick = async () => {
      if (!S.havePalette || !S.scaled || !S.anchor || !S.region || !S.paintTemplate) {
        alert('Falta paleta, imagen, posición o template de pintado.');
        return;
      }
      S.running = true; S.stopFlag = false;
      elStart.disabled = true; elStop.disabled = false;
      // si líder, distribuir shards
      if (S.role === 'leader' && S.channel) {
        const N = 1; // se autocalcula por viewers, pero usamos dinámica: quien se una recibe shard
        // Enviamos metaframe de imagen a todos: dims y preview mínima
        S.channel.postMessage({t:'meta', w:S.scaled.w, h:S.scaled.h});
        // El líder también se auto-asigna un shard después
      }
      runLoop(status, setBar).finally(()=>{
        elStop.disabled = true; elStart.disabled = false;
      });
    };
    elStop.onclick = () => {
      S.stopFlag = true;
    };

    S.ready = true;
    status('Listo. Recuerda: detecta paleta → sube/ajusta imagen → elige posición (1 click) → Iniciar.');
  }

  // ------------------ TEAM MESSAGING ------------------
  function onTeamMsg(ev) {
    const m = ev.data;
    if (!m || !m.t) return;
    if (m.t === 'meta') {
      // el líder anuncia dimensiones; cada miembro pide shard
      if (S.role !== 'leader') {
        // pido shard
        S.channel.postMessage({t:'needShard'});
      }
    } else if (m.t === 'giveShard' && S.role !== 'leader') {
      S.shard = m.shard; // {x0,y0,w,h}
    } else if (m.t === 'templateUpdate') {
      // por si líder recaptura headers/turnstile
      S.paintTemplate = m.tpl;
    }
  }

  // En líder: al recibir needShard, asignar siguiente bloque
  if (!window.__WPLACE_SHARD_ASSIGNER__) {
    window.__WPLACE_SHARD_ASSIGNER__ = { next: {x0:0,y0:0} };
  }
  function assignNextShard(totalW, totalH) {
    // Strategy: columnas por filas de 1px de alto? mejor bloques horizontales
    const stripeH = Math.max(1, Math.floor(totalH / 4)); // 4 franjas por defecto
    const s = window.__WPLACE_SHARD_ASSIGNER__;
    const shard = { x0: 0, y0: s.next.y0, w: totalW, h: Math.min(stripeH, totalH - s.next.y0) };
    s.next.y0 += shard.h;
    return shard.h > 0 ? shard : null;
  }

  // ------------------ CONTEO PIXELS DIBUJABLES ------------------
  function countDrawablePixels(buf) {
    const { w,h,pixels } = buf;
    let cnt = 0;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const idx = (y*w + x)*4;
      const a = pixels[idx+3];
      if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue;
      // ya NO saltamos el blanco: se pinta con id=5 si corresponde
      cnt++;
    }
    return cnt;
  }

  // ------------------ LOOP PRINCIPAL ------------------
  async function runLoop(status, setBar) {
    const regionX = S.region.rx;
    const regionY = S.region.ry;
    const baseAx = S.anchor.ax;
    const baseAy = S.anchor.ay;

    // shard actual
    let x0=0,y0=0,W=S.scaled.w,H=S.scaled.h;
    if (S.role === 'leader' && S.channel) {
      // atender solicitudes de shards
      const handler = (ev) => {
        const m = ev.data;
        if (m?.t === 'needShard') {
          const sh = assignNextShard(S.scaled.w, S.scaled.h);
          if (sh) S.channel.postMessage({t:'giveShard', shard: sh});
        }
      };
      S.channel.addEventListener('message', handler);
      // el líder también se pinta su propia franja inicial:
      const myShard = assignNextShard(S.scaled.w, S.scaled.h) || {x0:0,y0:0,w:S.scaled.w,h:S.scaled.h};
      x0=myShard.x0; y0=myShard.y0; W=myShard.w; H=myShard.h;
    } else if (S.shard) {
      x0=S.shard.x0; y0=S.shard.y0; W=S.shard.w; H=S.shard.h;
    }

    status(`🎨 Pintando shard x0=${x0}, y0=${y0}, w=${W}, h=${H}…`);

    // recorrido fila-columna
    for (let y=0; y<H; y++) {
      for (let x=0; x<W; x++) {
        if (S.stopFlag) { status(`⏸️ Pausado en (${x0+x}, ${y0+y})`); return; }
        const idx = ((y0+y)*S.scaled.w + (x0+x))*4;
        const r = S.scaled.pixels[idx];
        const g = S.scaled.pixels[idx+1];
        const b = S.scaled.pixels[idx+2];
        const a = S.scaled.pixels[idx+3];
        if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue;

        const colorId = nearestColorId([r,g,b]);

        // charges
        if (S.charges <= 0) {
          await getCharges();
          if (S.charges <= 0) {
            status(`⌛ Sin cargas. Esperando ${fmtTime(S.cooldown)}…`);
            await sleep(S.cooldown);
            await getCharges();
          }
        }

        const ok = await paintOnePixel(regionX, regionY, baseAx + x0 + x, baseAy + y0 + y, colorId);
        if (ok.ok) {
          S.painted++; S.charges--;
          if ((S.painted % CONFIG.LOG_EVERY) === 0) {
            const p = Math.round(100 * S.painted / S.total);
            setBar(p);
            status(`🧱 Progreso ${S.painted}/${S.total} (${p}%)`);
          }
        } else {
          // Si falla por token (403), pedimos recaptura
          if (/http-40[13]/.test(ok.status)) {
            status(`🔒 Token vencido. Haz 1 click manual para recapturar…`);
            if (S.channel && S.role === 'leader') {
              // avisar a miembros (opcional)
              S.channel.postMessage({t:'needRecapture'});
            }
            await new Promise(res => {
              armCaptureOnceForPaintRequest((tpl) => {
                S.paintTemplate = tpl;
                // broadcast nueva plantilla
                if (S.channel && S.role === 'leader') {
                  S.channel.postMessage({t:'templateUpdate', tpl});
                }
                res();
              });
            });
            // reintenta una vez
            const retry = await paintOnePixel(regionX, regionY, baseAx + x0 + x, baseAy + y0 + y, colorId);
            if (!retry.ok) {
              // si sigue mal, avanza para no bloquear
              await sleep(150);
            }
          } else {
            // otros errores: avanzar
            await sleep(100);
          }
        }
      }
    }

    setBar(100);
    status(`✅ Shard terminado. Pintados: ${S.painted}.`);
  }

  // ------------------ START ------------------
  buildUI();
  // Autodetect paleta al abrir UI para que no te olvides
  S.palette = readPalette();
  S.havePalette = S.palette.length > 0;

})();
