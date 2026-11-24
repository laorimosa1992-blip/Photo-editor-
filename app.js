import { adjustPixels, isIdentity } from './imgproc.js';

// ---------------------------------------------------------------- константы
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const BG_ID = 'briaai/RMBG-1.4';
const UP_ID = 'Xenova/swin2SR-classical-sr-x2-64';
const MAX_WORK = 3072;      // рабочий размер фото (длинная сторона), чтобы не упереться в память телефона
const PREVIEW_MAX = 1280;   // размер предпросмотра
const HISTORY_MAX = 5;
const PROC_CFG = {
  do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
  image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1],
  feature_extractor_type: 'ImageFeatureExtractor', resample: 2,
  rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 },
};
const ADJ0 = { brightness: 0, contrast: 0, saturation: 0, blur: 0, sharpen: 0, preset: 'none' };

// ---------------------------------------------------------------- состояние
const S = {
  current: null, preview: null, history: [], tab: 'crop', busy: false,
  adj: { ...ADJ0 },
  crop: { l: 0, t: 0, r: 0, b: 0 },
  text: { text: '', size: 8, x: 50, y: 85, color: '#ffffff', outline: true },
};

// ---------------------------------------------------------------- утилиты
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const setStatus = t => { $('#status').textContent = t; };
const toBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
const cloneCanvas = c => { const n = mk(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };
function resize(c, k) {
  const n = mk(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
  const x = n.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(c, 0, 0, n.width, n.height);
  return n;
}
function rawToCanvas(img) {
  const { width: w, height: h, channels: ch, data } = img;
  const c = mk(w, h), x = c.getContext('2d'), id = x.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (ch === 1) { id.data[j] = id.data[j + 1] = id.data[j + 2] = data[i]; id.data[j + 3] = 255; }
    else {
      id.data[j] = data[i * ch]; id.data[j + 1] = data[i * ch + 1]; id.data[j + 2] = data[i * ch + 2];
      id.data[j + 3] = ch === 4 ? data[i * ch + 3] : 255;
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}

async function busy(fn) {
  if (S.busy) return;
  S.busy = true;
  document.body.classList.add('busy');
  try { await fn(); }
  catch (e) {
    console.error(e);
    setStatus('Ошибка: ' + (e.message || e) + (navigator.onLine ? '' : ' (вы офлайн: сначала подготовьте модели при наличии интернета)'));
  } finally {
    S.busy = false;
    document.body.classList.remove('busy');
  }
}

// ---------------------------------------------------------------- отрисовка
let checker;
function drawChecker(x, w, h) {
  if (!checker) {
    const c = mk(20, 20), k = c.getContext('2d');
    k.fillStyle = '#2a2d34'; k.fillRect(0, 0, 20, 20);
    k.fillStyle = '#363a43'; k.fillRect(0, 0, 10, 10); k.fillRect(10, 10, 10, 10);
    checker = x.createPattern(c, 'repeat');
  }
  x.fillStyle = checker; x.fillRect(0, 0, w, h);
}

function process(src, p) {
  if (isIdentity(p)) return src;
  const w = src.width, h = src.height, c = mk(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, w, h);
  x.putImageData(new ImageData(adjustPixels(img.data, w, h, p), w, h), 0, 0);
  return c;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45;
}
function drawText(x, w, h, t) {
  if (!t.text) return;
  const fs = (h * t.size) / 100;
  x.save();
  x.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const px = (w * t.x) / 100, py = (h * t.y) / 100;
  if (t.outline) {
    x.lineWidth = fs / 7; x.lineJoin = 'round';
    x.strokeStyle = isLight(t.color) ? '#000' : '#fff';
    x.strokeText(t.text, px, py);
  }
  x.fillStyle = t.color;
  x.fillText(t.text, px, py);
  x.restore();
}

function drawCropOverlay(x, w, h) {
  const { l, t, r, b } = S.crop;
  if (!l && !t && !r && !b) return;
  const L = (w * l) / 100, T = (h * t) / 100, R = w * (1 - r / 100), B = h * (1 - b / 100);
  x.fillStyle = 'rgba(0,0,0,.55)';
  x.fillRect(0, 0, w, T); x.fillRect(0, B, w, h - B);
  x.fillRect(0, T, L, B - T); x.fillRect(R, T, w - R, B - T);
  x.strokeStyle = '#fff'; x.lineWidth = Math.max(2, w / 400);
  x.strokeRect(L, T, R - L, B - T);
  x.lineWidth = Math.max(1, w / 800); x.globalAlpha = .5;
  for (let i = 1; i < 3; i++) {
    x.beginPath(); x.moveTo(L + ((R - L) * i) / 3, T); x.lineTo(L + ((R - L) * i) / 3, B); x.stroke();
    x.beginPath(); x.moveTo(L, T + ((B - T) * i) / 3); x.lineTo(R, T + ((B - T) * i) / 3); x.stroke();
  }
  x.globalAlpha = 1;
}

function render() {
  const v = $('#view'), p = S.preview;
  if (!p) { document.body.classList.remove('has-img'); return; }
  document.body.classList.add('has-img');
  if (v.width !== p.width || v.height !== p.height) { v.width = p.width; v.height = p.height; }
  const x = v.getContext('2d');
  drawChecker(x, p.width, p.height);
  x.drawImage(S.tab === 'adjust' ? process(p, S.adj) : p, 0, 0);
  if (S.tab === 'text') drawText(x, p.width, p.height, S.text);
  if (S.tab === 'crop') drawCropOverlay(x, p.width, p.height);
}
let raf = 0;
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

// ---------------------------------------------------------------- документ и история
function buildPreview() {
  const c = S.current, k = Math.min(1, PREVIEW_MAX / Math.max(c.width, c.height));
  S.preview = k === 1 ? c : resize(c, k);
}
function updateUndo() { $('#undo').disabled = !S.history.length; }
function updateButtons() { $('#save').disabled = !S.current; }

function setCurrent(c, push = true) {
  if (push && S.current) {
    S.history.push(S.current);
    if (S.history.length > HISTORY_MAX) S.history.shift();
  }
  S.current = c;
  S.crop = { l: 0, t: 0, r: 0, b: 0 };
  buildPreview(); syncUI(); updateUndo(); updateButtons(); updateExpInfo(); render();
}

$('#undo').addEventListener('click', () => {
  const p = S.history.pop();
  if (!p) return;
  S.current = p; S.crop = { l: 0, t: 0, r: 0, b: 0 };
  buildPreview(); syncUI(); updateUndo(); updateExpInfo(); render();
  setStatus('Отменено');
});

function loadImage(f) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(f), i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); res(i); };
    i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Не удалось открыть изображение')); };
    i.src = u;
  });
}

$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await busy(async () => {
    setStatus('Открываю…');
    const img = await loadImage(f);
    const k = Math.min(1, MAX_WORK / Math.max(img.naturalWidth, img.naturalHeight));
    const c = mk(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    S.history = []; S.current = null;
    S.adj = { ...ADJ0 }; S.text.text = '';
    setCurrent(c, false);
    setStatus(`Загружено: ${c.width}×${c.height}` + (k < 1 ? ` (уменьшено с ${img.naturalWidth}×${img.naturalHeight} для экономии памяти)` : ''));
  });
});

// ---------------------------------------------------------------- UI: вкладки, ползунки
function syncUI() {
  $$('[data-obj]').forEach(el => {
    const v = S[el.dataset.obj][el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    if (el.nextElementSibling && el.nextElementSibling.tagName === 'OUTPUT') {
      el.nextElementSibling.textContent = Math.round(v * 10) / 10;
    }
  });
  $$('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === S.adj.preset));
}

document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.obj) return;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
  S[el.dataset.obj][el.dataset.key] = v;
  if (el.nextElementSibling && el.nextElementSibling.tagName === 'OUTPUT') el.nextElementSibling.textContent = v;
  schedule();
});

$$('[data-preset]').forEach(b => b.addEventListener('click', () => {
  S.adj.preset = b.dataset.preset; syncUI(); schedule();
}));

function commitAdjust() {
  if (!S.current || isIdentity(S.adj)) return;
  const n = process(S.current, S.adj);
  S.adj = { ...ADJ0 };
  setCurrent(n);
}
function setTab(t) {
  if (S.tab === 'adjust' && t !== 'adjust') commitAdjust();
  S.tab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if (t === 'export') updateExpInfo();
  schedule();
}
$$('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

$('#applyAdj').addEventListener('click', () => { commitAdjust(); setStatus('Применено'); });
$('#resetAdj').addEventListener('click', () => { S.adj = { ...ADJ0 }; syncUI(); schedule(); });

// ---------------------------------------------------------------- кадр: поворот, зеркало, обрезка
function transform(kind) {
  const c = S.current;
  if (!c) return;
  let n;
  if (kind === 'rl' || kind === 'rr') {
    n = mk(c.height, c.width);
    const x = n.getContext('2d');
    x.translate(n.width / 2, n.height / 2);
    x.rotate(kind === 'rr' ? Math.PI / 2 : -Math.PI / 2);
    x.drawImage(c, -c.width / 2, -c.height / 2);
  } else {
    n = mk(c.width, c.height);
    const x = n.getContext('2d');
    if (kind === 'fh') { x.translate(c.width, 0); x.scale(-1, 1); }
    else { x.translate(0, c.height); x.scale(1, -1); }
    x.drawImage(c, 0, 0);
  }
  setCurrent(n);
}
$$('[data-act]').forEach(b => b.addEventListener('click', () => transform(b.dataset.act)));

$$('[data-aspect]').forEach(b => b.addEventListener('click', () => {
  const c = S.current, a = +b.dataset.aspect;
  if (!c) return;
  if (!a) S.crop = { l: 0, t: 0, r: 0, b: 0 };
  else {
    const W = c.width, H = c.height;
    let cw = W, ch = H;
    if (W / H > a) cw = H * a; else ch = W / a;
    const mx = Math.min(45, ((W - cw) / 2 / W) * 100), my = Math.min(45, ((H - ch) / 2 / H) * 100);
    S.crop = { l: mx, t: my, r: mx, b: my };
  }
  syncUI(); schedule();
}));

$('#applyCrop').addEventListener('click', () => {
  const c = S.current;
  if (!c) return;
  const { l, t, r, b } = S.crop;
  if (!l && !t && !r && !b) return;
  const x0 = Math.round((c.width * l) / 100), y0 = Math.round((c.height * t) / 100);
  const w = Math.max(1, Math.round(c.width * (1 - (l + r) / 100)));
  const h = Math.max(1, Math.round(c.height * (1 - (t + b) / 100)));
  const n = mk(w, h);
  n.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
  setCurrent(n);
  setStatus(`Обрезано: ${w}×${h}`);
});

// ---------------------------------------------------------------- текст
$('#applyText').addEventListener('click', () => {
  if (!S.current || !S.text.text) return;
  const n = cloneCanvas(S.current);
  drawText(n.getContext('2d'), n.width, n.height, S.text);
  S.text.text = '';
  setCurrent(n);
  setStatus('Текст добавлен');
});

// ---------------------------------------------------------------- ИИ (Transformers.js, всё локально)
let tfPromise = null;
const getTF = () => (tfPromise ??= import(TF_URL).then(m => {
  m.env.allowLocalModels = false;
  m.env.useBrowserCache = true;
  return m;
}).catch(e => { tfPromise = null; throw e; }));

const models = new Map();
const wantGPU = () => $('#gpu').checked && !!navigator.gpu;
const progress = label => p => {
  if (p.status === 'progress') setStatus(`${label}: ${Math.round(p.progress)}%`);
};

async function aiRun(fn) {
  const dev = wantGPU() ? 'webgpu' : 'wasm';
  try { return await fn(dev); }
  catch (e) {
    if (dev !== 'webgpu') throw e;
    console.warn('WebGPU не сработал, переключаюсь на CPU', e);
    setStatus('WebGPU не сработал, пробую CPU…');
    return await fn('wasm');
  }
}

async function getBG(dev) {
  const key = 'bg:' + dev;
  if (models.has(key)) return models.get(key);
  const tf = await getTF();
  const model = await tf.AutoModel.from_pretrained(BG_ID, {
    config: { model_type: 'custom' }, device: dev, progress_callback: progress('Модель удаления фона'),
  });
  const processor = await tf.AutoProcessor.from_pretrained(BG_ID, { config: PROC_CFG });
  const m = { model, processor };
  models.set(key, m);
  return m;
}

async function getUp(dev) {
  const key = 'up:' + dev;
  if (models.has(key)) return models.get(key);
  const tf = await getTF();
  const cb = progress('Модель улучшения');
  let up;
  try {
    up = await tf.pipeline('image-to-image', UP_ID, { device: dev, progress_callback: cb });
  } catch (e) {
    if (dev !== 'wasm') throw e;
    console.warn('Пробую fp32', e);
    up = await tf.pipeline('image-to-image', UP_ID, { device: dev, dtype: 'fp32', progress_callback: cb });
  }
  models.set(key, up);
  return up;
}

async function removeBG() {
  await busy(async () => {
    const c = S.current;
    const res = await aiRun(async dev => {
      const { model, processor } = await getBG(dev);
      const { RawImage } = await getTF();
      setStatus('Вырезаю фон…');
      const small = Math.max(c.width, c.height) > 1024 ? resize(c, 1024 / Math.max(c.width, c.height)) : c;
      const url = URL.createObjectURL(await toBlob(small));
      let image;
      try { image = await RawImage.fromURL(url); } finally { URL.revokeObjectURL(url); }
      const { pixel_values } = await processor(image);
      const { output } = await model({ input: pixel_values });
      const m = await RawImage.fromTensor(output[0].mul(255).to('uint8'));

      const step = m.channels || 1;
      const mc = mk(m.width, m.height), mx = mc.getContext('2d');
      const id = mx.createImageData(m.width, m.height);
      for (let i = 0; i < m.width * m.height; i++) id.data[i * 4 + 3] = m.data[i * step];
      mx.putImageData(id, 0, 0);

      const out = mk(c.width, c.height), ox = out.getContext('2d');
      ox.drawImage(c, 0, 0);
      ox.globalCompositeOperation = 'destination-in';
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(mc, 0, 0, c.width, c.height);
      return out;
    });
    setCurrent(res);
    setStatus('Фон удалён. Можно залить цветом; для прозрачности сохраняйте в PNG.');
  });
}

async function upscaleTiles(src, dev, T, M) {
  const up = await getUp(dev);
  const W = src.width, H = src.height;
  const out = mk(W * 2, H * 2), ox = out.getContext('2d');
  const nx = Math.ceil(W / T), ny = Math.ceil(H / T);
  let n = 0;
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x0 = tx * T, y0 = ty * T, x1 = Math.min(W, x0 + T), y1 = Math.min(H, y0 + T);
      const sx0 = Math.max(0, x0 - M), sy0 = Math.max(0, y0 - M);
      const sx1 = Math.min(W, x1 + M), sy1 = Math.min(H, y1 + M);
      const tw = sx1 - sx0, th = sy1 - sy0;
      const tile = mk(tw, th);
      tile.getContext('2d').drawImage(src, sx0, sy0, tw, th, 0, 0, tw, th);
      const url = URL.createObjectURL(await toBlob(tile));
      let res;
      try { res = await up(url); } finally { URL.revokeObjectURL(url); }
      const oc = rawToCanvas(Array.isArray(res) ? res[0] : res);
      // модель может дополнить фрагмент до кратного 8, берём только нужную часть
      ox.drawImage(oc, (x0 - sx0) * 2, (y0 - sy0) * 2, (x1 - x0) * 2, (y1 - y0) * 2,
        x0 * 2, y0 * 2, (x1 - x0) * 2, (y1 - y0) * 2);
      setStatus(`Улучшаю качество: ${++n}/${nx * ny}`);
    }
  }
  // вернуть прозрачность исходника (модель работает только с RGB)
  ox.globalCompositeOperation = 'destination-in';
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(src, 0, 0, W * 2, H * 2);
  return out;
}

async function upscale() {
  if (!S.current) return;
  let c = S.current;
  const maxOutPx = 16e6; // потолок размера canvas на телефонах
  if (c.width * c.height * 4 > maxOutPx) c = resize(c, Math.sqrt(maxOutPx / 4 / (c.width * c.height)));
  const T = 160, M = 16;
  const tiles = Math.ceil(c.width / T) * Math.ceil(c.height / T);
  if (tiles > 20 && !confirm(`Фото большое: ${tiles} фрагментов, обработка может занять несколько минут. Продолжить?`)) return;
  await busy(async () => {
    const out = await aiRun(dev => upscaleTiles(c, dev, T, M));
    setCurrent(out);
    setStatus(`Готово: ${out.width}×${out.height}`);
  });
}

async function prepareOffline() {
  await busy(async () => {
    setStatus('Готовлю офлайн-режим…');
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    await getBG('wasm');
    await getUp('wasm');
    try { localStorage.setItem('offlineReady', '1'); } catch {}
    updateNet();
    setStatus('Готово: приложение и модели сохранены. Можно работать без интернета (режим GPU офлайн не подготовлен).');
  });
}

$('#aiBG').addEventListener('click', () => S.current && removeBG());
$('#aiUp').addEventListener('click', upscale);
$('#prep').addEventListener('click', prepareOffline);
$('#fillBG').addEventListener('click', () => {
  const c = S.current;
  if (!c) return;
  const n = mk(c.width, c.height), x = n.getContext('2d');
  x.fillStyle = $('#bgColor').value;
  x.fillRect(0, 0, n.width, n.height);
  x.drawImage(c, 0, 0);
  setCurrent(n);
});
if (!navigator.gpu) { $('#gpu').disabled = true; }

// ---------------------------------------------------------------- экспорт
function targetSize() {
  const c = S.current, max = +$('#maxside').value;
  if (!c) return null;
  const k = max && Math.max(c.width, c.height) > max ? max / Math.max(c.width, c.height) : 1;
  return { k, w: Math.round(c.width * k), h: Math.round(c.height * k) };
}
function updateExpInfo() {
  const t = targetSize();
  $('#expInfo').textContent = t ? `Итоговый размер: ${t.w}×${t.h}` : 'Сначала откройте фото';
}
$('#fmt').addEventListener('change', () => { $('#qrow').hidden = $('#fmt').value === 'image/png'; });
$('#q').addEventListener('input', () => { $('#q').nextElementSibling.textContent = $('#q').value; });
$('#maxside').addEventListener('change', updateExpInfo);
if (navigator.canShare) $('#doShare').hidden = false;

async function exportImage(share) {
  if (!S.current) return;
  commitAdjust();
  await busy(async () => {
    const fmt = $('#fmt').value, q = +$('#q').value / 100, t = targetSize();
    let c = t.k < 1 ? resize(S.current, t.k) : S.current;
    if (fmt === 'image/jpeg') {
      const f = mk(c.width, c.height), x = f.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height);
      x.drawImage(c, 0, 0);
      c = f;
    }
    const blob = await toBlob(c, fmt, q);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] || 'png';
    const file = new File([blob], `photo-${Date.now()}.${ext}`, { type: blob.type });
    const kb = Math.round(blob.size / 1024);
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); setStatus(`Отправлено (${kb} КБ)`); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus(`Сохранено: ${file.name}, ${c.width}×${c.height}, ${kb} КБ` + (blob.type !== fmt ? ' (браузер не умеет этот формат, сохранён PNG)' : ''));
  });
}
$('#save').addEventListener('click', () => exportImage(false));
$('#doSave').addEventListener('click', () => exportImage(false));
$('#doShare').addEventListener('click', () => exportImage(true));

// ---------------------------------------------------------------- офлайн: индикатор и Service Worker
function updateNet() {
  const el = $('#net');
  let ready = false;
  try { ready = localStorage.getItem('offlineReady') === '1'; } catch {}
  if (!navigator.onLine) { el.textContent = 'офлайн'; el.className = 'badge off'; }
  else if (ready) { el.textContent = 'офлайн готов'; el.className = 'badge ready'; }
  else { el.textContent = 'онлайн'; el.className = 'badge'; }
}
addEventListener('online', updateNet);
addEventListener('offline', updateNet);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e)));
}

// ---------------------------------------------------------------- старт
syncUI();
setTab('crop');
updateNet();
updateExpInfo();
