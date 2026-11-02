'use strict';
// VÆRKTØJ: valg af pensel/størrelse, historik (fortryd/gentag), "slet streg", og oprettelse af streger.

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

