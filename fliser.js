'use strict';
// FLISER (bid 9): tegneflader der genbruges.
// Tegningen deles i små firkantede "fliser" (som kortfliser). Hver flise tegnes én gang og gemmes som et billede.
// Når du flytter, zoomer eller tegner, sættes de færdige fliser bare sammen, så en ny frame koster
// det samme, uanset om der er 100 eller 100.000 streger. Manglende fliser tegnes lidt ad gangen i baggrunden,
// og imens vises det forrige billede (lidt sløret). Fliserne indeholder præcis det samme som hele billedet
// (alle niveauer, i tegnerækkefølge), så viskelæder og farver opfører sig ens.

function fliseId(node) { return node; }

function fliseNiveau(z) {
  const L = Math.ceil(Math.log2(z) - 1e-9);   // lidt højere opløsning end nødvendigt, så billedet ikke bliver uskarpt
  return Math.min(FLISE_MAX, Math.max(FLISE_MIN, L));
}

function fliseKort(node) {
  if (!node._fl) node._fl = new Map();
  fliseNoder.add(node);
  return node._fl;
}

function hentFliseCanvas() {
  const c = fliseBassin.pop() || document.createElement('canvas');
  if (c.width !== FLISE_PX || c.height !== FLISE_PX) { c.width = FLISE_PX; c.height = FLISE_PX; }
  return c;
}

function afleverFlise(rec) {
  if (rec.canvas) {
    if (fliseBassin.length < 80) fliseBassin.push(rec.canvas);
    rec.canvas = null;
    fliseCanvasAntal--;
  }
  fliseAntal--;
}

// ---------- tegn én flise ----------

function lavFlise(node, L, i, j) {
  const t0 = performance.now();
  const ts = FLISE_PX / dpr;               // flisens størrelse i css-pixels
  const zL = Math.pow(2, L);
  const W = ts / zL;                       // flisens størrelse i niveauets koordinater
  const kx = (i + 0.5) * W, ky = (j + 0.5) * W;
  const udenStreg = tegnerNu;              // en streg under tegning lægges først på bagefter
  const liste = [];
  gennemloebAlt((nd, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s !== udenStreg) liste.push({ s, z, kxh, kxl, kyh, kyl, cx, cy });
  }, { node, x: kx, y: ky, zoom: zL }, ts, ts, MAX_ANCESTOR_ZOOM * 2.01);   // flisen er højst dobbelt så forstørret som skærmen
  const rec = { L, i, j, canvas: null, tom: liste.length === 0, brugt: fliseFrame };
  if (!rec.tom) {
    liste.sort((a, b) => a.s.id - b.s.id);
    const c = hentFliseCanvas();
    fliseCanvasAntal++;
    tegnIFlise(c, ts, () => { for (const k of liste) tegnStreg(k.s, k.z, k.kxh, k.kxl, k.kyh, k.kyl, k.cx, k.cy); }, true);
    rec.canvas = c;
  }
  node._fl.set(L + '|' + i + '|' + j, rec);
  fliseAntal++;
  sidsteFliseMs = performance.now() - t0;
  return rec;
}

// Kør tegnefunktionen på en flises canvas (med flisens størrelse som tegneområde)
function tegnIFlise(c, ts, tegnFn, ryd) {
  let x = c._x;
  if (!x) { x = c.getContext('2d'); c._x = x; }
  const gammel = ctx, gB = maalB, gH = maalH;
  ctx = x; maalB = ts; maalH = ts;
  try {
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    if (ryd) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, ts, ts); }
    x.lineCap = 'round';
    x.lineJoin = 'round';
    tegnFn();
  } finally {
    ctx = gammel; maalB = gB; maalH = gH;
  }
}

// ---------- hold fliserne ajour ----------

// Områdets udstrækning (niveauets koordinater) som flise (L,i,j) dækker
function flisesOmraade(L, i, j) {
  const W = (FLISE_PX / dpr) / Math.pow(2, L);
  return { x0: i * W, x1: (i + 1) * W, y0: j * W, y1: (j + 1) * W, W };
}

function stregRamtFlise(s, L, i, j) {
  const o = flisesOmraade(L, i, j);
  const pad = s.w / 2;
  return !(s.maxX + pad < o.x0 || s.minX - pad > o.x1 || s.maxY + pad < o.y0 || s.minY - pad > o.y1);
}

function tomFliser(node) {
  if (!node._fl) return;
  for (const rec of node._fl.values()) afleverFlise(rec);
  node._fl.clear();
}

function tomAlleFliser() {
  for (const nd of fliseNoder) tomFliser(nd);
  fliseNoder.clear();
  kompSenest = null;
  kompKamera = null;
  fliseMangler = false;
}

// En ny (nyeste) streg er færdig i "node": tegn den oven på de fliser, der allerede findes
function fliserTilfoej(s, node) {
  if (!brugFliser) return;
  const ts = FLISE_PX / dpr;
  for (const nd of Array.from(fliseNoder)) {
    if (nd !== node) { tomFliser(nd); continue; }     // andre niveauer ser stregen anderledes: tegnes forfra ved behov
    for (const [nogle, rec] of nd._fl) {
      if (!stregRamtFlise(s, rec.L, rec.i, rec.j)) continue;
      const zL = Math.pow(2, rec.L);
      const stoerrelse = Math.max(s.maxX - s.minX, s.maxY - s.minY) * zL + s.w * zL;
      if (stoerrelse < 0.5) continue;                  // for lille til at kunne ses på dette niveau
      const W = ts / zL;
      const kx = (rec.i + 0.5) * W, ky = (rec.j + 0.5) * W;
      if (rec.tom) {                                   // tom flise får nu indhold
        rec.canvas = hentFliseCanvas();
        fliseCanvasAntal++;
        rec.tom = false;
        tegnIFlise(rec.canvas, ts, () => tegnStreg(s, zL, kx, 0, ky, 0, ts / 2, ts / 2), true);
      } else {
        tegnIFlise(rec.canvas, ts, () => tegnStreg(s, zL, kx, 0, ky, 0, ts / 2, ts / 2), false);
      }
    }
  }
  snavs = true;
}

// En streg er fjernet eller tilføjet "bagud i tiden" (fortryd, gentag, slet): tegn de berørte fliser forfra
function fliserUgyldig(node, s) {
  if (!brugFliser) return;
  for (const nd of Array.from(fliseNoder)) {
    if (nd !== node) { tomFliser(nd); continue; }
    for (const [nogle, rec] of Array.from(nd._fl)) {
      if (stregRamtFlise(s, rec.L, rec.i, rec.j)) { afleverFlise(rec); nd._fl.delete(nogle); }
    }
  }
  snavs = true;
}

function ryddFliser() {
  if (fliseCanvasAntal <= MAX_FLISER && fliseAntal <= MAX_FLISER * 8) return;
  const alle = [];
  for (const nd of fliseNoder) for (const [nogle, rec] of nd._fl) if (rec.brugt < fliseFrame) alle.push([nd, nogle, rec]);
  alle.sort((a, b) => a[2].brugt - b[2].brugt);
  const maalCanvas = Math.floor(MAX_FLISER * 0.85), maalAlle = MAX_FLISER * 6;
  for (const [nd, nogle, rec] of alle) {
    if (fliseCanvasAntal <= maalCanvas && fliseAntal <= maalAlle) break;
    afleverFlise(rec);
    nd._fl.delete(nogle);
  }
}

// ---------- sammensætning af billedet ----------

function sikrKomp() {
  const w = laerred.width, h = laerred.height;
  if (!kompA || kompA.width !== w || kompA.height !== h) {
    kompA = document.createElement('canvas');
    kompB = document.createElement('canvas');
    kompA.width = w; kompA.height = h;
    kompB.width = w; kompB.height = h;
    kompNyt = kompA;
    kompSenest = null;
    kompKamera = null;
  }
}

// Hvordan et punkt i det forrige billede (kamera a) flytter sig til nuværende billede (kamera b): s1 = k*s0 + t
function forrigeAfbildning(a, b) {
  const cx = bredde / 2, cy = hoejde / 2;
  if (a.node === b.node) {
    const k = b.zoom / a.zoom;
    return { k, tx: cx * (1 - k) + (a.x - b.x) * b.zoom, ty: cy * (1 - k) + (a.y - b.y) * b.zoom };
  }
  if (b.node.parent === a.node) {              // nu i et barn af det forrige niveau
    const k = S * b.zoom / a.zoom, o = b.node;
    return { k, tx: cx * (1 - k) + ((a.x - o.ox) * S - b.x) * b.zoom, ty: cy * (1 - k) + ((a.y - o.oy) * S - b.y) * b.zoom };
  }
  if (a.node.parent === b.node) {              // nu i forælderen til det forrige niveau
    const k = b.zoom / (a.zoom * S), o = a.node;
    return { k, tx: cx * (1 - k) + (o.ox + a.x / S - b.x) * b.zoom, ty: cy * (1 - k) + (o.oy + a.y / S - b.y) * b.zoom };
  }
  return null;
}

function tegnFliser(budgetOverride) {
  snavs = false;
  fliseFrame++;
  const nu = performance.now();
  sikrKomp();

  if (!forrigeBevKamera || forrigeBevKamera.node !== kamera.node || forrigeBevKamera.x !== kamera.x ||
      forrigeBevKamera.y !== kamera.y || forrigeBevKamera.zoom !== kamera.zoom) {
    sidsteBevaegelse = nu;
    forrigeBevKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  }

  const node = kamera.node, z = kamera.zoom;
  const ts = FLISE_PX / dpr;
  const L = fliseNiveau(z), zL = Math.pow(2, L), W = ts / zL;
  const cx = bredde / 2, cy = hoejde / 2;
  const halvB = cx / z, halvH = cy / z;
  const i0 = Math.floor((kamera.x - halvB) / W), i1 = Math.floor((kamera.x + halvB) / W);
  const j0 = Math.floor((kamera.y - halvH) / W), j1 = Math.floor((kamera.y + halvH) / W);
  const kort = fliseKort(node);

  // Hvilke fliser mangler?
  const mangler = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const rec = kort.get(L + '|' + i + '|' + j);
      if (rec) rec.brugt = fliseFrame;
      else mangler.push({ i, j, d: Math.pow((i + 0.5) * W - kamera.x, 2) + Math.pow((j + 0.5) * W - kamera.y, 2) });
    }
  }
  mangler.sort((a, b) => a.d - b.d);   // dem nærmest midten først

  // Tegn manglende fliser inden for et tidsbudget (flere, når der ikke røres ved skærmen)
  const roerer = pegere.size > 0 || nu - sidsteBevaegelse < 250;
  const budget = budgetOverride !== undefined ? budgetOverride : (roerer ? 9 : 26);
  const t0 = performance.now();
  let lavet = 0;
  for (const m of mangler) {
    if (lavet > 0 && performance.now() - t0 > budget) break;
    lavFlise(node, L, m.i, m.j);
    lavet++;
  }
  fliseMangler = lavet < mangler.length;

  // Sæt billedet sammen: først det forrige billede (som forhåndsvisning), så de færdige fliser
  const K = kompNyt.getContext('2d');
  K.setTransform(1, 0, 0, 1, 0, 0);
  K.globalCompositeOperation = 'source-over';
  K.globalAlpha = 1;
  K.fillStyle = '#ffffff';
  K.fillRect(0, 0, kompNyt.width, kompNyt.height);
  if (kompSenest && kompKamera) {
    const f = forrigeAfbildning(kompKamera, kamera);
    if (f && f.k > 1 / 64 && f.k < 64) {
      K.setTransform(dpr * f.k, 0, 0, dpr * f.k, dpr * f.tx, dpr * f.ty);
      K.drawImage(kompSenest, 0, 0, kompSenest.width, kompSenest.height, 0, 0, bredde, hoejde);
    }
  }
  K.setTransform(dpr, 0, 0, dpr, 0, 0);
  K.fillStyle = '#ffffff';
  const ds = W * z + 0.5;                 // lidt overlap, så der ikke opstår tynde streger mellem fliser
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const rec = kort.get(L + '|' + i + '|' + j);
      if (!rec) continue;
      const dx = (i * W - kamera.x) * z + cx, dy = (j * W - kamera.y) * z + cy;
      if (rec.tom) K.fillRect(dx, dy, ds, ds);
      else K.drawImage(rec.canvas, 0, 0, FLISE_PX, FLISE_PX, dx, dy, ds, ds);
    }
  }
  kompSenest = kompNyt;
  kompNyt = kompNyt === kompA ? kompB : kompA;
  kompKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };

  // Vis på skærmen, og tegn det, der ikke hører til fliserne, oven på
  hovedCtx.setTransform(1, 0, 0, 1, 0, 0);
  hovedCtx.globalCompositeOperation = 'source-over';
  hovedCtx.globalAlpha = 1;
  hovedCtx.drawImage(kompSenest, 0, 0);
  hovedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hovedCtx.lineCap = 'round';
  hovedCtx.lineJoin = 'round';
  if (tegnerNu && tegnerNode === kamera.node) {
    const gammel = ctx;
    ctx = hovedCtx;
    tegnStreg(tegnerNu, kamera.zoom, kamera.x, 0, kamera.y, 0, cx, cy);
    ctx = gammel;
  }
  if (erViskeVaerktoej(vaerktoej) && musX >= 0) {
    hovedCtx.globalAlpha = 1;
    hovedCtx.lineWidth = 1.5;
    hovedCtx.strokeStyle = '#777777';
    hovedCtx.beginPath();
    hovedCtx.arc(musX, musY, STOERRELSE[vaerktoej] / 2, 0, Math.PI * 2);
    hovedCtx.stroke();
  }

  ryddFliser();

  if (visFejlsoeg) {
    const linjer = ['kamera: x=' + kamera.x.toExponential(3) + ' y=' + kamera.y.toExponential(3) + ' zoom=' + kamera.zoom.toPrecision(4),
      'fliser: ' + fliseCanvasAntal + ' billeder, ' + fliseAntal + ' i alt, niveau ' + L + ', ' + mangler.length + ' mangler (' + lavet + ' tegnet nu)',
      'seneste flise: ' + sidsteFliseMs.toFixed(1) + ' ms',
      'historik: ' + fortrydStak.length + ' fortryd, ' + gentagStak.length + ' gentag'];
    let m = kamera.node, d = 0;
    while (m && d < 8) {
      linjer.push('niveau ' + m.niveau + ': ' + m.strokes.length + ' streger, ' + m.children.length + ' børn');
      m = m.parent; d++;
    }
    fejlsoeg.textContent = linjer.join('\n');
  }
  zoomtekst.textContent = 'Zoom ' + zoomTekst() + ' · niveau ' + kamera.node.niveau + ' · ' + antalStreger + ' streger' + (fliseMangler ? ' · tegner…' : '');
}

// Vælg tegnemetode (fliser er standard; den klassiske metode er en reserve)
function tegn() {
  if (brugFliser) tegnFliser(); else tegnKlassisk();
}

// Til miniaturer: sørg for, at alt synligt er tegnet (højst "ms" millisekunder), og giv billedet
function sidsteBilledeTilMiniature(ms) {
  if (!brugFliser) return null;
  sikrKomp();
  let forsoeg = 0;
  do { tegnFliser(ms); forsoeg++; } while (fliseMangler && forsoeg < 6);
  return kompSenest;
}
