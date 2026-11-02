'use strict';
// FARVER OG INDSTILLINGER: gemte indstillinger, farveomregning, farvehjul, pipette.

// Gem små indstillinger på enheden (kun menuens tilstand og trykfølsomhed)
const INDST_NOEGLE = 'tegneapp.indstillinger';
function hentIndstillinger() {
  try {
    const o = JSON.parse(localStorage.getItem(INDST_NOEGLE) || '{}');
    if (typeof o.menuAaben === 'boolean') menuAaben = o.menuAaben;
    if (typeof o.trykFuld === 'number' && o.trykFuld >= 0.05 && o.trykFuld <= 1) trykFuld = o.trykFuld;
    if (typeof o.trykTil === 'boolean') trykTil = o.trykTil;
    if (typeof o.fastStyrke === 'number' && o.fastStyrke >= 0.05 && o.fastStyrke <= 1) fastStyrke = o.fastStyrke;
    if (erHex(o.farve)) farve = o.farve.toLowerCase();
    if (typeof o.blandFarver === 'boolean') blandFarver = o.blandFarver;
    if (Array.isArray(o.gemte)) gemteFarver = o.gemte.filter(erHex).map(h => h.toLowerCase()).slice(0, MAX_GEMTE);
  } catch (e) { /* ingen gemte indstillinger */ }
}
function gemIndstillinger() {
  try { localStorage.setItem(INDST_NOEGLE, JSON.stringify({ menuAaben, trykFuld, trykTil, fastStyrke, farve, blandFarver, gemte: gemteFarver })); } catch (e) { /* ignorer */ }
}

function trykKurve(raa) {
  // Fuld styrke nås ved trykFuld (fx 55 % af det maksimale tryk), så man ikke skal trykke hårdt
  const x = Math.min(1, Math.max(0, raa / trykFuld));
  return Math.pow(x, 0.85);
}
function mellem(par, t) { return par[0] + (par[1] - par[0]) * t; }
// Farven som blæk med styrke a ville se ud på hvidt papir, som fuldt dækkende farve
function inkPaaHvid(rgb, a) {
  const t = Math.min(1, Math.max(0, a));
  return 'rgb(' + Math.round(255 - (255 - rgb[0]) * t) + ',' + Math.round(255 - (255 - rgb[1]) * t) + ',' + Math.round(255 - (255 - rgb[2]) * t) + ')';
}

// ---------- farver ----------

function erHex(h) { return typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h); }

const rgbCache = new Map();
function hexTilRgb(h) {
  let r = rgbCache.get(h);
  if (!r) {
    const t = erHex(h) ? h : '#000000';
    r = [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)];
    if (rgbCache.size > 200) rgbCache.clear();
    rgbCache.set(h, r);
  }
  return r;
}

function rgbTilHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function hsvTilRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [m[0] * 255, m[1] * 255, m[2] * 255];
}

function rgbTilHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function tegnFarvehjul() {
  const W = farvehjul.width, R = W / 2 - 3;
  const img = hjulCtx.createImageData(W, W);
  const px = img.data;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - W / 2, d = Math.hypot(dx, dy);
      if (d > R + 1) continue;
      const h = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
      const c = hsvTilRgb(h, Math.min(1, d / R), 1);
      const k = (y * W + x) * 4;
      px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2];
      px[k + 3] = d > R ? Math.round(255 * (1 - (d - R))) : 255;
    }
  }
  hjulCtx.putImageData(img, 0, 0);
  const mx = W / 2 + Math.cos(farveH * 2 * Math.PI) * farveS * R;
  const my = W / 2 + Math.sin(farveH * 2 * Math.PI) * farveS * R;
  hjulCtx.lineWidth = 2; hjulCtx.strokeStyle = '#ffffff';
  hjulCtx.beginPath(); hjulCtx.arc(mx, my, 7, 0, 2 * Math.PI); hjulCtx.stroke();
  hjulCtx.lineWidth = 1; hjulCtx.strokeStyle = '#000000';
  hjulCtx.beginPath(); hjulCtx.arc(mx, my, 8.5, 0, 2 * Math.PI); hjulCtx.stroke();
}

// Farverækken er altid synlig. Sort ligger altid først (og kan ikke fjernes).
function tegnGemteFarver() {
  while (gemteFarverEl.firstChild) gemteFarverEl.removeChild(gemteFarverEl.firstChild);
  const liste = ['#000000'].concat(gemteFarver.filter(h => h !== '#000000'));
  for (const h of liste) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = h;
    b.setAttribute('aria-label', 'Farve ' + h);
    b.style.backgroundColor = h;
    b.classList.toggle('valgt', h === farve);
    b.addEventListener('click', () => saetFarve(h));
    gemteFarverEl.appendChild(b);
  }
}

function opdaterFarveUI() {
  farveProeve.style.backgroundColor = farve;
  farveHex.textContent = farve;
  lysstyrkeGlider.value = String(Math.round(farveV * 100));
  farvePanel.classList.toggle('skjult', !farvePanelAaben);
  farveKnap.textContent = farvePanelAaben ? 'Skjul hjul' : 'Farvehjul';
  tegnGemteFarver();
  if (farvePanelAaben) tegnFarvehjul();
}

// Vælg en farve ud fra en hex-værdi (fra gemte farver, pipette osv.)
function saetFarve(hex) {
  if (!erHex(hex)) return;
  farve = hex.toLowerCase();
  const c = hexTilRgb(farve);
  const [h, s, v] = rgbTilHsv(c[0], c[1], c[2]);
  if (s > 0 && v > 0) farveH = h;   // gråtoner har ingen farvetone, så behold den forrige
  farveS = s; farveV = v;
  gemIndstillinger();
  opdaterFarveUI();
}

// Vælg farve ud fra et punkt på farvehjulet (farvetone + mætning), med nuværende lysstyrke
function saetFraHjul(h, s) {
  farveH = h; farveS = s;
  if (farveV < 0.15) farveV = 1;   // et tryk på hjulet giver en tydelig farve
  const c = hsvTilRgb(h, s, farveV);
  farve = rgbTilHex(c[0], c[1], c[2]);
  gemIndstillinger();
  opdaterFarveUI();
}

function saetLysstyrke(v) {
  farveV = Math.min(1, Math.max(0, v));
  const c = hsvTilRgb(farveH, farveS, farveV);
  farve = rgbTilHex(c[0], c[1], c[2]);
  gemIndstillinger();
  opdaterFarveUI();
}

// Pipette: find den øverste (nyeste) synlige streg ved punktet og tag dens farve
function samlFarveOp(px, py) {
  let bedst = null;
  const radius = STOERRELSE.pipette / 2;
  gennemloebAlt((node, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s.t === 'visk') return;
    if (stregVedPunkt(s, z, kxh, kxl, kyh, kyl, cx, cy, px, py, radius)) {
      if (!bedst || s.id > bedst.id) bedst = s;
    }
  });
  if (bedst) saetFarve(bedst.c || '#000000');
}

