'use strict';
// Bid 6: flere lærreder (galleri) og automatisk gem. (Bid 5: farver. Bid 4: pensler og præcist viskelæder.)
// Bygger på bid 2 (uendelig zoom) og bid 3 (fortryd/gentag, tryk).
//
// Lærredet er et træ af koordinatsystemer ("niveauer"). Hvert niveau er S gange mere forstørret
// end sit forældreniveau. Kameraet har altid en moderat zoom i det niveau, det står i, og
// skifter automatisk til et barn (ind) eller en forælder (ud). Dermed mister vi aldrig præcision.
//
// Viskelæderet ("visk") er en hvid streg, der tegnes i samme rækkefølge som alt andet
// (efter tidspunkt). Den fjerner altså præcis det, den rører, uanset zoom og niveau,
// og kan fortrydes. "Slet streg" fjerner derimod hele streger.
const VERSION = 6; // bid 6: galleri med flere lærreder, automatisk gem i IndexedDB

const laerred = document.getElementById('laerred');
const hovedCtx = laerred.getContext('2d');
let ctx = hovedCtx;   // den lærred der tegnes på lige nu (hoved- eller mellemlager)
const zoomtekst = document.getElementById('zoomtekst');
const nulstilKnap = document.getElementById('nulstil');
const knapFortryd = document.getElementById('knapFortryd');
const knapGentag = document.getElementById('knapGentag');
const stoerrelseGlider = document.getElementById('stoerrelse');
const stoerrelseTal = document.getElementById('stoerrelseTal');
const vaerktoejKnapper = Array.from(document.querySelectorAll('[data-v]'));
const menu = document.getElementById('menu');
const menuKnap = document.getElementById('menuKnap');
const trykGlider = document.getElementById('trykfoelsomhed');
const trykTal = document.getElementById('trykTal');
const farveKnap = document.getElementById('farveKnap');
const blandKnap = document.getElementById('blandKnap');
const trykKnap = document.getElementById('trykKnap');
const trykDel = document.getElementById('trykDel');
const trykMaaling = document.getElementById('trykMaaling');
const brugHoejesteKnap = document.getElementById('brugHoejeste');
const nulstilMaalingKnap = document.getElementById('nulstilMaaling');
const styrkeGlider = document.getElementById('styrke');
const styrkeTal = document.getElementById('styrkeTal');
const farveProeve = document.getElementById('farveProeve');
const farveHex = document.getElementById('farveHex');
const farvePanel = document.getElementById('farvePanel');
const farvehjul = document.getElementById('farvehjul');
const hjulCtx = farvehjul.getContext('2d');
const lysstyrkeGlider = document.getElementById('lysstyrke');
const gemFarveKnap = document.getElementById('gemFarve');
const fjernFarveKnap = document.getElementById('fjernFarve');
const gemteFarverEl = document.getElementById('gemteFarver');

// Fejlsøgningsvindue: tryk på tasten D for at vise/skjule
const fejlsoeg = document.createElement('div');
fejlsoeg.style.cssText = 'position:fixed;right:12px;top:12px;padding:6px 10px;background:rgba(255,255,255,0.92);' +
  'border:1px solid #d0d0d0;border-radius:8px;font:12px monospace;white-space:pre;color:#222;display:none';
document.body.appendChild(fejlsoeg);
let visFejlsoeg = false;

const S = 1000;          // forstørrelse mellem to niveauer
const ZOOM_IND = 1000;   // zoom ind i et barn, når zoom når hertil
const ZOOM_OP = 0.1;     // zoom op til forælderen, når zoom kommer under dette
const MAX_ANCESTOR_ZOOM = 1e27; // forfædre tegnes, så længe de er under denne zoom
const GRAENSE = 30000;   // maks. afstand fra skærmens midte (px), som tegnes direkte
const MAX_LINJEBREDDE = 100000;
const HISTORIK_MAX = 1000;

// Penseltyper.
//   alpha: gennemsigtighed uden tryk (mus/finger)
//   bredde: [mindst, størst] andel af penselstørrelsen ved tryk (stylus)
//   styrke: [mindst, størst] gennemsigtighed ved tryk (stylus)
//   fart: uden stylus følger bredden farten (kun fyldepen)
const PENSLER = {
  spids:    { alpha: 0.95, blod: false, bredde: [1, 1],    styrke: [0.2, 0.95] },
  blod:     { alpha: 1,    blod: true,  bredde: [1, 1],    styrke: [0.15, 1]   },
  fyldepen: { alpha: 1,    blod: false, bredde: [0.2, 1],  styrke: [1, 1], fart: true },
  tusse:    { alpha: 0.9,  blod: false, bredde: [1, 1],    styrke: [0.55, 0.95] }
};
// Blød blyant tegnes som tre lag oven på hinanden (bred og svag, smal og stærk)
const BLOD_LAG = [[1.0, 0.16], [0.65, 0.22], [0.3, 0.35]];

// Størrelser (diameter i skærmpixels) og grænser pr. værktøj
const STOERRELSE = { spids: 2.5, blod: 8, fyldepen: 4, tusse: 9, visk: 24, slet: 24, pipette: 6 };
const GRAENSER = {
  spids: [0.5, 12], blod: [2, 60], fyldepen: [1, 30], tusse: [2, 60], visk: [4, 300], slet: [4, 300], pipette: [3, 30]
};

function nyNode(parent, ox, oy, niveau) {
  // ox, oy: barnets origo i forælderens koordinater. strokes: i nodens egne koordinater.
  // box: udstrækning af alt indhold (inkl. børn) i nodens egne koordinater, eller null.
  return { parent, ox, oy, niveau, strokes: [], children: [], box: null };
}

let start = nyNode(null, 0, 0, 0);
const kamera = { node: start, x: 0, y: 0, zoom: 1 };

let bredde = 0, hoejde = 0, dpr = 1;
let tegnerNu = null, tegnerNode = null;     // streg under tegning
let sletAktiv = false, sletItems = [];      // slettede streger under et "slet streg"-træk
let vaerktoej = 'spids';
let musX = -1, musY = -1;                   // sidste pegerposition (til viskelæder-cirklen)
const pegere = new Map();
let bevaegelse = null;
let hoejreTraek = null;
let snavs = true;
let tegnet = 0;
let antalStreger = 0;
let naesteId = 1;                           // tegnerækkefølge: lavt id tegnes først
const fortrydStak = [], gentagStak = [];

let bufX = [], bufY = [], bufT = [];
let trykFuld = 0.55;     // andel af stylussens maksimale tryk, hvor stregen er på fuld styrke
let menuAaben = true;
let lagCanvas = null, lagCtx = null;   // midlertidigt lag til streger med varierende gennemsigtighed

// Farver
const STANDARD_FARVER = ['#000000', '#555555', '#d62828', '#f77f00', '#fcbf49', '#2a9d3f', '#1d6fd6', '#7b2cbf', '#8b5a2b'];
const MAX_GEMTE = 30;
let farve = '#000000';                  // den farve, der tegnes med
let farveH = 0, farveS = 0, farveV = 0; // samme farve som farvetone, mætning, lysstyrke (0-1)
let gemteFarver = [];
let farvePanelAaben = false;
let hjulTrukket = false;
let sidstePensel = 'spids';             // pipetten vender tilbage til denne pensel
let blandFarver = false;                // til: overlap blander/mørkner farver. fra: ny streg dækker det under
let trykTil = true;                     // stylussens tryk styrer styrken (fra: fast styrke)
let fastStyrke = 1;                     // fast styrke (0,05-1) for mus, finger og når tryk er fra
let hoejesteTryk = 0;                   // højeste rå tryk målt fra stylus (til kalibrering)

// Mellemlager: alt undtagen den streg, der tegnes lige nu, så der kun skal tegnes én streg pr. billede
let baseCanvas = null, baseCtx = null, baseGyldig = false, baseKamera = null;
let forrigeKamera = null, sidsteBevaegelse = 0, previewVentende = false;
let fuldTid = 0;                        // gennemsnitlig tid (ms) for at tegne hele lærredet

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
hentIndstillinger();
if (!gemteFarver.length) gemteFarver = STANDARD_FARVER.slice();

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

function skaler() {
  dpr = window.devicePixelRatio || 1;
  bredde = window.innerWidth;
  hoejde = window.innerHeight;
  laerred.width = Math.round(bredde * dpr);
  laerred.height = Math.round(hoejde * dpr);
  baseGyldig = false;
  snavs = true;
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

// ---------- værktøj og størrelse ----------

function erViskeVaerktoej(v) { return v === 'visk' || v === 'slet'; }

function formaterPx(v) { return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' px'; }

function opdaterKnapper() {
  knapFortryd.disabled = fortrydStak.length === 0;
  knapGentag.disabled = gentagStak.length === 0;
  for (const b of vaerktoejKnapper) b.classList.toggle('valgt', b.dataset.v === vaerktoej);
  laerred.style.cursor = erViskeVaerktoej(vaerktoej) ? 'none' : 'crosshair';
  const [mn, mx] = GRAENSER[vaerktoej];
  const v = STOERRELSE[vaerktoej];
  stoerrelseGlider.value = String(Math.round(100 * Math.log(v / mn) / Math.log(mx / mn)));
  stoerrelseTal.textContent = formaterPx(v);
  menu.classList.toggle('lukket', !menuAaben);
  menuKnap.setAttribute('aria-expanded', menuAaben ? 'true' : 'false');
  menuKnap.textContent = menuAaben ? '✕ Luk menu' : '☰ Menu';
  trykGlider.value = String(Math.round(trykFuld * 100));
  trykTal.textContent = Math.round(trykFuld * 100) + ' %';
  trykKnap.classList.toggle('valgt', trykTil);
  trykKnap.setAttribute('aria-pressed', trykTil ? 'true' : 'false');
  trykKnap.textContent = 'Tryk fra stylus: ' + (trykTil ? 'TIL' : 'FRA');
  trykDel.classList.toggle('skjult', !trykTil);
  styrkeGlider.value = String(Math.round(fastStyrke * 100));
  styrkeTal.textContent = Math.round(fastStyrke * 100) + ' %';
  blandKnap.classList.toggle('valgt', blandFarver);
  blandKnap.setAttribute('aria-pressed', blandFarver ? 'true' : 'false');
  blandKnap.textContent = 'Bland farver ved overlap: ' + (blandFarver ? 'TIL' : 'FRA');
  opdaterFarveUI();
}

function saetStoerrelse(v) {
  const [mn, mx] = GRAENSER[vaerktoej];
  STOERRELSE[vaerktoej] = Math.min(mx, Math.max(mn, v));
  if (erViskeVaerktoej(vaerktoej)) {
    if (musX < 0) { musX = bredde / 2; musY = hoejde / 2; } // vis cirklen midt på skærmen
  }
  snavs = true;
  opdaterKnapper();
}

function vaelgVaerktoej(v) {
  if (!GRAENSER[v]) return;
  afslutSlet();
  if (PENSLER[v]) sidstePensel = v;
  vaerktoej = v;
  musX = -1;
  snavs = true;
  opdaterKnapper();
}

// ---------- historik (fortryd/gentag) ----------

function skubHandling(h) {
  fortrydStak.push(h);
  if (fortrydStak.length > HISTORIK_MAX) fortrydStak.shift();
  gentagStak.length = 0;
  markerAendret();
  opdaterKnapper();
}

function afslutStreg() {
  if (tegnerNu && tegnerNode) {
    const i = tegnerNode.strokes.lastIndexOf(tegnerNu);
    if (i >= 0) {
      skubHandling({ type: 'tilfoej', node: tegnerNode, stroke: tegnerNu, index: i });
      flettIMellemlager(tegnerNu, tegnerNode);
    }
  }
  tegnerNu = null;
  tegnerNode = null;
}

// Den færdige streg lægges oven på mellemlageret, så alt ikke skal tegnes forfra
function flettIMellemlager(streg, node) {
  if (!baseGyldig || !baseKamera || node !== kamera.node ||
      baseKamera.node !== kamera.node || baseKamera.x !== kamera.x ||
      baseKamera.y !== kamera.y || baseKamera.zoom !== kamera.zoom) {
    baseGyldig = false;
    return;
  }
  const gammel = ctx;
  ctx = baseCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tegnStreg(streg, kamera.zoom, kamera.x, 0, kamera.y, 0, bredde / 2, hoejde / 2);
  ctx = gammel;
}

function afslutSlet() {
  if (sletAktiv && sletItems.length) skubHandling({ type: 'slet', items: sletItems });
  sletAktiv = false;
  sletItems = [];
}

function fortryd() {
  if (tegnerNu || sletAktiv) return;
  const h = fortrydStak.pop();
  if (!h) return;
  if (h.type === 'tilfoej') {
    const i = h.node.strokes.indexOf(h.stroke);
    if (i >= 0) { h.node.strokes.splice(i, 1); antalStreger--; }
  } else {
    for (let k = h.items.length - 1; k >= 0; k--) {
      const it = h.items[k];
      it.node.strokes.splice(Math.min(it.index, it.node.strokes.length), 0, it.stroke);
      antalStreger++;
    }
  }
  gentagStak.push(h);
  baseGyldig = false;
  markerAendret();
  snavs = true;
  opdaterKnapper();
}

function gentag() {
  if (tegnerNu || sletAktiv) return;
  const h = gentagStak.pop();
  if (!h) return;
  if (h.type === 'tilfoej') {
    h.node.strokes.splice(Math.min(h.index, h.node.strokes.length), 0, h.stroke);
    antalStreger++;
  } else {
    for (const it of h.items) {
      const i = it.node.strokes.indexOf(it.stroke);
      if (i >= 0) { it.node.strokes.splice(i, 1); antalStreger--; }
    }
  }
  fortrydStak.push(h);
  baseGyldig = false;
  markerAendret();
  snavs = true;
  opdaterKnapper();
}

// ---------- niveauer ----------

function udvidBox(node, x0, x1, y0, y1) {
  let n = node;
  while (n) {
    const b = n.box;
    if (!b) {
      n.box = { minX: x0, maxX: x1, minY: y0, maxY: y1 };
    } else {
      if (x0 >= b.minX && x1 <= b.maxX && y0 >= b.minY && y1 <= b.maxY) return;
      if (x0 < b.minX) b.minX = x0;
      if (x1 > b.maxX) b.maxX = x1;
      if (y0 < b.minY) b.minY = y0;
      if (y1 > b.maxY) b.maxY = y1;
    }
    if (!n.parent) return;
    x0 = n.ox + x0 / S; x1 = n.ox + x1 / S;
    y0 = n.oy + y0 / S; y1 = n.oy + y1 / S;
    n = n.parent;
  }
}

function gaaInd() {
  const n = kamera.node;
  let barn = null;
  for (const ch of n.children) {
    const b = ch.box;
    if (!b) continue;
    if (kamera.x >= ch.ox + b.minX / S && kamera.x <= ch.ox + b.maxX / S &&
        kamera.y >= ch.oy + b.minY / S && kamera.y <= ch.oy + b.maxY / S) {
      barn = ch;
      break;
    }
  }
  if (!barn) {
    barn = nyNode(n, kamera.x, kamera.y, n.niveau + 1);
    n.children.push(barn);
  }
  kamera.x = (kamera.x - barn.ox) * S;
  kamera.y = (kamera.y - barn.oy) * S;
  kamera.zoom /= S;
  kamera.node = barn;
}

function gaaOp() {
  const n = kamera.node;
  let p = n.parent;
  if (!p) {
    // Zoomer ud over det øverste niveau: lav et nyt forældreniveau
    p = nyNode(null, 0, 0, n.niveau - 1);
    p.children.push(n);
    n.parent = p;
    n.ox = 0; n.oy = 0;
    // det nye forældreniveau skal kende udstrækningen af det indhold, der allerede findes
    if (n.box) {
      p.box = { minX: n.box.minX / S, maxX: n.box.maxX / S,
                minY: n.box.minY / S, maxY: n.box.maxY / S };
    }
  }
  kamera.x = n.ox + kamera.x / S;
  kamera.y = n.oy + kamera.y / S;
  kamera.zoom *= S;
  kamera.node = p;
  // ryd tomme børn op, så der ikke samles skrald
  if (n !== start && !n.box && n.children.length === 0) {
    const i = p.children.indexOf(n);
    if (i >= 0) p.children.splice(i, 1);
  }
}

function skiftNiveau() {
  if (!(kamera.zoom > 0) || !isFinite(kamera.zoom)) { kamera.zoom = 1; }
  let skiftet = false;
  while (kamera.zoom >= ZOOM_IND) { gaaInd(); skiftet = true; }
  while (kamera.zoom < ZOOM_OP) { gaaOp(); skiftet = true; }
  // Sikkerhedsnet: hvis kameraets position er blevet ugyldig, flyt det til niveauets midte
  if (!isFinite(kamera.x) || !isFinite(kamera.y)) { kamera.x = 0; kamera.y = 0; }
  if (skiftet) { afslutStreg(); afslutSlet(); }
}

// ---------- kamera ----------

function tilVerden(sx, sy) {
  return [
    kamera.x + (sx - bredde / 2) / kamera.zoom,
    kamera.y + (sy - hoejde / 2) / kamera.zoom
  ];
}

function zoomOmkring(sx, sy, nyZoom) {
  if (!(nyZoom > 0) || !isFinite(nyZoom)) return;
  const [wx, wy] = tilVerden(sx, sy);
  kamera.zoom = nyZoom;
  kamera.x = wx - (sx - bredde / 2) / nyZoom;
  kamera.y = wy - (sy - hoejde / 2) / nyZoom;
  skiftNiveau();
  snavs = true;
}

function panSkaerm(dx, dy) {
  kamera.x -= dx / kamera.zoom;
  kamera.y -= dy / kamera.zoom;
  snavs = true;
}

function zoomTekst() {
  const logZ = Math.log10(kamera.zoom) + kamera.node.niveau * 3;
  if (Math.abs(logZ) < 3) return (Math.pow(10, logZ)).toPrecision(3) + '×';
  return '10^' + logZ.toFixed(1) + '×';
}

// ---------- dobbelt-præcision (to doubles: hi + lo) til kameraets position ----------
// Når vi tegner store forfædre-niveauer, ganges forskelle med enorme tal. Derfor holder vi
// kameraets position som to tal, så afstanden til en streg bliver nøjagtig.

function twoSum(a, b) {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

function twoProd(a, b) {
  const p = a * b;
  const ca = 134217729 * a, ah = ca - (ca - a), al = a - ah;
  const cb = 134217729 * b, bh = cb - (cb - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}

function ddPlus(h, l, b) {            // (h + l) + b
  const t = twoSum(h, b);
  return twoSum(t[0], t[1] + l);
}

function ddDivS(h, l) {               // (h + l) / S
  const q1 = h / S;
  const pr = twoProd(q1, S);
  const q2 = (((h - pr[0]) - pr[1]) + l) / S;
  return twoSum(q1, q2);
}

function ddMulS(h, l) {               // (h + l) * S
  const pr = twoProd(h, S);
  return twoSum(pr[0], pr[1] + l * S);
}

// ---------- gennemløb af alle synlige streger (bruges af tegning og "slet streg") ----------

// Besøg alle streger i et niveau (og dets børn), som kan ses med kameraet (kx, ky, z)
// udtrykt i dette niveaus koordinater. "ikke" er et barn, der springes over.
function gennemloebNode(node, kxh, kxl, kyh, kyl, z, ikke, besog) {
  const cx = bredde / 2, cy = hoejde / 2;
  const halvB = cx / z, halvH = cy / z;
  const vMinX = kxh - halvB, vMaxX = kxh + halvB;
  const vMinY = kyh - halvH, vMaxY = kyh + halvH;

  for (const s of node.strokes) {
    const pad = s.w / 2;
    if (s.maxX + pad < vMinX || s.minX - pad > vMaxX ||
        s.maxY + pad < vMinY || s.minY - pad > vMaxY) continue;
    const stoerrelse = Math.max(s.maxX - s.minX, s.maxY - s.minY) * z + s.w * z;
    if (stoerrelse < 0.5) continue;
    besog(node, s, z, kxh, kxl, kyh, kyl, cx, cy);
  }

  const cz = z / S;
  for (const ch of node.children) {
    if (ch === ikke || !ch.box) continue;
    const nx = ddMulS(...ddPlus(kxh, kxl, -ch.ox));
    const ny = ddMulS(...ddPlus(kyh, kyl, -ch.oy));
    const b = ch.box;
    const hb = cx / cz, hh = cy / cz;
    if (b.maxX < nx[0] - hb || b.minX > nx[0] + hb ||
        b.maxY < ny[0] - hh || b.minY > ny[0] + hh) continue;
    if (Math.max(b.maxX - b.minX, b.maxY - b.minY) * cz < 0.5) continue;
    gennemloebNode(ch, nx[0], nx[1], ny[0], ny[1], cz, null, besog);
  }
}

function gennemloebAlt(besog) {
  // Forfædre (større niveauer) først, så kameraets eget niveau og dets børn
  const kaede = [];
  let n = kamera.node, z = kamera.zoom;
  let xh = kamera.x, xl = 0, yh = kamera.y, yl = 0;
  while (n.parent) {
    const p = n.parent;
    let t = ddDivS(xh, xl); t = ddPlus(t[0], t[1], n.ox); xh = t[0]; xl = t[1];
    t = ddDivS(yh, yl); t = ddPlus(t[0], t[1], n.oy); yh = t[0]; yl = t[1];
    z = z * S;
    if (z > MAX_ANCESTOR_ZOOM) break;
    kaede.push({ node: p, xh, xl, yh, yl, z, ikke: n });
    n = p;
  }
  for (let i = kaede.length - 1; i >= 0; i--) {
    const k = kaede[i];
    gennemloebNode(k.node, k.xh, k.xl, k.yh, k.yl, k.z, k.ikke, besog);
  }
  gennemloebNode(kamera.node, kamera.x, 0, kamera.y, 0, kamera.zoom, null, besog);
}

// ---------- tegning ----------

function klip(ax, ay, bx, by, xmin, xmax, ymin, ymax) {
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - xmin, xmax - ax, ay - ymin, ymax - ay];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return null;
    } else {
      const r = q[k] / p[k];
      if (p[k] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

// Udtynd en streg til skærmpunkter mindst 1 pixel fra hinanden (med tryk). Returnerer antal punkter.
function udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const p = s.p, pr = s.pr;
  let lx = ((p[0] - kxh) - kxl) * z + cx;
  let ly = ((p[1] - kyh) - kyl) * z + cy;
  bufX[0] = lx; bufY[0] = ly; bufT[0] = pr[0];
  let n = 1;
  for (let i = 2; i < p.length; i += 2) {
    const x = ((p[i] - kxh) - kxl) * z + cx;
    const y = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy >= 1) {
      bufX[n] = x; bufY[n] = y; bufT[n] = pr[i / 2]; n++;
      lx = x; ly = y;
    }
  }
  return n;
}

// Streg med varierende bredde (fyldepen): hvert stykke får sin egen bredde ud fra trykket.
function tegnTryk(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.fyldepen;
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);
  if (n === 1) {
    if (!(bufX[0] > xmin && bufX[0] < xmax && bufY[0] > ymin && bufY[0] < ymax)) return;
    ctx.beginPath();
    ctx.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, bufT[0]), 0.3) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let k = 1; k < n; k++) {
    const kl = klip(bufX[k - 1], bufY[k - 1], bufX[k], bufY[k], xmin, xmax, ymin, ymax);
    if (!kl) continue;
    ctx.lineWidth = Math.max(maxB * mellem(pensel.bredde, (bufT[k - 1] + bufT[k]) / 2), 0.3);
    ctx.beginPath();
    ctx.moveTo(kl[0], kl[1]);
    ctx.lineTo(kl[2], kl[3]);
    ctx.stroke();
  }
}

function sikrLag() {
  if (!lagCanvas || lagCanvas.width !== laerred.width || lagCanvas.height !== laerred.height) {
    lagCanvas = document.createElement('canvas');
    lagCanvas.width = laerred.width;
    lagCanvas.height = laerred.height;
    lagCtx = lagCanvas.getContext('2d');
  }
}

// Streg hvor trykket styrer både bredde og gennemsigtighed (spids/blød blyant, tusse med stylus).
// For at stykkerne ikke bliver mørkere, hvor de overlapper, tegnes stregen først på et midlertidigt
// lag i graatoner (mørkeste gælder), og laget lægges derefter på lærredet med "gang sammen".
// På hvidt papir er det præcis det samme som en gennemsigtig streg i farven.
function tegnTrykLag(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const rgb = hexTilRgb(s.c || '#000000');
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);

  // Område på skærmen, som stregen dækker
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    if (bufX[k] < x0) x0 = bufX[k];
    if (bufX[k] > x1) x1 = bufX[k];
    if (bufY[k] < y0) y0 = bufY[k];
    if (bufY[k] > y1) y1 = bufY[k];
  }
  const pad = maxB / 2 + 2;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(bredde, Math.ceil(x1 + pad)); y1 = Math.min(hoejde, Math.ceil(y1 + pad));
  if (x1 <= x0 || y1 <= y0) return;

  sikrLag();
  const L = lagCtx;
  L.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.globalAlpha = 1;
  L.fillStyle = '#ffffff';
  L.fillRect(x0, y0, x1 - x0, y1 - y0);
  L.globalCompositeOperation = 'darken';
  L.lineCap = 'round';
  L.lineJoin = 'round';

  const lag = pensel.blod ? BLOD_LAG : [[1, 1]];
  // Farven som blæk med styrke a ville se ud på hvidt papir (bruges, til lagene lægges sammen)
  const blaek = a => {
    const t = Math.min(1, Math.max(0, a));
    return 'rgb(' + Math.round(255 - (255 - rgb[0]) * t) + ',' + Math.round(255 - (255 - rgb[1]) * t) + ',' + Math.round(255 - (255 - rgb[2]) * t) + ')';
  };

  if (n === 1) {
    const t = bufT[0];
    for (const [b, a] of lag) {
      L.fillStyle = blaek(a * mellem(pensel.styrke, t));
      L.beginPath();
      L.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, t) * b, 0.3) / 2, 0, Math.PI * 2);
      L.fill();
    }
  } else {
    for (let k = 1; k < n; k++) {
      const kl = klip(bufX[k - 1], bufY[k - 1], bufX[k], bufY[k], xmin, xmax, ymin, ymax);
      if (!kl) continue;
      const t = (bufT[k - 1] + bufT[k]) / 2;
      const bredde_px = maxB * mellem(pensel.bredde, t);
      const styrke = mellem(pensel.styrke, t);
      for (const [b, a] of lag) {
        L.strokeStyle = blaek((pensel.blod ? a : pensel.alpha) * styrke);
        L.lineWidth = Math.max(bredde_px * b, 0.3);
        L.beginPath();
        L.moveTo(kl[0], kl[1]);
        L.lineTo(kl[2], kl[3]);
        L.stroke();
      }
    }
  }

  // Læg laget på lærredet (i enhedens pixels)
  const sx = Math.floor(x0 * dpr), sy = Math.floor(y0 * dpr);
  const sw = Math.min(lagCanvas.width - sx, Math.ceil((x1 - x0) * dpr));
  const sh = Math.min(lagCanvas.height - sy, Math.ceil((y1 - y0) * dpr));
  if (sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1;
  ctx.drawImage(lagCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

// Streg med trykfølsom styrke uden blanding: hvert stykke tegnes som en fuldt dækkende farve,
// der svarer til stregen på hvidt papir. Så bliver overlap ikke mørkere.
function tegnTrykOpak(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const rgb = hexTilRgb(s.c || '#000000');
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);
  const lag = pensel.blod ? BLOD_LAG : [[1, pensel.alpha]];
  ctx.globalAlpha = 1;
  if (n === 1) {
    if (!(bufX[0] > xmin && bufX[0] < xmax && bufY[0] > ymin && bufY[0] < ymax)) return;
    for (const [b, a] of lag) {
      ctx.fillStyle = inkPaaHvid(rgb, a * mellem(pensel.styrke, bufT[0]));
      ctx.beginPath();
      ctx.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, bufT[0]) * b, 0.3) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  for (const [b, a] of lag) {            // yderste lag først, så de stærkeste ligger øverst
    for (let k = 1; k < n; k++) {
      const kl = klip(bufX[k - 1], bufY[k - 1], bufX[k], bufY[k], xmin, xmax, ymin, ymax);
      if (!kl) continue;
      const t = (bufT[k - 1] + bufT[k]) / 2;
      ctx.strokeStyle = inkPaaHvid(rgb, (pensel.blod ? a : pensel.alpha) * mellem(pensel.styrke, t));
      ctx.lineWidth = Math.max(maxB * mellem(pensel.bredde, t) * b, 0.3);
      ctx.beginPath();
      ctx.moveTo(kl[0], kl[1]);
      ctx.lineTo(kl[2], kl[3]);
      ctx.stroke();
    }
  }
}

function tegnStreg(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const c = s.c || '#000000';
  if (s.t === 'visk') {
    tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, [[1, '#ffffff', 1]]);
    return;
  }
  if (s.pr && s.t === 'fyldepen') {
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.globalAlpha = 1;
    tegnTryk(s, z, kxh, kxl, kyh, kyl, cx, cy);
  } else if (s.pr) {
    ctx.globalAlpha = 1;
    if (s.m) tegnTrykLag(s, z, kxh, kxl, kyh, kyl, cx, cy);
    else tegnTrykOpak(s, z, kxh, kxl, kyh, kyl, cx, cy);
  } else {
    // Lag: [bredde-andel, farve, gennemsigtighed]. Med blanding bruges gennemsigtighed,
    // uden blanding bruges den tilsvarende fuldt dækkende farve.
    const styrke = typeof s.a === 'number' ? s.a : pensel.alpha;   // fast styrke for denne streg
    let lag;
    if (s.m) {
      lag = pensel.blod ? BLOD_LAG.map(([b, a]) => [b, c, a * styrke]) : [[1, c, styrke]];
    } else {
      const rgb = hexTilRgb(c);
      lag = pensel.blod ? BLOD_LAG.map(([b, a]) => [b, inkPaaHvid(rgb, a * styrke), 1]) : [[1, inkPaaHvid(rgb, styrke), 1]];
    }
    tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, lag);
  }
  ctx.globalAlpha = 1;
}

function tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, lag) {
  const p = s.p;
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const indenfor = (x, y) => x > xmin && x < xmax && y > ymin && y < ymax;

  let n = 0;
  let lx = ((p[0] - kxh) - kxl) * z + cx;
  let ly = ((p[1] - kyh) - kyl) * z + cy;
  bufX[0] = lx; bufY[0] = ly; n = 1;
  for (let i = 2; i < p.length; i += 2) {
    const x = ((p[i] - kxh) - kxl) * z + cx;
    const y = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy >= 1) {
      bufX[n] = x; bufY[n] = y; n++;
      lx = x; ly = y;
    }
  }
  const slutX = ((p[p.length - 2] - kxh) - kxl) * z + cx;
  const slutY = ((p[p.length - 1] - kyh) - kyl) * z + cy;
  if (n > 1 && (bufX[n - 1] !== slutX || bufY[n - 1] !== slutY)) {
    bufX[n] = slutX; bufY[n] = slutY; n++;
  }

  const linjeB = Math.min(Math.max(s.w * z, 0.3), MAX_LINJEBREDDE);

  if (n === 1) {
    if (!indenfor(bufX[0], bufY[0])) return;
    for (const [b, stil, a] of lag) {
      ctx.fillStyle = stil;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(bufX[0], bufY[0], Math.max(linjeB * b, 0.3) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  let pennOK = false;
  let ax = bufX[0], ay = bufY[0];
  for (let i = 1; i < n; i++) {
    let cxp = null, cyp = null, bx, by;
    if (i < n - 1) {
      cxp = bufX[i]; cyp = bufY[i];
      bx = (bufX[i] + bufX[i + 1]) / 2;
      by = (bufY[i] + bufY[i + 1]) / 2;
    } else {
      bx = bufX[i]; by = bufY[i];
    }
    const sikker = indenfor(ax, ay) && indenfor(bx, by) &&
                   (cxp === null || indenfor(cxp, cyp));
    if (sikker) {
      if (!pennOK) ctx.moveTo(ax, ay);
      if (cxp === null) ctx.lineTo(bx, by);
      else ctx.quadraticCurveTo(cxp, cyp, bx, by);
      pennOK = true;
    } else {
      const k = klip(ax, ay, bx, by, xmin, xmax, ymin, ymax);
      if (k) {
        ctx.moveTo(k[0], k[1]);
        ctx.lineTo(k[2], k[3]);
      }
      pennOK = false;
    }
    ax = bx; ay = by;
  }
  for (const [b, stil, a] of lag) {
    ctx.strokeStyle = stil;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.max(linjeB * b, 0.3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------- mellemlager og tegning af hele billedet ----------

function sikrBase() {
  if (!baseCanvas || baseCanvas.width !== laerred.width || baseCanvas.height !== laerred.height) {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = laerred.width;
    baseCanvas.height = laerred.height;
    baseCtx = baseCanvas.getContext('2d');
    baseGyldig = false;
  }
}

function kameraLigBase() {
  return !!baseKamera && baseKamera.node === kamera.node && baseKamera.x === kamera.x &&
         baseKamera.y === kamera.y && baseKamera.zoom === kamera.zoom;
}

// Tegn alle synlige streger (undtagen den, der tegnes lige nu) på mellemlageret,
// i den rækkefølge de blev lavet, så viskelæderet fjerner præcis det, der lå under det.
function tegnAltTilBase() {
  const t0 = performance.now();
  const gammel = ctx;
  ctx = baseCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bredde, hoejde);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const udenStreg = tegnerNu;
  const liste = [];
  gennemloebAlt((node, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s !== udenStreg) liste.push({ s, z, kxh, kxl, kyh, kyl, cx, cy });
  });
  liste.sort((a, b) => a.s.id - b.s.id);
  for (const k of liste) tegnStreg(k.s, k.z, k.kxh, k.kxl, k.kyh, k.kyl, k.cx, k.cy);
  ctx = gammel;

  tegnet = liste.length;
  baseGyldig = true;
  baseKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  fuldTid = fuldTid * 0.6 + (performance.now() - t0) * 0.4;
}

function tegn() {
  snavs = false;
  const nu = performance.now();
  sikrBase();

  if (!forrigeKamera || forrigeKamera.node !== kamera.node || forrigeKamera.x !== kamera.x ||
      forrigeKamera.y !== kamera.y || forrigeKamera.zoom !== kamera.zoom) {
    sidsteBevaegelse = nu;
    forrigeKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  }

  // På langsomme enheder vises under pan/zoom det gamle billede flyttet/forstørret (hurtigt),
  // og først når bevægelsen stopper, tegnes alt skarpt igen.
  let preview = false;
  if (!baseGyldig) {
    tegnAltTilBase();
  } else if (!kameraLigBase()) {
    if (fuldTid > 12 && !tegnerNu && baseKamera.node === kamera.node && nu - sidsteBevaegelse < 150) {
      preview = true;
    } else {
      tegnAltTilBase();
    }
  }

  const c0 = bredde / 2, c1 = hoejde / 2;
  hovedCtx.setTransform(1, 0, 0, 1, 0, 0);
  hovedCtx.globalCompositeOperation = 'source-over';
  hovedCtx.globalAlpha = 1;
  if (preview) {
    const k = kamera.zoom / baseKamera.zoom;
    const ox = (baseKamera.x - kamera.x) * kamera.zoom;
    const oy = (baseKamera.y - kamera.y) * kamera.zoom;
    hovedCtx.fillStyle = '#ffffff';
    hovedCtx.fillRect(0, 0, laerred.width, laerred.height);
    hovedCtx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (c0 * (1 - k) + ox), dpr * (c1 * (1 - k) + oy));
    hovedCtx.drawImage(baseCanvas, 0, 0, baseCanvas.width, baseCanvas.height, 0, 0, bredde, hoejde);
    previewVentende = true;
  } else {
    hovedCtx.drawImage(baseCanvas, 0, 0);
  }

  hovedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hovedCtx.lineCap = 'round';
  hovedCtx.lineJoin = 'round';

  // Den streg, der tegnes lige nu, tegnes oven på
  if (!preview && tegnerNu && tegnerNode === kamera.node) {
    const gammel = ctx;
    ctx = hovedCtx;
    tegnStreg(tegnerNu, kamera.zoom, kamera.x, 0, kamera.y, 0, c0, c1);
    ctx = gammel;
  }

  // Viskelæderets cirkel
  if (erViskeVaerktoej(vaerktoej) && musX >= 0) {
    hovedCtx.globalAlpha = 1;
    hovedCtx.lineWidth = 1.5;
    hovedCtx.strokeStyle = '#777777';
    hovedCtx.beginPath();
    hovedCtx.arc(musX, musY, STOERRELSE[vaerktoej] / 2, 0, Math.PI * 2);
    hovedCtx.stroke();
  }

  if (visFejlsoeg) {
    const linjer = ['kamera: x=' + kamera.x.toExponential(3) + ' y=' + kamera.y.toExponential(3) +
      ' zoom=' + kamera.zoom.toPrecision(4),
      'historik: ' + fortrydStak.length + ' fortryd, ' + gentagStak.length + ' gentag',
      'fuld tegning: ' + fuldTid.toFixed(1) + ' ms' + (preview ? ' (viser forhåndsvisning)' : '')];
    let m = kamera.node, d = 0;
    while (m && d < 8) {
      linjer.push('niveau ' + m.niveau + ': ' + m.strokes.length + ' streger, ' + m.children.length +
        ' børn, box ' + (m.box ? 'ja' : 'NEJ') + (m.parent ? ', origo ' + m.ox.toExponential(2) + ',' + m.oy.toExponential(2) : ', øverst'));
      m = m.parent; d++;
    }
    fejlsoeg.textContent = linjer.join('\n');
  }
  zoomtekst.textContent = 'Zoom ' + zoomTekst() + ' · niveau ' + kamera.node.niveau +
    ' · ' + tegnet + ' af ' + antalStreger + ' streger tegnet';
}

function loop() {
  if (previewVentende && performance.now() - sidsteBevaegelse >= 150) {
    previewVentende = false;
    snavs = true;
  }
  if (snavs) tegn();
  requestAnimationFrame(loop);
}

// ---------- "slet streg" (fjerner hele streger) ----------

// Rammer cirklen (radius r om (px, py)) stregen? Afstand regnes i skærmpixels.
function stregVedPunkt(s, z, kxh, kxl, kyh, kyl, cx, cy, px, py, radius) {
  const p = s.p;
  const r = radius + Math.min(s.w * z / 2, 1e12);
  const r2 = r * r;
  let ax = ((p[0] - kxh) - kxl) * z + cx;
  let ay = ((p[1] - kyh) - kyl) * z + cy;
  if (p.length === 2) return (ax - px) * (ax - px) + (ay - py) * (ay - py) <= r2;
  for (let i = 2; i < p.length; i += 2) {
    const bx = ((p[i] - kxh) - kxl) * z + cx;
    const by = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    if (qx * qx + qy * qy <= r2) return true;
    ax = bx; ay = by;
  }
  return false;
}

function sletStregVed(px, py) {
  const radius = STOERRELSE.slet / 2;
  const ramt = [];
  gennemloebAlt((node, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s.t === 'visk') return; // selve viskelæder-stregerne er usynlige og røres ikke
    if (stregVedPunkt(s, z, kxh, kxl, kyh, kyl, cx, cy, px, py, radius)) ramt.push([node, s]);
  });
  for (const [node, s] of ramt) {
    const i = node.strokes.indexOf(s);
    if (i < 0) continue;
    node.strokes.splice(i, 1);
    antalStreger--;
    sletItems.push({ node, stroke: s, index: i });
  }
  if (ramt.length) { baseGyldig = false; snavs = true; }
}

// ---------- tegning med pen/finger ----------

function tilfoejPunkt(streg, wx, wy, tryk) {
  const p = streg.p;
  const n = p.length;
  if (n >= 2) {
    const dx = (wx - p[n - 2]) * kamera.zoom;
    const dy = (wy - p[n - 1]) * kamera.zoom;
    if (dx * dx + dy * dy < 1) return;
  }
  p.push(wx, wy);
  if (streg.pr) streg.pr.push(tryk === undefined || tryk === null ? 0.6 : tryk);
  if (wx < streg.minX) streg.minX = wx;
  if (wx > streg.maxX) streg.maxX = wx;
  if (wy < streg.minY) streg.minY = wy;
  if (wy > streg.maxY) streg.maxY = wy;
  const pad = streg.w / 2;
  udvidBox(tegnerNode, wx - pad, wx + pad, wy - pad, wy + pad);
}

// type: 'spids' | 'blod' | 'fyldepen' | 'tusse' | 'visk'
// tryk: stylussens rå tryk (0-1) eller null/undefined for mus og finger
function startStreg(sx, sy, tryk, type) {
  type = type || vaerktoej;
  if (!STOERRELSE[type] || type === 'slet' || type === 'pipette') type = 'spids';
  const [wx, wy] = tilVerden(sx, sy);
  const pensel = PENSLER[type];
  const medStylus = trykTil && typeof tryk === 'number' && type !== 'visk';
  const brugTryk = !!pensel && (medStylus || (trykTil && !!pensel.fart));
  const px = STOERRELSE[type] * (type === 'fyldepen' ? 1.5 : 1);   // w = største bredde
  tegnerNode = kamera.node;
  tegnerNu = {
    id: naesteId++,
    t: type,
    c: type === 'visk' ? null : farve,
    m: blandFarver,
    a: fastStyrke,
    p: [wx, wy],
    pr: brugTryk ? [medStylus ? trykKurve(tryk) : 0.6] : null,
    w: px / kamera.zoom,
    minX: wx, maxX: wx, minY: wy, maxY: wy,
    _p: 0.6, _x: sx, _y: sy, _t: 0   // tilstand til simuleret tryk (bruges ikke ved gemning)
  };
  tegnerNode.strokes.push(tegnerNu);
  antalStreger++;
  const pad = tegnerNu.w / 2;
  udvidBox(tegnerNode, wx - pad, wx + pad, wy - pad, wy + pad);
  snavs = true;
}

function afbrydStreg() {
  if (tegnerNu && tegnerNode) {
    const i = tegnerNode.strokes.lastIndexOf(tegnerNu);
    if (i >= 0) { tegnerNode.strokes.splice(i, 1); antalStreger--; }
  }
  tegnerNu = null;
  tegnerNode = null;
  snavs = true;
}

function toFingre() {
  const [a, b] = [...pegere.values()];
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
  };
}

// Tryk til en streg, der bruger varierende bredde. Stylus: rigtigt tryk. Mus/finger: ud fra farten
// (langsomt = tykt, hurtigt = tyndt), glattet, så bredden ikke hopper.
function trykTilPunkt(streg, h) {
  if (!streg.pr) return null;
  if (h.pointerType === 'pen') return trykKurve(h.pressure || 0);
  const nu = h.timeStamp || 0;
  const dt = Math.max(nu - streg._t, 1);
  const d = Math.hypot(h.clientX - streg._x, h.clientY - streg._y);
  const maal = 1 - Math.min((d / dt) / 2.5, 1) * 0.75;
  streg._p = streg._p * 0.85 + maal * 0.15;
  streg._t = nu; streg._x = h.clientX; streg._y = h.clientY;
  return streg._p;
}

function registrerTryk(e) {
  if (e.pointerType === 'pen' && e.pressure > hoejesteTryk + 0.005) {
    hoejesteTryk = e.pressure;
    trykMaaling.textContent = 'Højeste tryk målt: ' + Math.round(hoejesteTryk * 100) + ' %';
  }
}

laerred.addEventListener('pointerdown', e => {
  e.preventDefault();
  registrerTryk(e);
  laerred.setPointerCapture(e.pointerId);

  if (e.pointerType === 'mouse' && e.button !== 0) {
    hoejreTraek = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  // Håndfladeafvisning: mens en stylus er nede, ignoreres fingre
  for (const q of pegere.values()) {
    if (q.type === 'pen' && e.pointerType === 'touch') return;
  }
  pegere.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

  if (pegere.size === 1) {
    // Stylussens viskelæder-ende/knap virker som præcist viskelæder i dette ene træk
    const penViskelaeder = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
    const v = penViskelaeder ? 'visk' : vaerktoej;
    if (erViskeVaerktoej(vaerktoej)) { musX = e.clientX; musY = e.clientY; }
    if (v === 'pipette') {
      samlFarveOp(e.clientX, e.clientY);
      vaelgVaerktoej(sidstePensel);
    } else if (v === 'slet') {
      sletAktiv = true;
      sletItems = [];
      sletStregVed(e.clientX, e.clientY);
    } else {
      startStreg(e.clientX, e.clientY, e.pointerType === 'pen' ? (e.pressure || 0) : null, v);
      if (tegnerNu) { tegnerNu._t = e.timeStamp || 0; }
    }
  } else if (pegere.size === 2) {
    afbrydStreg();
    afslutSlet();
    bevaegelse = toFingre();
  }
});

laerred.addEventListener('pointermove', e => {
  registrerTryk(e);
  if (erViskeVaerktoej(vaerktoej)) { musX = e.clientX; musY = e.clientY; snavs = true; }

  if (hoejreTraek && hoejreTraek.id === e.pointerId) {
    panSkaerm(e.clientX - hoejreTraek.x, e.clientY - hoejreTraek.y);
    hoejreTraek.x = e.clientX;
    hoejreTraek.y = e.clientY;
    return;
  }
  const p = pegere.get(e.pointerId);
  if (!p) return;

  if (pegere.size === 1 && tegnerNu) {
    const haendelser = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const h of (haendelser.length ? haendelser : [e])) {
      const [wx, wy] = tilVerden(h.clientX, h.clientY);
      tilfoejPunkt(tegnerNu, wx, wy, trykTilPunkt(tegnerNu, h));
    }
    snavs = true;
  } else if (pegere.size === 1 && sletAktiv) {
    sletStregVed(e.clientX, e.clientY);
  }
  p.x = e.clientX;
  p.y = e.clientY;

  if (pegere.size === 2 && bevaegelse) {
    const nu = toFingre();
    panSkaerm(nu.cx - bevaegelse.cx, nu.cy - bevaegelse.cy);
    zoomOmkring(nu.cx, nu.cy, kamera.zoom * (nu.d / bevaegelse.d));
    bevaegelse = nu;
  }
});

function slip(e) {
  if (hoejreTraek && hoejreTraek.id === e.pointerId) {
    hoejreTraek = null;
    return;
  }
  if (!pegere.has(e.pointerId)) return;
  pegere.delete(e.pointerId);
  if (pegere.size < 2) bevaegelse = null;
  if (pegere.size === 0) { afslutStreg(); afslutSlet(); }
}
laerred.addEventListener('pointerup', slip);
laerred.addEventListener('pointercancel', e => {
  if (pegere.size === 1) afbrydStreg();
  slip(e);
});

laerred.addEventListener('pointerleave', () => {
  if (erViskeVaerktoej(vaerktoej)) { musX = -1; snavs = true; }
});

laerred.addEventListener('wheel', e => {
  e.preventDefault();
  const faktor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.0015)));
  zoomOmkring(e.clientX, e.clientY, kamera.zoom * faktor);
}, { passive: false });

laerred.addEventListener('contextmenu', e => e.preventDefault());

// ---------- knapper og tastatur ----------

nulstilKnap.addEventListener('click', () => {
  afbrydStreg();
  afslutSlet();
  kamera.node = start;
  kamera.x = 0; kamera.y = 0; kamera.zoom = 1;
  snavs = true;
});
for (const b of vaerktoejKnapper) b.addEventListener('click', () => vaelgVaerktoej(b.dataset.v));
knapFortryd.addEventListener('click', fortryd);
knapGentag.addEventListener('click', gentag);
menuKnap.addEventListener('click', () => {
  menuAaben = !menuAaben;
  gemIndstillinger();
  opdaterKnapper();
});
trykGlider.addEventListener('input', () => {
  trykFuld = Math.min(1, Math.max(0.05, Number(trykGlider.value) / 100));
  gemIndstillinger();
  opdaterKnapper();
});
stoerrelseGlider.addEventListener('input', () => {
  const [mn, mx] = GRAENSER[vaerktoej];
  saetStoerrelse(mn * Math.pow(mx / mn, Number(stoerrelseGlider.value) / 100));
});

trykKnap.addEventListener('click', () => {
  trykTil = !trykTil;
  gemIndstillinger();
  opdaterKnapper();
});
styrkeGlider.addEventListener('input', () => {
  fastStyrke = Math.min(1, Math.max(0.05, Number(styrkeGlider.value) / 100));
  gemIndstillinger();
  opdaterKnapper();
});
brugHoejesteKnap.addEventListener('click', () => {
  if (hoejesteTryk <= 0) return;
  trykFuld = Math.min(1, Math.max(0.05, hoejesteTryk * 0.9));
  gemIndstillinger();
  opdaterKnapper();
});
nulstilMaalingKnap.addEventListener('click', () => {
  hoejesteTryk = 0;
  trykMaaling.textContent = 'Tegn med stylus for at måle dit tryk';
});
blandKnap.addEventListener('click', () => {
  blandFarver = !blandFarver;
  gemIndstillinger();
  opdaterKnapper();
});
farveKnap.addEventListener('click', () => {
  farvePanelAaben = !farvePanelAaben;
  opdaterFarveUI();
});
lysstyrkeGlider.addEventListener('input', () => saetLysstyrke(Number(lysstyrkeGlider.value) / 100));
gemFarveKnap.addEventListener('click', () => {
  if (!gemteFarver.includes(farve)) {
    gemteFarver.push(farve);
    if (gemteFarver.length > MAX_GEMTE) gemteFarver.shift();
    gemIndstillinger();
  }
  opdaterFarveUI();
});
fjernFarveKnap.addEventListener('click', () => {
  gemteFarver = gemteFarver.filter(h => h !== farve);
  gemIndstillinger();
  opdaterFarveUI();
});
function hjulPeger(e) {
  const r = farvehjul.getBoundingClientRect();
  const W = farvehjul.width, k = W / r.width, R = W / 2 - 3;
  const dx = (e.clientX - r.left) * k - W / 2, dy = (e.clientY - r.top) * k - W / 2;
  saetFraHjul((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, Math.min(Math.hypot(dx, dy), R) / R);
}
farvehjul.addEventListener('pointerdown', e => {
  e.preventDefault();
  farvehjul.setPointerCapture(e.pointerId);
  hjulTrukket = true;
  hjulPeger(e);
});
farvehjul.addEventListener('pointermove', e => { if (hjulTrukket) hjulPeger(e); });
farvehjul.addEventListener('pointerup', () => { hjulTrukket = false; });
farvehjul.addEventListener('pointercancel', () => { hjulTrukket = false; });

window.addEventListener('keydown', e => {
  if (galleriAaben) return;   // genveje virker kun i selve tegneren
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) gentag(); else fortryd();
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    gentag();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (k === 'd') {
      visFejlsoeg = !visFejlsoeg;
      fejlsoeg.style.display = visFejlsoeg ? 'block' : 'none';
      snavs = true;
    } else if (k === 'e') {
      vaelgVaerktoej('visk');
    } else if (k === 'p') {
      vaelgVaerktoej('spids');
    } else if (k === 'i') {
      vaelgVaerktoej('pipette');
    } else if (k === 'b') {
      blandFarver = !blandFarver;
      gemIndstillinger();
      opdaterKnapper();
    } else if (k === '[') {
      saetStoerrelse(STOERRELSE[vaerktoej] / 1.25);
    } else if (k === ']') {
      saetStoerrelse(STOERRELSE[vaerktoej] * 1.25);
    }
  }
});

// ======================================================================
// Bid 6: lagring (flere lærreder), galleri og automatisk gem
// ======================================================================
// Hvert lærred gemmes i browserens database (IndexedDB) på tabletten:
//   "meta":  id, navn, tidspunkter, miniature (til galleriet)
//   "data":  selve tegningen (træet af niveauer med streger)
// Alt, der læses fra databasen, kontrolleres, før det bruges.

const FORMAT_NAVN = 'uendeligt-laerred';
const FORMAT_VERSION = 1;
const MAX_NODER = 20000;
const MAX_STROEGER = 300000;
const MAX_PUNKTER_PR_STREG = 1000000;
const MAX_PUNKTER_I_ALT = 30000000;
const STREG_TYPER = ['spids', 'blod', 'fyldepen', 'tusse', 'visk'];
const MAX_NAVN = 80;
const GEM_FORSINKELSE = 1500;   // ms efter sidste ændring, før der gemmes

let aktivtId = null;            // det lærred, der er åbent (null = ikke gemt noget sted)
let galleriAaben = true;
let optaget = false;
let aendringsNr = 0;
let gemtNr = 0;
let gemTimer = null, gemmer = false, gemIgen = false;
let sidstGemtKamera = null;

const galleriEl = document.getElementById('galleri');
const galleriGitter = document.getElementById('galleriGitter');
const galleriBesked = document.getElementById('galleriBesked');
const nytLaerredKnap = document.getElementById('nytLaerredKnap');
const knapGalleri = document.getElementById('knapGalleri');
const gemStatus = document.getElementById('gemStatus');
const dialogEl = document.getElementById('dialog');
const dialogTitel = document.getElementById('dialogTitel');
const dialogTekst = document.getElementById('dialogTekst');
const dialogInput = document.getElementById('dialogInput');
const dialogOk = document.getElementById('dialogOk');
const dialogAnnuller = document.getElementById('dialogAnnuller');

// ---------- serialisering ----------

function stregTilData(s) {
  if (!s._tp || s._tpN !== s.p.length) { s._tp = Float64Array.from(s.p); s._tpN = s.p.length; }
  let pr = null;
  if (s.pr) {
    if (!s._tr || s._trN !== s.pr.length) { s._tr = Float32Array.from(s.pr); s._trN = s.pr.length; }
    pr = s._tr;
  }
  return { id: s.id, t: s.t, c: s.c || null, m: !!s.m, a: typeof s.a === 'number' ? s.a : 1, w: s.w, p: s._tp, pr };
}

function tilData() {
  let top = start;
  while (top.parent) top = top.parent;
  // Behold kun niveauer med indhold, samt dem kameraet og startvisningen står i
  const behold = new Map();
  (function maal(n) {
    let ja = n === kamera.node || n === start || n.strokes.length > 0;
    for (const c of n.children) if (maal(c)) ja = true;
    behold.set(n, ja);
    return ja;
  })(top);
  const noder = [];
  const indeks = new Map();
  (function skriv(n, foraeldre) {
    indeks.set(n, noder.length);
    noder.push({ parent: foraeldre, ox: n.ox, oy: n.oy, niveau: n.niveau, strokes: n.strokes.map(stregTilData) });
    for (const c of n.children) if (behold.get(c)) skriv(c, indeks.get(n));
  })(top, -1);
  return {
    format: FORMAT_NAVN,
    version: FORMAT_VERSION,
    naesteId,
    startIndex: indeks.get(start),
    kamera: { nodeIndex: indeks.get(kamera.node), x: kamera.x, y: kamera.y, zoom: kamera.zoom },
    noder
  };
}

function tomData() {
  return {
    format: FORMAT_NAVN, version: FORMAT_VERSION, naesteId: 1, startIndex: 0,
    kamera: { nodeIndex: 0, x: 0, y: 0, zoom: 1 },
    noder: [{ parent: -1, ox: 0, oy: 0, niveau: 0, strokes: [] }]
  };
}

function erTalVaerdi(x) { return typeof x === 'number' && isFinite(x); }
function erFelt(a) { return Array.isArray(a) || (ArrayBuffer.isView(a) && !(a instanceof DataView)); }

// Kontrollerer data og bygger et nyt træ. Kaster en fejl, hvis noget er forkert.
// Rører ikke ved det åbne lærred.
function byggFraData(d) {
  const fejl = tekst => { throw new Error(tekst); };
  if (!d || typeof d !== 'object') fejl('Ingen data');
  if (d.format !== FORMAT_NAVN) fejl('Ukendt filformat');
  if (d.version !== FORMAT_VERSION) fejl('Ukendt version (' + String(d.version).slice(0, 10) + ')');
  if (!Array.isArray(d.noder) || d.noder.length < 1 || d.noder.length > MAX_NODER) fejl('Ugyldigt antal niveauer');
  if (!Number.isInteger(d.startIndex) || d.startIndex < 0 || d.startIndex >= d.noder.length) fejl('Ugyldig start');
  const kam = d.kamera;
  if (!kam || !Number.isInteger(kam.nodeIndex) || kam.nodeIndex < 0 || kam.nodeIndex >= d.noder.length) fejl('Ugyldig kamera');

  const noder = [];
  let strokeTotal = 0, punktTotal = 0, hoejesteId = 0;
  for (let i = 0; i < d.noder.length; i++) {
    const nd = d.noder[i];
    if (!nd || typeof nd !== 'object') fejl('Ugyldigt niveau');
    if (i === 0 ? nd.parent !== -1 : !(Number.isInteger(nd.parent) && nd.parent >= 0 && nd.parent < i)) fejl('Ugyldig forælder');
    if (!erTalVaerdi(nd.ox) || !erTalVaerdi(nd.oy) || !Number.isInteger(nd.niveau) || Math.abs(nd.niveau) > 100000) fejl('Ugyldigt niveau');
    if (!Array.isArray(nd.strokes)) fejl('Ugyldige streger');
    const node = nyNode(i === 0 ? null : noder[nd.parent], i === 0 ? 0 : nd.ox, i === 0 ? 0 : nd.oy, nd.niveau);
    if (i > 0) node.parent.children.push(node);
    noder.push(node);
  }
  for (let i = 0; i < d.noder.length; i++) {
    const nd = d.noder[i], node = noder[i];
    strokeTotal += nd.strokes.length;
    if (strokeTotal > MAX_STROEGER) fejl('For mange streger');
    for (const sd of nd.strokes) {
      if (!sd || typeof sd !== 'object') fejl('Ugyldig streg');
      if (!STREG_TYPER.includes(sd.t)) fejl('Ukendt penseltype');
      if (!Number.isInteger(sd.id) || sd.id < 1 || sd.id > 1e12) fejl('Ugyldigt streg-id');
      if (sd.c !== null && sd.c !== undefined && !erHex(sd.c)) fejl('Ugyldig farve');
      if (!(erTalVaerdi(sd.a) && sd.a >= 0.05 && sd.a <= 1)) fejl('Ugyldig styrke');
      if (!(erTalVaerdi(sd.w) && sd.w > 0)) fejl('Ugyldig bredde');
      if (!erFelt(sd.p) || sd.p.length < 2 || sd.p.length % 2 !== 0 || sd.p.length > MAX_PUNKTER_PR_STREG * 2) fejl('Ugyldige punkter');
      punktTotal += sd.p.length / 2;
      if (punktTotal > MAX_PUNKTER_I_ALT) fejl('For mange punkter');
      for (let k = 0; k < sd.p.length; k++) if (!erTalVaerdi(sd.p[k])) fejl('Ugyldigt punkt');
      let pr = null;
      if (sd.pr !== null && sd.pr !== undefined) {
        if (!erFelt(sd.pr) || sd.pr.length !== sd.p.length / 2) fejl('Ugyldigt tryk');
        for (let k = 0; k < sd.pr.length; k++) if (!(erTalVaerdi(sd.pr[k]) && sd.pr[k] >= 0 && sd.pr[k] <= 1)) fejl('Ugyldigt tryk');
        pr = Array.from(sd.pr);
      }
      const p = Array.from(sd.p);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        if (p[k] < minX) minX = p[k];
        if (p[k] > maxX) maxX = p[k];
        if (p[k + 1] < minY) minY = p[k + 1];
        if (p[k + 1] > maxY) maxY = p[k + 1];
      }
      const streg = {
        id: sd.id, t: sd.t, c: sd.t === 'visk' ? null : (sd.c ? sd.c.toLowerCase() : '#000000'),
        m: !!sd.m, a: sd.a, p, pr, w: sd.w, minX, maxX, minY, maxY
      };
      node.strokes.push(streg);
      if (sd.id > hoejesteId) hoejesteId = sd.id;
      udvidBox(node, minX - sd.w / 2, maxX + sd.w / 2, minY - sd.w / 2, maxY + sd.w / 2);
    }
  }
  let zoom = kam.zoom, kx = kam.x, ky = kam.y;
  if (!(erTalVaerdi(zoom) && zoom > 0)) zoom = 1;
  if (!erTalVaerdi(kx) || !erTalVaerdi(ky)) { kx = 0; ky = 0; }
  return {
    start: noder[d.startIndex], kameraNode: noder[kam.nodeIndex], kx, ky, zoom,
    antal: strokeTotal, naesteId: hoejesteId + 1
  };
}

// Sæt et bygget lærred ind i editoren
function indlaes(b) {
  start = b.start;
  kamera.node = b.kameraNode;
  kamera.x = b.kx; kamera.y = b.ky; kamera.zoom = b.zoom;
  antalStreger = b.antal;
  naesteId = b.naesteId;
  fortrydStak.length = 0;
  gentagStak.length = 0;
  tegnerNu = null; tegnerNode = null;
  sletAktiv = false; sletItems = [];
  pegere.clear();
  bevaegelse = null; hoejreTraek = null;
  baseGyldig = false;
  baseKamera = null; forrigeKamera = null;
  skiftNiveau();
  sidstGemtKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  aendringsNr = 0; gemtNr = 0;
  opdaterKnapper();
  snavs = true;
}

// ---------- database ----------

function renMeta(m) {
  if (!m || typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id)) return null;
  const mini = typeof m.miniature === 'string' && m.miniature.startsWith('data:image/png;base64,') &&
               m.miniature.length < 2000000 && /^[A-Za-z0-9+/=,:;]*$/.test(m.miniature.slice(0, 100)) ? m.miniature : null;
  return {
    id: m.id,
    navn: typeof m.navn === 'string' ? m.navn.slice(0, MAX_NAVN) : 'Lærred',
    oprettet: erTalVaerdi(m.oprettet) ? m.oprettet : 0,
    aendret: erTalVaerdi(m.aendret) ? m.aendret : 0,
    antal: Number.isInteger(m.antal) && m.antal >= 0 ? m.antal : 0,
    miniature: mini
  };
}

const lager = {
  db: null,
  init() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB mangler')); return; }
      const r = indexedDB.open('tegneapp', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error || new Error('Kunne ikke åbne databasen'));
      r.onblocked = () => rej(new Error('Databasen er blokeret af en anden fane'));
    });
  },
  tx(lagre, tilstand, arbejde) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(lagre, tilstand);
      let svar;
      t.oncomplete = () => res(svar);
      t.onerror = () => rej(t.error || new Error('Databasefejl'));
      t.onabort = () => rej(t.error || new Error('Databasen afbrød handlingen'));
      arbejde(t, v => { svar = v; });
    });
  },
  alleMeta() {
    return this.tx(['meta'], 'readonly', (t, saet) => {
      const rq = t.objectStore('meta').getAll();
      rq.onsuccess = () => saet((rq.result || []).map(renMeta).filter(Boolean).sort((a, b) => b.aendret - a.aendret));
    });
  },
  hentData(id) {
    return this.tx(['data'], 'readonly', (t, saet) => {
      const rq = t.objectStore('data').get(id);
      rq.onsuccess = () => saet(rq.result ? rq.result.data : null);
    });
  },
  opret(id, navn, data) {
    const nu = Date.now();
    return this.tx(['meta', 'data'], 'readwrite', t => {
      t.objectStore('meta').put({ id, navn, oprettet: nu, aendret: nu, miniature: null, antal: 0 });
      t.objectStore('data').put({ id, data });
    });
  },
  skriv(id, data, miniature, antal) {
    return this.tx(['meta', 'data'], 'readwrite', t => {
      const meta = t.objectStore('meta'), dat = t.objectStore('data');
      const rq = meta.get(id);
      rq.onsuccess = () => {
        const gl = rq.result || { id, navn: 'Lærred', oprettet: Date.now() };
        meta.put({ id, navn: gl.navn, oprettet: gl.oprettet, aendret: Date.now(), miniature: miniature || gl.miniature || null, antal });
        dat.put({ id, data });
      };
    });
  },
  omdoeb(id, navn) {
    return this.tx(['meta'], 'readwrite', t => {
      const meta = t.objectStore('meta');
      const rq = meta.get(id);
      rq.onsuccess = () => { if (rq.result) { rq.result.navn = navn; meta.put(rq.result); } };
    });
  },
  slet(id) {
    return this.tx(['meta', 'data'], 'readwrite', t => {
      t.objectStore('meta').delete(id);
      t.objectStore('data').delete(id);
    });
  },
  dupliker(id, nytId, nytNavn) {
    return this.tx(['meta', 'data'], 'readwrite', t => {
      const meta = t.objectStore('meta'), dat = t.objectStore('data');
      const r1 = meta.get(id), r2 = dat.get(id);
      let klar = 0;
      const faerdig = () => {
        if (++klar < 2 || !r1.result || !r2.result) return;
        const nu = Date.now();
        meta.put({ id: nytId, navn: nytNavn, oprettet: nu, aendret: nu, miniature: r1.result.miniature || null, antal: r1.result.antal || 0 });
        dat.put({ id: nytId, data: r2.result.data });
      };
      r1.onsuccess = faerdig;
      r2.onsuccess = faerdig;
    });
  }
};

function nytId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* brug reserve */ }
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function renseNavn(t) {
  return String(t).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAVN);
}

// ---------- automatisk gem ----------

function markerAendret() {
  aendringsNr++;
  if (!aktivtId) return;
  gemStatus.textContent = 'Ikke gemt endnu';
  if (gemTimer) clearTimeout(gemTimer);
  gemTimer = setTimeout(() => { gemTimer = null; gemNu(false); }, GEM_FORSINKELSE);
}

function kameraAendretSidenGem() {
  return !sidstGemtKamera || sidstGemtKamera.node !== kamera.node || sidstGemtKamera.x !== kamera.x ||
         sidstGemtKamera.y !== kamera.y || sidstGemtKamera.zoom !== kamera.zoom;
}

function lavMiniature(tving) {
  try {
    sikrBase();
    if (!baseGyldig || !kameraLigBase()) {
      if (!tving) return null;
      tegnAltTilBase();
    }
    const w = 240;
    const h = Math.max(1, Math.round(w * baseCanvas.height / baseCanvas.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.drawImage(baseCanvas, 0, 0, w, h);
    return c.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

async function gemNu(medMiniature) {
  if (!aktivtId) return;
  if (gemTimer) { clearTimeout(gemTimer); gemTimer = null; }
  // Når man forlader lærredet (medMiniature), laves der altid en frisk miniature
  if (aendringsNr === gemtNr && !kameraAendretSidenGem() && !medMiniature) { return; }
  if (gemmer) { gemIgen = true; return; }
  gemmer = true;
  try {
    do {
      gemIgen = false;
      const id = aktivtId;
      const nr = aendringsNr;
      gemStatus.textContent = 'Gemmer…';
      const data = tilData();
      const kamKopi = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
      const mini = lavMiniature(medMiniature);
      await lager.skriv(id, data, mini, antalStreger);
      if (id === aktivtId) {
        gemtNr = nr;
        sidstGemtKamera = kamKopi;
      }
      gemStatus.textContent = 'Gemt';
    } while (gemIgen);
  } catch (e) {
    gemStatus.textContent = 'KUNNE IKKE GEMME' + (e && e.name === 'QuotaExceededError' ? ' (lageret er fuldt)' : '');
  } finally {
    gemmer = false;
  }
}

// ---------- dialog ----------

function visDialog(opt) {
  return new Promise(res => {
    dialogTitel.textContent = opt.titel;
    dialogTekst.textContent = opt.tekst || '';
    dialogInput.classList.toggle('skjult', opt.input === undefined);
    if (opt.input !== undefined) dialogInput.value = opt.input;
    dialogOk.textContent = opt.okTekst || 'OK';
    dialogEl.classList.remove('skjult');
    const luk = v => {
      dialogEl.classList.add('skjult');
      dialogOk.onclick = null;
      dialogAnnuller.onclick = null;
      dialogInput.onkeydown = null;
      res(v);
    };
    dialogOk.onclick = () => luk(opt.input !== undefined ? dialogInput.value : true);
    dialogAnnuller.onclick = () => luk(null);
    dialogInput.onkeydown = e => {
      if (e.key === 'Enter') dialogOk.onclick();
      else if (e.key === 'Escape') dialogAnnuller.onclick();
    };
    if (opt.input !== undefined) { dialogInput.focus(); dialogInput.select(); }
  });
}

// ---------- galleri ----------

function formaterDato(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}

function visGalleriSkaerm(vis) {
  galleriAaben = vis;
  galleriEl.classList.toggle('skjult', !vis);
}

function knap(tekst, fn, klasse) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = tekst;
  if (klasse) b.className = klasse;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  return b;
}

function byggKort(m) {
  const kort = document.createElement('div');
  kort.className = 'kort';
  const aabn = document.createElement('button');
  aabn.type = 'button';
  aabn.className = 'kortAabn';
  const bille = document.createElement('div');
  bille.className = 'miniature';
  if (m.miniature) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = m.miniature;
    bille.appendChild(img);
  }
  const navn = document.createElement('div');
  navn.className = 'kortNavn';
  navn.textContent = m.navn;
  const dato = document.createElement('div');
  dato.className = 'kortDato';
  dato.textContent = formaterDato(m.aendret) + (m.antal ? ' · ' + m.antal + ' streger' : ' · tomt');
  aabn.appendChild(bille);
  aabn.appendChild(navn);
  aabn.appendChild(dato);
  aabn.addEventListener('click', () => aabnLaerred(m.id));
  const raekke = document.createElement('div');
  raekke.className = 'raekke';
  raekke.appendChild(knap('Omdøb', () => omdoebLaerred(m)));
  raekke.appendChild(knap('Dupliker', () => duplikerLaerred(m)));
  raekke.appendChild(knap('Slet', () => sletLaerred(m)));
  kort.appendChild(aabn);
  kort.appendChild(raekke);
  return kort;
}

async function opdaterGalleri() {
  try {
    const liste = await lager.alleMeta();
    while (galleriGitter.firstChild) galleriGitter.removeChild(galleriGitter.firstChild);
    for (const m of liste) galleriGitter.appendChild(byggKort(m));
    galleriBesked.textContent = liste.length ? '' : 'Du har ingen lærreder endnu. Tryk på "+ Nyt lærred" for at begynde.';
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke læse dine lærreder: ' + (e && e.message ? e.message : 'ukendt fejl');
  }
}

async function nytLaerred() {
  if (optaget) return;
  optaget = true;
  try {
    const liste = await lager.alleMeta();
    let n = liste.length + 1;
    const navne = new Set(liste.map(m => m.navn));
    while (navne.has('Lærred ' + n)) n++;
    const id = nytId();
    await lager.opret(id, 'Lærred ' + n, tomData());
    optaget = false;
    await aabnLaerred(id);
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke oprette lærredet: ' + (e && e.message ? e.message : 'ukendt fejl');
  } finally {
    optaget = false;
  }
}

async function aabnLaerred(id) {
  if (optaget) return;
  optaget = true;
  galleriBesked.textContent = 'Åbner…';
  try {
    const data = await lager.hentData(id);
    if (!data) throw new Error('Lærredet findes ikke mere');
    const bygget = byggFraData(data);
    aktivtId = id;
    indlaes(bygget);
    gemStatus.textContent = 'Gemt';
    galleriBesked.textContent = '';
    visGalleriSkaerm(false);
    skaler();
  } catch (e) {
    galleriBesked.textContent = 'Lærredet kunne ikke åbnes (' + (e && e.message ? e.message : 'ukendt fejl') + ').';
  } finally {
    optaget = false;
  }
}

async function aabnUdenLagring() {
  aktivtId = null;
  indlaes(byggFraData(tomData()));
  gemStatus.textContent = 'Gemmes ikke';
  visGalleriSkaerm(false);
  skaler();
}

async function tilGalleri() {
  if (optaget) return;
  optaget = true;
  try {
    afbrydStreg();
    afslutSlet();
    pegere.clear();
    bevaegelse = null;
    if (aktivtId) await gemNu(true);
    // vent, hvis et gem stadig kører
    while (gemmer) await new Promise(r => setTimeout(r, 20));
    aktivtId = null;
    visGalleriSkaerm(true);
    await opdaterGalleri();
  } finally {
    optaget = false;
  }
}

async function omdoebLaerred(m) {
  const v = await visDialog({ titel: 'Omdøb lærred', input: m.navn, okTekst: 'Gem' });
  if (v === null) return;
  const navn = renseNavn(v);
  if (!navn) return;
  try { await lager.omdoeb(m.id, navn); } catch (e) { galleriBesked.textContent = 'Kunne ikke omdøbe.'; }
  await opdaterGalleri();
}

async function duplikerLaerred(m) {
  try {
    await lager.dupliker(m.id, nytId(), renseNavn(m.navn + ' (kopi)'));
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke duplikere: ' + (e && e.message ? e.message : 'ukendt fejl');
  }
  await opdaterGalleri();
}

async function sletLaerred(m) {
  const ok = await visDialog({ titel: 'Slet lærred?', tekst: '"' + m.navn + '" slettes for altid. Det kan ikke fortrydes.', okTekst: 'Slet' });
  if (!ok) return;
  try { await lager.slet(m.id); } catch (e) { galleriBesked.textContent = 'Kunne ikke slette.'; }
  await opdaterGalleri();
}

nytLaerredKnap.addEventListener('click', nytLaerred);
knapGalleri.addEventListener('click', tilGalleri);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') gemNu(true);
});
window.addEventListener('pagehide', () => { gemNu(false); });

async function startApp() {
  visGalleriSkaerm(true);
  gemStatus.textContent = '';
  try {
    await lager.init();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ikke vigtigt */ }
    await opdaterGalleri();
  } catch (e) {
    galleriBesked.textContent = 'Lagring er ikke tilgængelig her, så tegninger kan ikke gemmes. ';
    galleriBesked.appendChild(knap('Tegn alligevel uden at gemme', aabnUdenLagring));
    nytLaerredKnap.disabled = true;
  }
}

window.addEventListener('resize', skaler);
skaler();
saetFarve(farve);
opdaterKnapper();
requestAnimationFrame(loop);
startApp();
